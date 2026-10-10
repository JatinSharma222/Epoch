import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
  Blockhash,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import { KeeperConfig, BatchSummary, TxLogEntry, VaultStatus } from "./types";
import { KeeperLogger } from "./logger";
import { PythOracleService } from "./oracle";
import idl from "./epoch_idl.json";

// ─── Constants ───────────────────────────────────────────────────────────────
const RING_SIZE = 8;
const BLOCKHASH_REFRESH_MS = 10_000;
const HEALTH_LOG_INTERVAL_MS = 30_000;
const BALANCE_CHECK_INTERVAL_MS = 60_000;
const LOW_BALANCE_WARN_SOL = 3.0;
const LOW_BALANCE_STOP_SOL = 0.5;

export class EpochKeeper {
  public config: KeeperConfig;
  public connection: Connection;
  public keypair: Keypair;
  public wallet: anchor.Wallet;
  public provider: anchor.AnchorProvider;
  public program: anchor.Program;
  public logger: KeeperLogger;
  public oracle: PythOracleService;

  public marketPda: PublicKey;
  public marketBump: number;
  public vaultAuthority: PublicKey;
  public vaultUser: PublicKey;

  // ─── State ───────────────────────────────────────────────────────────────
  private isRunning: boolean = false;
  private clearSettleTimeout: NodeJS.Timeout | null = null;
  private vaultQuoteTimeout: NodeJS.Timeout | null = null;
  private slotSubId: number | null = null;

  /** Locally tracked slot from slotSubscribe — updated by WebSocket, never fetched. */
  private _trackedSlot: number = 0;
  /** Set of batch IDs the vault has already quoted into. Cleared when a batch passes close_slot. */
  private _quotedBatches: Set<number> = new Set();
  /** Cached recent blockhash + last-valid-block-height. */
  private _cachedBlockhash: { blockhash: Blockhash; lastValidBlockHeight: number } | null = null;
  private _lastBlockhashFetchMs: number = 0;
  /** Balance tracking */
  private _lastBalanceSol: number = Infinity;
  private _lastBalanceCheckMs: number = 0;
  /** Health counters */
  private _stats = {
    vaultQuoteAttempts: 0,
    vaultQuoteSuccess: 0,
    vaultQuoteExpected: 0,     // 6007/6008/6009/6010 — counted, not warned
    clearAttempts: 0,
    clearSuccess: 0,
    settleAttempts: 0,
    settleSuccess: 0,
    lastHealthLogMs: 0,
  };
  /** Guards against re-entrant ticks */
  private _clearSettleBusy = false;
  private _vaultQuoteBusy = false;
  /** Cached market to avoid redundant fetches within a single tick */
  private _cachedMarket: any = null;
  private _cachedMarketTs: number = 0;
  private _lastMarketWarnTs: number = 0;
  private _lastLiqScanTs: number = 0;

  constructor(config: KeeperConfig, walletKeypair?: Keypair) {
    this.config = config;
    // Derive WebSocket URL from RPC URL if not explicitly set
    const wsEndpoint = config.wsUrl || config.rpcUrl.replace("https://", "wss://").replace("http://", "ws://");
    this.connection = new Connection(
      config.rpcUrl,
      {
        commitment: config.commitment || "confirmed",
        wsEndpoint,
      }
    );

    // Resolve keypair
    let keypair = walletKeypair;
    const defaultCliPath = path.join(
      process.env.HOME || "",
      ".config/solana/id.json"
    );
    const resolvedKeyPath =
      config.keypairPath || (fs.existsSync(defaultCliPath) ? defaultCliPath : undefined);

    if (!keypair && resolvedKeyPath && fs.existsSync(resolvedKeyPath)) {
      try {
        const raw = fs.readFileSync(resolvedKeyPath, "utf-8");
        keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
      } catch (err) {
        console.warn(`[keeper] Failed to load keypair from file:`, err);
      }
    }
    if (!keypair) {
      keypair = Keypair.generate();
    }

    this.keypair = keypair;
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

    const [vaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault")],
      config.programId
    );
    this.vaultAuthority = vaultAuthority;

    const [vaultUser] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), vaultAuthority.toBuffer()],
      config.programId
    );
    this.vaultUser = vaultUser;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  public getBatchPda(ringIndex: number): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("batch"), Buffer.from([ringIndex])],
      this.config.programId
    )[0];
  }

  /** The locally tracked slot from WebSocket slotSubscribe. */
  public get trackedSlot(): number {
    return this._trackedSlot;
  }

  /**
   * Fetches on-chain Market configuration account with a 2 s cache.
   */
  public async getMarket(): Promise<any> {
    const now = Date.now();
    if (this._cachedMarket && now - this._cachedMarketTs < 2000) {
      return this._cachedMarket;
    }
    try {
      this._cachedMarket = await (this.program.account as any).market.fetchNullable(this.marketPda);
      this._cachedMarketTs = now;
      return this._cachedMarket;
    } catch {
      return null;
    }
  }

  /** Invalidate cached market (forces refetch on next access). */
  public invalidateMarketCache(): void {
    this._cachedMarketTs = 0;
  }

  public getVaultAuthority(): PublicKey {
    return this.vaultAuthority;
  }

  public getVaultUser(): PublicKey {
    return this.vaultUser;
  }

  /**
   * Queries on-chain Backstop Vault UserAccount state.
   */
  public async getVaultStatus(): Promise<VaultStatus | null> {
    try {
      const user = await (this.program.account as any).userAccount.fetch(
        this.vaultUser
      );
      const market = await this.getMarket();
      const oraclePrice = market ? market.lastOraclePrice.toNumber() : 0;
      const basePos = user.basePosition.toNumber();
      const quotePos = Number(user.quotePosition.toString());
      const collateral = user.collateral.toNumber();
      const fundingSnapshot = Number(user.fundingSnapshot.toString());
      const fundingIndex = market ? Number(market.fundingIndex.toString()) : 0;
      const delta = fundingIndex - fundingSnapshot;
      const pendingFunding = Math.floor((basePos * delta) / 1_000_000_000);
      const posVal = Math.floor((basePos * oraclePrice) / 1000);
      const pnl = quotePos + posVal - pendingFunding;
      const equity = collateral + pnl;

      return {
        vaultAuthority: this.vaultAuthority,
        vaultUser: this.vaultUser,
        inventoryLots: basePos,
        collateralMicroUsdc: collateral,
        quotePositionMicroUsdc: user.quotePosition.toString(),
        pnlMicroUsdc: pnl,
        equityMicroUsdc: equity,
        activeOrders: user.activeOrders,
      };
    } catch {
      return null;
    }
  }

  // ─── Cached Blockhash ────────────────────────────────────────────────────

  /**
   * Returns a recent blockhash, refreshing the cache every ~10 s.
   */
  private async getBlockhash(): Promise<{ blockhash: Blockhash; lastValidBlockHeight: number }> {
    const now = Date.now();
    if (this._cachedBlockhash && now - this._lastBlockhashFetchMs < BLOCKHASH_REFRESH_MS) {
      return this._cachedBlockhash;
    }
    this._cachedBlockhash = await this.connection.getLatestBlockhash("confirmed");
    this._lastBlockhashFetchMs = now;
    return this._cachedBlockhash;
  }

  /**
   * Signs and sends a Transaction using the cached blockhash.
   * Always uses skipPreflight and a compute-unit price.
   */
  private async sendTx(tx: Transaction): Promise<string> {
    const { blockhash } = await this.getBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.keypair.publicKey;

    const sig = await sendAndConfirmTransaction(
      this.connection,
      tx,
      [this.keypair],
      { skipPreflight: true, commitment: "confirmed" }
    );
    return sig;
  }

  // ─── Balance Guard ───────────────────────────────────────────────────────

  /**
   * Checks keeper SOL balance. Returns true if quoting is allowed.
   */
  private async checkBalance(): Promise<boolean> {
    const now = Date.now();
    if (now - this._lastBalanceCheckMs < BALANCE_CHECK_INTERVAL_MS && this._lastBalanceSol !== Infinity) {
      return this._lastBalanceSol >= LOW_BALANCE_STOP_SOL;
    }
    try {
      const lamports = await this.connection.getBalance(this.keypair.publicKey);
      this._lastBalanceSol = lamports / LAMPORTS_PER_SOL;
      this._lastBalanceCheckMs = now;

      if (this._lastBalanceSol < LOW_BALANCE_STOP_SOL) {
        this.logger.error(
          `[keeper] CRITICAL: Balance ${this._lastBalanceSol.toFixed(4)} SOL < ${LOW_BALANCE_STOP_SOL} SOL. Vault quoting STOPPED.`
        );
        return false;
      }
      if (this._lastBalanceSol < LOW_BALANCE_WARN_SOL) {
        this.logger.warn(
          `[keeper] WARNING: Balance ${this._lastBalanceSol.toFixed(4)} SOL < ${LOW_BALANCE_WARN_SOL} SOL. Fund the keeper wallet.`
        );
      }
      return true;
    } catch {
      return this._lastBalanceSol >= LOW_BALANCE_STOP_SOL;
    }
  }

  // ─── Health Logging ──────────────────────────────────────────────────────

  private logHealth(): void {
    const now = Date.now();
    if (now - this._stats.lastHealthLogMs < HEALTH_LOG_INTERVAL_MS) return;
    this._stats.lastHealthLogMs = now;

    const totalVQ = this._stats.vaultQuoteAttempts;
    const successVQ = this._stats.vaultQuoteSuccess;
    const expectedVQ = this._stats.vaultQuoteExpected;
    const rate = totalVQ > 0 ? ((successVQ / totalVQ) * 100).toFixed(1) : "N/A";

    const status =
      this._lastBalanceSol < LOW_BALANCE_STOP_SOL
        ? "CRITICAL"
        : this._lastBalanceSol < LOW_BALANCE_WARN_SOL
        ? "DEGRADED"
        : "HEALTHY";

    this.logger.logHealth({
      timestamp: new Date().toISOString(),
      slot: this._trackedSlot,
      keeperBalanceSol: this._lastBalanceSol,
      status,
      details: `vq_attempts=${totalVQ} vq_ok=${successVQ} vq_expected=${expectedVQ} vq_rate=${rate}% clears=${this._stats.clearSuccess}/${this._stats.clearAttempts} settles=${this._stats.settleSuccess}/${this._stats.settleAttempts} quoted_batches_cached=${this._quotedBatches.size}`,
    });

    this.logger.info(
      `[health] slot=${this._trackedSlot} bal=${this._lastBalanceSol.toFixed(3)}SOL vq=${successVQ}/${totalVQ}(${rate}%) expected=${expectedVQ} clears=${this._stats.clearSuccess} settles=${this._stats.settleSuccess} status=${status} [MEASURED]`
    );
  }

  // ─── Batch Summaries (single fetchMultiple per tick) ─────────────────────

  /**
   * Scans all 8 ring batch accounts in a single RPC call and returns structured summaries.
   */
  public async getBatchSummaries(): Promise<BatchSummary[]> {
    const market = await this.getMarket();
    if (!market) {
      return [];
    }
    const batchSlots = market.params.batchSlots;
    const startSlot = market.startSlot.toNumber();
    const summaries: BatchSummary[] = [];

    const statusNames = ["EMPTY", "OPEN", "CLEARED", "VOID", "SETTLED"];
    const batchPdas = Array.from({ length: RING_SIZE }, (_, r) => this.getBatchPda(r));

    try {
      const batches = await (this.program.account as any).batch.fetchMultiple(batchPdas);
      for (let r = 0; r < RING_SIZE; r++) {
        const batch = batches[r];
        if (!batch) continue;
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
      }
    } catch {
      // Transient RPC error
    }
    return summaries;
  }

  // ─── Utility: is error "expected" (counted, not warned) ──────────────────

  private isExpectedError(errStr: string): boolean {
    return (
      errStr.includes("BatchClosed") ||
      errStr.includes("RingSlotBusy") ||
      errStr.includes("BatchTooFarAhead") ||
      errStr.includes("BatchInPast") ||
      errStr.includes("BatchNotOpen") ||
      errStr.includes("0x1777") || // 6007 RingSlotBusy
      errStr.includes("0x1778") || // 6008 BatchClosed
      errStr.includes("0x1779") || // 6009 BatchTooFarAhead
      errStr.includes("0x177a") || // 6010 BatchInPast
      errStr.includes("Custom\":6007") ||
      errStr.includes("Custom\":6008") ||
      errStr.includes("Custom\":6009") ||
      errStr.includes("Custom\":6010") ||
      errStr.includes("block height exceeded") ||
      errStr.includes("Blockhash not found")
    );
  }

  /** Extracts error string from any caught error. */
  private extractErrStr(err: any): string {
    const parts: string[] = [];
    if (err?.message) parts.push(err.message);
    if (err?.transactionMessage) parts.push(err.transactionMessage);
    if (Array.isArray(err?.logs)) parts.push(...err.logs);
    if (Array.isArray(err?.transactionLogs)) parts.push(...err.transactionLogs);
    if (parts.length === 0 && err) parts.push(String(err));
    return parts.join(" ");
  }

  // ─── Clear & Settle ──────────────────────────────────────────────────────

  /**
   * Bundles clear_batch + settle_users in ONE transaction when users fit one page.
   * Idempotent: returns cleanly if batch was already cleared or settled.
   */
  public async clearAndSettleBatch(
    batchId: number,
    ringIndex: number,
    maxPageUsers: number = 16
  ): Promise<{ success: boolean; signature?: string; cu?: number; bundled: boolean; error?: string }> {
    const batchPda = this.getBatchPda(ringIndex);
    const batch = await (this.program.account as any).batch.fetch(batchPda);

    if (batch.status !== 1) {
      return { success: true, bundled: false };
    }

    // Collect distinct unsettled users
    const distinctUsers: PublicKey[] = [];
    const seenUsers = new Set<string>();

    for (let i = 0; i < batch.numOrders; i++) {
      const order = batch.orders[i];
      if (order.status !== 5 && order.status !== 3) {
        const userPdaStr = order.userPda.toBase58();
        if (!seenUsers.has(userPdaStr)) {
          seenUsers.add(userPdaStr);
          distinctUsers.push(order.userPda);
        }
      }
    }

    const market = await this.getMarket();
    const startSlot = market.startSlot.toNumber();
    const batchSlots = market.params.batchSlots;
    const closeSlot = startSlot + (batchId + 1) * batchSlots;

    const oraclePrice = await this.oracle.getLatestPrice(
      market.lastOraclePrice.toNumber() || 150_000_000
    );
    const postedSlot = oraclePrice.isFallback
      ? new anchor.BN(closeSlot)
      : oraclePrice.postedSlot;

    this._stats.clearAttempts++;

    try {
      const clearIx = await this.program.methods
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
        .instruction();

      const settleIx = await this.program.methods
        .settleUsers(new anchor.BN(batchId), ringIndex)
        .accounts({
          market: this.marketPda,
          batch: batchPda,
        })
        .remainingAccounts(
          distinctUsers.map((pubkey) => ({
            pubkey,
            isWritable: true,
            isSigner: false,
          }))
        )
        .instruction();

      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
        clearIx,
        settleIx
      );

      const txSig = await this.sendTx(tx);

      const txInfo = await this.connection.getTransaction(txSig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      const landedSlot = txInfo?.slot || this._trackedSlot;
      const cuConsumed = txInfo?.meta?.computeUnitsConsumed || 0;

      this._stats.clearSuccess++;
      this._stats.settleAttempts++;
      this._stats.settleSuccess++;

      this.logger.logTx({
        signature: txSig,
        kind: "clear_and_settle",
        source: "keeper",
        network: this.config.network || "devnet",
        submit_slot: this._trackedSlot,
        landed_slot: landedSlot,
        cu_consumed: cuConsumed,
        success: true,
        error: null,
        created_at: new Date().toISOString(),
        batch_id: batchId,
        ring_index: ringIndex,
      });

      return { success: true, signature: txSig, cu: cuConsumed, bundled: true };
    } catch (err: any) {
      const errStr = this.extractErrStr(err);

      if (this.isExpectedError(errStr)) {
        this._stats.clearSuccess++;
        return { success: true, bundled: true };
      }

      this.logger.warn(`[keeper] clear_and_settle error for batch ${batchId}:`, errStr);
      // Fallback: try unbundled clearBatch
      const clearRes = await this.clearBatch(batchId, ringIndex);
      return { ...clearRes, bundled: false };
    }
  }

  /**
   * Clears an eligible OPEN batch whose close slot has passed.
   */
  public async clearBatch(
    batchId: number,
    ringIndex: number
  ): Promise<{ success: boolean; signature?: string; cu?: number }> {
    const batchPda = this.getBatchPda(ringIndex);
    const batch = await (this.program.account as any).batch.fetch(batchPda);

    if (batch.status !== 1) {
      return { success: true };
    }

    const market = await this.getMarket();
    const startSlot = market.startSlot.toNumber();
    const batchSlots = market.params.batchSlots;
    const closeSlot = startSlot + (batchId + 1) * batchSlots;

    const oraclePrice = await this.oracle.getLatestPrice(
      market.lastOraclePrice.toNumber() || 150_000_000
    );
    const postedSlot = oraclePrice.isFallback
      ? new anchor.BN(closeSlot)
      : oraclePrice.postedSlot;

    this._stats.clearAttempts++;

    try {
      const ix = await this.program.methods
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
        .instruction();

      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ix
      );

      const txSig = await this.sendTx(tx);

      const txInfo = await this.connection.getTransaction(txSig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      const landedSlot = txInfo?.slot || this._trackedSlot;
      const cuConsumed = txInfo?.meta?.computeUnitsConsumed || 0;

      this._stats.clearSuccess++;

      this.logger.logTx({
        signature: txSig,
        kind: "clear_batch",
        source: "keeper",
        network: this.config.network || "devnet",
        submit_slot: this._trackedSlot,
        landed_slot: landedSlot,
        cu_consumed: cuConsumed,
        success: true,
        error: null,
        created_at: new Date().toISOString(),
        batch_id: batchId,
        ring_index: ringIndex,
      });

      return { success: true, signature: txSig, cu: cuConsumed };
    } catch (err: any) {
      const errStr = this.extractErrStr(err);

      if (
        this.isExpectedError(errStr) ||
        errStr.includes("BatchNotOpen") ||
        errStr.includes("BatchIdMismatch") ||
        errStr.includes("AlreadyProcessed")
      ) {
        this._stats.clearSuccess++;
        return { success: true };
      }

      this.logger.warn(`[keeper] clear_batch error for batch ${batchId}:`, errStr);
      return { success: false, error: errStr } as any;
    }
  }

  /**
   * Settles users for a CLEARED or VOID batch in pages.
   */
  public async settleUsers(
    batchId: number,
    ringIndex: number,
    pageSize: number = 10
  ): Promise<{ settledPages: number; totalCu: number }> {
    const batchPda = this.getBatchPda(ringIndex);
    const batch = await (this.program.account as any).batch.fetch(batchPda);

    if (batch.status !== 2 && batch.status !== 3) {
      return { settledPages: 0, totalCu: 0 };
    }

    if (batch.settledOrders >= batch.numOrders) {
      return { settledPages: 0, totalCu: 0 };
    }

    const unsettledUsers: PublicKey[] = [];
    const seenUsers = new Set<string>();

    for (let i = 0; i < batch.numOrders; i++) {
      const order = batch.orders[i];
      if (order.status !== 5 && order.status !== 3) {
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

    for (let i = 0; i < unsettledUsers.length; i += pageSize) {
      const chunk = unsettledUsers.slice(i, i + pageSize);

      this._stats.settleAttempts++;

      try {
        const ix = await this.program.methods
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
          .instruction();

        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
          ix
        );

        const txSig = await this.sendTx(tx);

        const txInfo = await this.connection.getTransaction(txSig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });

        const cuConsumed = txInfo?.meta?.computeUnitsConsumed || 0;
        totalCu += cuConsumed;
        settledPages++;
        this._stats.settleSuccess++;

        this.logger.logTx({
          signature: txSig,
          kind: "settle_users",
          source: "keeper",
          network: this.config.network || "devnet",
          submit_slot: this._trackedSlot,
          landed_slot: txInfo?.slot || this._trackedSlot,
          cu_consumed: cuConsumed,
          success: true,
          error: null,
          created_at: new Date().toISOString(),
          batch_id: batchId,
          ring_index: ringIndex,
        });
      } catch (err: any) {
        const errStr = this.extractErrStr(err);

        if (this.isExpectedError(errStr) || errStr.includes("BatchNotCleared")) {
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
   * Voids a stale batch and clears users' pending lots/active_orders and releases margin.
   */
  public async expireAndRelease(
    batchId: number,
    ringIndex: number,
    pageSize: number = 10
  ): Promise<{ releasedPages: number; totalCu: number; success: boolean }> {
    const batchPda = this.getBatchPda(ringIndex);
    let batch: any;
    try {
      batch = await (this.program.account as any).batch.fetch(batchPda);
    } catch {
      return { releasedPages: 0, totalCu: 0, success: false };
    }

    if (batch.batchId.toNumber() !== batchId) {
      return { releasedPages: 0, totalCu: 0, success: false };
    }

    if (batch.status === 4) {
      return { releasedPages: 0, totalCu: 0, success: true };
    }

    const unsettledUsers: PublicKey[] = [];
    const seenUsers = new Set<string>();

    for (let i = 0; i < batch.numOrders; i++) {
      const order = batch.orders[i];
      if (order.status !== 5 && order.status !== 3) {
        const userPdaStr = order.userPda.toBase58();
        if (!seenUsers.has(userPdaStr)) {
          seenUsers.add(userPdaStr);
          unsettledUsers.push(order.userPda);
        }
      }
    }

    let releasedPages = 0;
    let totalCu = 0;

    const chunks =
      unsettledUsers.length === 0
        ? [[]] // still call once with no remaining accounts
        : Array.from({ length: Math.ceil(unsettledUsers.length / pageSize) }, (_, i) =>
            unsettledUsers.slice(i * pageSize, (i + 1) * pageSize)
          );

    for (const chunk of chunks) {
      try {
        const ix = await (this.program.methods as any)
          .expireAndRelease(new anchor.BN(batchId), ringIndex)
          .accounts({
            market: this.marketPda,
            batch: batchPda,
            caller: this.wallet.publicKey,
          })
          .remainingAccounts(
            chunk.map((pubkey: PublicKey) => ({
              pubkey,
              isWritable: true,
              isSigner: false,
            }))
          )
          .instruction();

        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
          ix
        );

        const txSig = await this.sendTx(tx);

        const txInfo = await this.connection.getTransaction(txSig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        const cuConsumed = txInfo?.meta?.computeUnitsConsumed || 0;
        totalCu += cuConsumed;
        releasedPages++;

        this.logger.logTx({
          signature: txSig,
          kind: "expire_and_release" as any,
          source: "keeper",
          network: this.config.network || "devnet",
          submit_slot: this._trackedSlot,
          landed_slot: txInfo?.slot || this._trackedSlot,
          cu_consumed: cuConsumed,
          success: true,
          error: null,
          created_at: new Date().toISOString(),
          batch_id: batchId,
          ring_index: ringIndex,
        });

        this.logger.info(
          `[keeper] expire_and_release: batch ${batchId} page ${releasedPages} released ${chunk.length} users (CU: ${cuConsumed}) [MEASURED]`
        );
      } catch (err: any) {
        const errStr = this.extractErrStr(err);
        this.logger.warn(
          `[keeper] expire_and_release page error for batch ${batchId}:`,
          errStr
        );
        break;
      }
    }

    return { releasedPages, totalCu, success: releasedPages > 0 };
  }

  // ─── Vault Quoting ───────────────────────────────────────────────────────

  /**
   * Permissionlessly places Backstop Vault automated quotes into the target batch.
   *
   * Uses the locally tracked slot (from slotSubscribe) and targets current + L.
   * Skips if this batch has already been quoted (tracked in _quotedBatches).
   */
  public async vaultQuote(): Promise<{ success: boolean; signature?: string; cu?: number; error?: string }> {
    const currentSlot = this._trackedSlot || await this.connection.getSlot("processed");
    const market = await this.getMarket();
    if (!market) {
      return { success: false, error: "Market uninitialized" };
    }

    const batchSlots = market.params.batchSlots;
    const startSlot = market.startSlot.toNumber();
    const currentBatch = Math.floor((currentSlot - startSlot) / batchSlots);
    const L = market.params.lookahead; // on-chain value (4)
    const targetBatch = currentBatch + L;
    const ringIndex = targetBatch % RING_SIZE;
    const batchPda = this.getBatchPda(ringIndex);

    // Skip if already quoted into this batch
    if (this._quotedBatches.has(targetBatch)) {
      return { success: true };
    }

    // Prune old entries from _quotedBatches
    for (const qb of this._quotedBatches) {
      if (qb < currentBatch) {
        this._quotedBatches.delete(qb);
      }
    }

    this._stats.vaultQuoteAttempts++;

    try {
      const oracleData = await this.oracle.getLatestPrice();

      const ix = await (this.program.methods as any)
        .vaultQuote({
          targetBatch: new anchor.BN(targetBatch),
          ringIndex,
          oraclePrice: oracleData.price,
          oracleConf: oracleData.conf,
          oracleTimestamp: oracleData.publishTime,
        })
        .accounts({
          market: this.marketPda,
          batch: batchPda,
          vaultAuthority: this.vaultAuthority,
          vaultUser: this.vaultUser,
          cranker: this.wallet.publicKey,
        })
        .instruction();

      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ix
      );

      const txSig = await this.sendTx(tx);

      const txInfo = await this.connection.getTransaction(txSig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      const landedSlot = txInfo?.slot || currentSlot;
      const cuConsumed = txInfo?.meta?.computeUnitsConsumed || 0;

      this._stats.vaultQuoteSuccess++;
      this._quotedBatches.add(targetBatch);

      this.logger.logTx({
        signature: txSig,
        kind: "vault_quote",
        source: "keeper",
        network: this.config.network || "devnet",
        submit_slot: currentSlot,
        landed_slot: landedSlot,
        cu_consumed: cuConsumed,
        success: true,
        error: null,
        created_at: new Date().toISOString(),
        batch_id: targetBatch,
        ring_index: ringIndex,
      });

      return { success: true, signature: txSig, cu: cuConsumed };
    } catch (err: any) {
      const errStr = this.extractErrStr(err);

      if (this.isExpectedError(errStr)) {
        this._stats.vaultQuoteExpected++;
        // If RingSlotBusy, the batch already has quotes — mark as quoted
        if (errStr.includes("RingSlotBusy") || errStr.includes("6007") || errStr.includes("0x1777")) {
          this._quotedBatches.add(targetBatch);
        }
        return { success: true };
      }

      this.logger.warn(
        `[keeper] vault_quote error for batch ${targetBatch}:`,
        errStr
      );
      return { success: false, error: errStr };
    }
  }

  // ─── Liquidation ─────────────────────────────────────────────────────────

  /**
   * Liquidates an undercollateralized user position directly against the Backstop Vault.
   */
  public async liquidateUser(
    userPda: PublicKey,
    liquidateeOwner: PublicKey
  ): Promise<{
    success: boolean;
    signature?: string;
    cu?: number;
    error?: string;
  }> {
    try {
      const userAcc = await (this.program.account as any).userAccount.fetch(userPda);
      if (userAcc.basePosition.toNumber() === 0) {
        return { success: true };
      }
    } catch {
      return { success: false, error: "User account not found" };
    }

    const market = await this.getMarket();
    const oraclePrice = await this.oracle.getLatestPrice(
      market.lastOraclePrice.toNumber() || 150_000_000
    );

    try {
      const ix = await this.program.methods
        .liquidate({
          oraclePrice: oraclePrice.price,
          oracleConf: oraclePrice.conf,
          oracleTimestamp: oraclePrice.publishTime,
        })
        .accounts({
          market: this.marketPda,
          vaultAuthority: this.vaultAuthority,
          vaultUser: this.vaultUser,
          user: userPda,
          liquidatee: liquidateeOwner,
          liquidator: this.wallet.publicKey,
        })
        .instruction();

      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ix
      );

      const txSig = await this.sendTx(tx);

      const txInfo = await this.connection.getTransaction(txSig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      const landedSlot = txInfo?.slot || this._trackedSlot;
      const cuConsumed = txInfo?.meta?.computeUnitsConsumed || 0;

      this.logger.logTx({
        signature: txSig,
        kind: "liquidate",
        source: "keeper",
        network: this.config.network || "devnet",
        submit_slot: this._trackedSlot,
        landed_slot: landedSlot,
        cu_consumed: cuConsumed,
        success: true,
        error: null,
        created_at: new Date().toISOString(),
      });

      this.logger.info(
        `[keeper] Liquidated user ${userPda.toBase58()} (${cuConsumed} CU) [MEASURED]`
      );

      return { success: true, signature: txSig, cu: cuConsumed };
    } catch (err: any) {
      const errStr = this.extractErrStr(err);

      if (
        errStr.includes("NotLiquidatable") ||
        errStr.includes("PositionFlat") ||
        errStr.includes("Position is flat")
      ) {
        return { success: true };
      }

      this.logger.warn(
        `[keeper] liquidate error for user ${userPda.toBase58()}:`,
        errStr
      );
      return { success: false, error: errStr };
    }
  }

  /**
   * Scans all UserAccount instances and liquidates any position with equity < MMR.
   */
  public async liquidateEligibleUsers(): Promise<number> {
    let liquidatedCount = 0;
    try {
      const users = await (this.program.account as any).userAccount.all();
      const market = await this.getMarket();
      const oracleData = await this.oracle.getLatestPrice(
        market.lastOraclePrice.toNumber() || 150_000_000
      );
      const oraclePrice = oracleData.price.toNumber();
      const mmrBps = market.params.mmrBps;

      for (const u of users) {
        if (u.publicKey.equals(this.vaultUser)) continue;

        const basePos = u.account.basePosition.toNumber();
        if (basePos === 0) continue;

        if (
          u.account.pendingBuyLots.toNumber() > 0 ||
          u.account.pendingSellLots.toNumber() > 0 ||
          u.account.activeOrders > 0
        ) {
          continue;
        }

        const collateral = u.account.collateral.toNumber();
        const quotePos = Number(u.account.quotePosition.toString());
        const fundingSnapshot = Number(u.account.fundingSnapshot.toString());
        const fundingIndex = Number(market.fundingIndex.toString());

        const delta = fundingIndex - fundingSnapshot;
        const pendingFunding = Math.floor((basePos * delta) / 1_000_000_000);
        const posVal = Math.floor((basePos * oraclePrice) / 1000);
        const equity = collateral + quotePos + posVal - pendingFunding;

        const absBase = Math.abs(basePos);
        const mmrReq = Math.floor(
          (mmrBps * absBase * oraclePrice) / 1000 / 10_000
        );

        if (equity < mmrReq) {
          const res = await this.liquidateUser(u.publicKey, u.account.owner);
          if (res.success) {
            liquidatedCount++;
          }
        }
      }
    } catch (err: any) {
      this.logger.warn("[keeper] liquidation scan error:", err.toString());
    }
    return liquidatedCount;
  }

  // ─── Independent Loop 1: Clear & Settle ──────────────────────────────────

  /**
   * One clear/settle tick: inspects all batches, clears closed ones, settles cleared ones.
   */
  public async clearSettleTick(): Promise<{
    clearedCount: number;
    settledCount: number;
    liquidatedCount: number;
    currentSlot: number;
  }> {
    const currentSlot = this._trackedSlot || await this.connection.getSlot();
    const market = await this.getMarket();
    if (!market) {
      const now = Date.now();
      if (!this._lastMarketWarnTs || now - this._lastMarketWarnTs > 10000) {
        this._lastMarketWarnTs = now;
        this.logger.warn(
          `[keeper] Market account ${this.marketPda.toBase58()} is not yet initialized. Waiting...`
        );
      }
      return { clearedCount: 0, settledCount: 0, liquidatedCount: 0, currentSlot };
    }

    const summaries = await this.getBatchSummaries();

    let clearedCount = 0;
    let settledCount = 0;
    let liquidatedCount = 0;

    for (const b of summaries) {
      const maxClearDelay = market.params.maxClearDelaySlots || 20;
      const isStale = currentSlot > b.closeSlot + maxClearDelay;

      if ((b.status === 1 && isStale) || (b.status === 3 && b.settledOrders < b.numOrders)) {
        this.logger.info(
          `[keeper] Batch ${b.batchId} stale/void (${b.settledOrders}/${b.numOrders}). Expiring...`
        );
        const res = await this.expireAndRelease(b.batchId, b.ringIndex, this.config.pageSize || 10);
        if (res.releasedPages > 0) settledCount += res.releasedPages;
      } else if (b.status === 1 && currentSlot >= b.closeSlot) {
        const res = await this.clearAndSettleBatch(b.batchId, b.ringIndex);
        if (res.success) {
          clearedCount++;
          if (res.bundled) settledCount++;
        }
      } else if (
        (b.status === 2 || b.status === 3) &&
        b.settledOrders < b.numOrders
      ) {
        const pageSize = this.config.pageSize || 10;
        const res = await this.settleUsers(b.batchId, b.ringIndex, pageSize);
        if (res.settledPages > 0) settledCount += res.settledPages;
      }
    }

    // Liquidation scan (throttled to every 5 seconds)
    const now = Date.now();
    if (now - this._lastLiqScanTs >= 5000) {
      this._lastLiqScanTs = now;
      try {
        liquidatedCount = await this.liquidateEligibleUsers();
      } catch (err: any) {
        this.logger.warn("[keeper] liquidation scan tick error:", err.toString());
      }
    }

    return { clearedCount, settledCount, liquidatedCount, currentSlot };
  }

  // ─── Independent Loop 2: Vault Quoting ───────────────────────────────────

  /**
   * One vault quoting tick: places Backstop Vault quotes into the target batch.
   */
  public async vaultQuoteTick(): Promise<{ vaultQuotesCount: number; currentSlot: number }> {
    const currentSlot = this._trackedSlot || await this.connection.getSlot();
    let vaultQuotesCount = 0;

    // Balance guard
    const canQuote = await this.checkBalance();
    if (!canQuote) {
      return { vaultQuotesCount: 0, currentSlot };
    }

    try {
      const vaultStatus = await this.getVaultStatus();
      if (vaultStatus && vaultStatus.collateralMicroUsdc > 0) {
        const quoteRes = await this.vaultQuote();
        if (quoteRes.success) vaultQuotesCount++;

        this.logger.info(
          `[vault] inventory=${vaultStatus.inventoryLots} lots, collateral=${vaultStatus.collateralMicroUsdc} micro-USDC, quote_pos=${vaultStatus.quotePositionMicroUsdc}, pnl=${vaultStatus.pnlMicroUsdc} micro-USDC, equity=${vaultStatus.equityMicroUsdc} micro-USDC [MEASURED]`
        );
      }
    } catch (err: any) {
      this.logger.warn("[keeper] vault tick error:", err.toString());
    }

    // Emit health log periodically
    this.logHealth();

    return { vaultQuotesCount, currentSlot };
  }

  // ─── Combined tick (for --once mode) ─────────────────────────────────────

  /**
   * One combined execution tick. Used by --once mode.
   */
  public async tick(slotOverride?: number): Promise<{
    clearedCount: number;
    settledCount: number;
    vaultQuotesCount: number;
    liquidatedCount: number;
    currentSlot: number;
  }> {
    if (slotOverride) this._trackedSlot = slotOverride;
    if (!this._trackedSlot) this._trackedSlot = await this.connection.getSlot();

    const cs = await this.clearSettleTick();
    const vq = await this.vaultQuoteTick();

    return {
      clearedCount: cs.clearedCount,
      settledCount: cs.settledCount,
      vaultQuotesCount: vq.vaultQuotesCount,
      liquidatedCount: cs.liquidatedCount,
      currentSlot: this._trackedSlot,
    };
  }

  // ─── Start / Stop ────────────────────────────────────────────────────────

  /**
   * Starts the keeper with TWO independent loops and WebSocket slot tracking.
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Seed initial slot
    this._trackedSlot = await this.connection.getSlot();

    // Check initial balance
    await this.checkBalance();

    this.logger.info(
      `Epoch Keeper started on ${this.config.network || "devnet"} (mode=WebSocket slotSubscribe, dual-loop)`
    );

    // 1. Subscribe to slot changes over WebSocket — updates _trackedSlot only
    try {
      this.slotSubId = this.connection.onSlotChange((slotInfo) => {
        this._trackedSlot = slotInfo.slot;
      });
      this.logger.info(`Subscribed to onSlotChange (subId=${this.slotSubId}) [MEASURED]`);
    } catch (err) {
      this.logger.warn("Failed to subscribe via WebSocket:", err);
    }

    // 2. Clear/Settle loop — runs every 1 s
    const clearSettleLoop = async () => {
      if (!this.isRunning) return;
      if (this._clearSettleBusy) {
        if (this.isRunning) this.clearSettleTimeout = setTimeout(clearSettleLoop, 1000);
        return;
      }
      this._clearSettleBusy = true;
      try {
        await this.clearSettleTick();
      } catch (err) {
        this.logger.error("Error in clearSettle loop:", err);
      } finally {
        this._clearSettleBusy = false;
      }
      if (this.isRunning) {
        this.clearSettleTimeout = setTimeout(clearSettleLoop, 1000);
      }
    };

    // 3. Vault quoting loop — runs every 2 s (one batch = 2 slots ≈ 800 ms; quoting every 2 s is sufficient)
    const vaultQuoteLoop = async () => {
      if (!this.isRunning) return;
      if (this._vaultQuoteBusy) {
        if (this.isRunning) this.vaultQuoteTimeout = setTimeout(vaultQuoteLoop, 2000);
        return;
      }
      this._vaultQuoteBusy = true;
      try {
        await this.vaultQuoteTick();
      } catch (err) {
        this.logger.error("Error in vaultQuote loop:", err);
      } finally {
        this._vaultQuoteBusy = false;
      }
      if (this.isRunning) {
        this.vaultQuoteTimeout = setTimeout(vaultQuoteLoop, 2000);
      }
    };

    clearSettleLoop();
    setTimeout(vaultQuoteLoop, 500); // offset slightly to avoid simultaneous RPC bursts
  }

  /**
   * Stops the keeper loops and unsubscribes from WebSocket notifications.
   */
  public stop(): void {
    this.isRunning = false;
    if (this.slotSubId !== null) {
      this.connection.removeSlotChangeListener(this.slotSubId).catch(() => {});
      this.slotSubId = null;
    }
    if (this.clearSettleTimeout) {
      clearTimeout(this.clearSettleTimeout);
      this.clearSettleTimeout = null;
    }
    if (this.vaultQuoteTimeout) {
      clearTimeout(this.vaultQuoteTimeout);
      this.vaultQuoteTimeout = null;
    }
    this.logger.info("Epoch Keeper stopped.");
  }
}
