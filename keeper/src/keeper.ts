import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import * as fs from "fs";
import { KeeperConfig, BatchSummary, TxLogEntry } from "./types";
import { KeeperLogger } from "./logger";
import { PythOracleService } from "./oracle";
import idl from "../../target/idl/epoch.json";

export class EpochKeeper {
  public config: KeeperConfig;
  public connection: Connection;
  public wallet: anchor.Wallet;
  public provider: anchor.AnchorProvider;
  public program: anchor.Program;
  public logger: KeeperLogger;
  public oracle: PythOracleService;

  public marketPda: PublicKey;
  public marketBump: number;

  private isRunning: boolean = false;
  private loopTimeout: NodeJS.Timeout | null = null;

  constructor(config: KeeperConfig, walletKeypair?: Keypair) {
    this.config = config;
    this.connection = new Connection(
      config.rpcUrl,
      config.commitment || "confirmed"
    );

    // Resolve keypair
    let keypair = walletKeypair;
    if (!keypair && config.keypairPath && fs.existsSync(config.keypairPath)) {
      try {
        const raw = fs.readFileSync(config.keypairPath, "utf-8");
        keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
      } catch (err) {
        console.warn(`[keeper] Failed to load keypair from file:`, err);
      }
    }
    if (!keypair) {
      // Ephemeral devnet keeper keypair fallback
      keypair = Keypair.generate();
    }

    this.wallet = new anchor.Wallet(keypair);
    this.provider = new anchor.AnchorProvider(this.connection, this.wallet, {
      commitment: config.commitment || "confirmed",
      preflightCommitment: config.commitment || "confirmed",
    });

    this.program = new anchor.Program(
      idl as anchor.Idl,
      this.provider
    );

    this.logger = new KeeperLogger(config.logFilePath);
    this.oracle = new PythOracleService(
      this.connection,
      config.oracleFeedId
    );

    const [marketPda, marketBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("market")],
      config.programId
    );
    this.marketPda = marketPda;
    this.marketBump = marketBump;
  }

  public getBatchPda(ringIndex: number): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("batch"), Buffer.from([ringIndex])],
      this.config.programId
    )[0];
  }

  /**
   * Fetches on-chain Market configuration account.
   */
  public async getMarket(): Promise<any> {
    return (this.program.account as any).market.fetch(this.marketPda);
  }

  /**
   * Scans all 8 ring batch accounts and returns structured summaries.
   */
  public async getBatchSummaries(): Promise<BatchSummary[]> {
    const market = await this.getMarket();
    const batchSlots = market.params.batchSlots;
    const startSlot = market.startSlot.toNumber();
    const summaries: BatchSummary[] = [];

    const statusNames = ["EMPTY", "OPEN", "CLEARED", "VOID", "SETTLED"];

    for (let r = 0; r < 8; r++) {
      try {
        const pda = this.getBatchPda(r);
        const batch = await (this.program.account as any).batch.fetch(pda);
        const batchId = batch.batchId.toNumber();
        const closeSlot = startSlot + (batchId + 1) * batchSlots;

        summaries.push({
          ringIndex: r,
          batchId,
          status: batch.status,
          statusName: statusNames[batch.status] || "UNKNOWN",
          numOrders: batch.numOrders,
          settledOrders: batch.settledOrders,
          closeSlot,
          matchedLots: batch.matchedLots.toNumber(),
          clearingPrice: batch.clearingPrice.toNumber(),
        });
      } catch {
        // Uninitialized batch slot
      }
    }
    return summaries;
  }

  /**
   * Clears an eligible OPEN batch whose close slot has passed.
   * Idempotent: returns cleanly if batch was already cleared.
   */
  public async clearBatch(
    batchId: number,
    ringIndex: number
  ): Promise<{ success: boolean; signature?: string; cu?: number }> {
    const batchPda = this.getBatchPda(ringIndex);
    const batch = await (this.program.account as any).batch.fetch(batchPda);

    if (batch.status !== 1) {
      // Already cleared / settled / void
      return { success: true };
    }

    const market = await this.getMarket();
    const currentSlot = await this.connection.getSlot();
    const submitSlot = currentSlot;

    const startSlot = market.startSlot.toNumber();
    const batchSlots = market.params.batchSlots;
    const closeSlot = startSlot + (batchId + 1) * batchSlots;

    // Fetch oracle price
    const oraclePrice = await this.oracle.getLatestPrice(
      market.lastOraclePrice.toNumber() || 150_000_000
    );
    const postedSlot = oraclePrice.isFallback
      ? new anchor.BN(closeSlot)
      : oraclePrice.postedSlot;

    try {
      const txSig = await this.program.methods
        .clearBatch(new anchor.BN(batchId), ringIndex, {
          oraclePrice: oraclePrice.price,
          oracleConf: oraclePrice.conf,
          oraclePostedSlot: postedSlot,
          oracleTimestamp: oraclePrice.publishTime,
        })
        .accounts({
          market: this.marketPda,
          batch: batchPda,
          cranker: this.wallet.publicKey,
        })
        .rpc({ skipPreflight: true });

      // Confirm and fetch transaction metadata for CU consumption
      const txInfo = await this.connection.getTransaction(txSig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      const landedSlot = txInfo?.slot || (await this.connection.getSlot());
      const cuConsumed = txInfo?.meta?.computeUnitsConsumed || 0;

      const logEntry: TxLogEntry = {
        signature: txSig,
        kind: "clear_batch",
        source: "keeper",
        network: this.config.network || "devnet",
        submit_slot: submitSlot,
        landed_slot: landedSlot,
        cu_consumed: cuConsumed,
        success: true,
        error: null,
        created_at: new Date().toISOString(),
        batch_id: batchId,
        ring_index: ringIndex,
      };
      this.logger.logTx(logEntry);

      return { success: true, signature: txSig, cu: cuConsumed };
    } catch (err: any) {
      const errStr = err.toString();

      // Check if batch is already cleared or settled by a racing keeper
      try {
        const checkBatch = await (this.program.account as any).batch.fetch(batchPda);
        if (
          checkBatch.status !== 1 ||
          checkBatch.batchId.toNumber() > batchId
        ) {
          return { success: true };
        }
      } catch {}

      // Idempotency: If already cleared by racing keeper, succeed harmlessly
      if (
        errStr.includes("BatchNotOpen") ||
        errStr.includes("BatchIdMismatch") ||
        errStr.includes("AlreadyProcessed")
      ) {
        return { success: true };
      }

      this.logger.logTx({
        signature: "",
        kind: "clear_batch",
        source: "keeper",
        network: this.config.network || "devnet",
        submit_slot: submitSlot,
        success: false,
        error: errStr,
        created_at: new Date().toISOString(),
        batch_id: batchId,
        ring_index: ringIndex,
      });

      return { success: false, error: errStr } as any;
    }
  }

  /**
   * Settles users for a CLEARED or VOID batch in pages of users.
   * Idempotent: returns cleanly if all orders are already settled.
   */
  public async settleUsers(
    batchId: number,
    ringIndex: number,
    pageSize: number = 10
  ): Promise<{ settledPages: number; totalCu: number }> {
    const batchPda = this.getBatchPda(ringIndex);
    const batch = await (this.program.account as any).batch.fetch(batchPda);

    // Only settle if CLEARED (2) or VOID (3)
    if (batch.status !== 2 && batch.status !== 3) {
      return { settledPages: 0, totalCu: 0 };
    }

    if (batch.settledOrders >= batch.numOrders) {
      return { settledPages: 0, totalCu: 0 };
    }

    // Collect distinct unsettled user PDAs
    const unsettledUsers: PublicKey[] = [];
    const seenUsers = new Set<string>();

    for (let i = 0; i < batch.numOrders; i++) {
      const order = batch.orders[i];
      // 0 = OPEN, 1 = FILLED, 2 = PARTIAL
      if (order.status !== 5 && order.status !== 3) {
        // Not SETTLED and not CANCELLED
        const userPdaStr = order.userPda.toBase58();
        if (!seenUsers.has(userPdaStr)) {
          seenUsers.add(userPdaStr);
          unsettledUsers.push(order.userPda);
        }
      }
    }

    if (unsettledUsers.length === 0) {
      return { settledPages: 0, totalCu: 0 };
    }

    let settledPages = 0;
    let totalCu = 0;

    // Chunk into pages of pageSize users
    for (let i = 0; i < unsettledUsers.length; i += pageSize) {
      const chunk = unsettledUsers.slice(i, i + pageSize);
      const submitSlot = await this.connection.getSlot();

      try {
        const txSig = await this.program.methods
          .settleUsers(new anchor.BN(batchId), ringIndex)
          .accounts({
            market: this.marketPda,
            batch: batchPda,
          })
          .remainingAccounts(
            chunk.map((pubkey) => ({
              pubkey,
              isWritable: true,
              isSigner: false,
            }))
          )
          .rpc({ skipPreflight: true });

        const txInfo = await this.connection.getTransaction(txSig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });

        const landedSlot = txInfo?.slot || (await this.connection.getSlot());
        const cuConsumed = txInfo?.meta?.computeUnitsConsumed || 0;
        totalCu += cuConsumed;
        settledPages++;

        this.logger.logTx({
          signature: txSig,
          kind: "settle_users",
          source: "keeper",
          network: this.config.network || "devnet",
          submit_slot: submitSlot,
          landed_slot: landedSlot,
          cu_consumed: cuConsumed,
          success: true,
          error: null,
          created_at: new Date().toISOString(),
          batch_id: batchId,
          ring_index: ringIndex,
        });
      } catch (err: any) {
        const errStr = err.toString();

        // Check if already settled by a racing keeper
        try {
          const checkBatch = await (this.program.account as any).batch.fetch(batchPda);
          if (
            checkBatch.status === 4 ||
            checkBatch.batchId.toNumber() > batchId ||
            checkBatch.settledOrders >= checkBatch.numOrders
          ) {
            break;
          }
        } catch {}

        if (
          errStr.includes("BatchNotCleared") ||
          errStr.includes("BatchIdMismatch") ||
          errStr.includes("AlreadyProcessed")
        ) {
          break;
        }
        this.logger.warn(
          `[keeper] settle_users page error for batch ${batchId}:`,
          errStr
        );
      }
    }

    return { settledPages, totalCu };
  }

  /**
   * One execution tick: inspects all batches, clears closed ones, and settles cleared ones.
   */
  public async tick(): Promise<{
    clearedCount: number;
    settledCount: number;
    currentSlot: number;
  }> {
    const currentSlot = await this.connection.getSlot();
    const summaries = await this.getBatchSummaries();

    let clearedCount = 0;
    let settledCount = 0;

    for (const b of summaries) {
      // 1. Check for clearing
      if (b.status === 1 && currentSlot >= b.closeSlot) {
        const res = await this.clearBatch(b.batchId, b.ringIndex);
        if (res.success) clearedCount++;
      }

      // 2. Check for settlement
      if (
        (b.status === 2 || b.status === 3) &&
        b.settledOrders < b.numOrders
      ) {
        const pageSize = this.config.pageSize || 10;
        const res = await this.settleUsers(b.batchId, b.ringIndex, pageSize);
        if (res.settledPages > 0) settledCount += res.settledPages;
      }
    }

    return { clearedCount, settledCount, currentSlot };
  }

  /**
   * Starts the keeper polling loop.
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    const intervalMs = this.config.pollIntervalMs || 1000;

    this.logger.info(
      `Epoch Keeper started on ${this.config.network || "devnet"} (interval=${intervalMs}ms)`
    );

    const loop = async () => {
      if (!this.isRunning) return;
      try {
        await this.tick();
      } catch (err) {
        this.logger.error("Error in keeper tick loop:", err);
      }
      if (this.isRunning) {
        this.loopTimeout = setTimeout(loop, intervalMs);
      }
    };

    loop();
  }

  /**
   * Stops the keeper polling loop.
   */
  public stop(): void {
    this.isRunning = false;
    if (this.loopTimeout) {
      clearTimeout(this.loopTimeout);
      this.loopTimeout = null;
    }
    this.logger.info("Epoch Keeper stopped.");
  }
}
