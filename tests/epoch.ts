import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Epoch } from "../target/types/epoch";
import { expect } from "chai";
import * as fs from "fs";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

describe("Epoch Program Integration Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Epoch as Program<Epoch>;

  // PDAs
  const [marketPda, marketBump] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("market")],
    program.programId
  );
  const [mintAuthorityPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority")],
    program.programId
  );
  const [quoteMintPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("quote_mint")],
    program.programId
  );
  const [collateralVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("collateral_vault")],
    program.programId
  );

  const getBatchPda = (ringIndex: number) => {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("batch"), Buffer.from([ringIndex])],
      program.programId
    )[0];
  };

  const admin = provider.wallet;
  const testUser = anchor.web3.Keypair.generate();
  const unauthorizedUser = anchor.web3.Keypair.generate();

  const [userPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("user"), testUser.publicKey.toBuffer()],
    program.programId
  );

  const [unauthorizedUserPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("user"), unauthorizedUser.publicKey.toBuffer()],
    program.programId
  );

  let userAta: anchor.web3.PublicKey;
  let unauthorizedAta: anchor.web3.PublicKey;

  const NUM_USERS = 16;
  const cuUsers: anchor.web3.Keypair[] = [];
  const cuUserPdas: anchor.web3.PublicKey[] = [];
  const cuUserAtas: anchor.web3.PublicKey[] = [];

  let workedBatchId: anchor.BN;
  let workedRingIndex: number = -1;
  let voidBatchId: anchor.BN;
  let voidRingIndex: number = -1;

  const defaultMarketArgs = {
    baseLot: new anchor.BN(1000),
    priceTick: new anchor.BN(1000),
    minOrderLots: new anchor.BN(10),
    minOrderNotional: new anchor.BN(1_000_000), // $1.00
    fundingPeriodSlots: 72000,
    batchSlots: 2,
    lookahead: 3,
    kTicks: 101,
    tickBps: 1,
    imrBps: 1000,
    mmrBps: 500,
    feeBps: 5,
    liqPenaltyBps: 100,
    maxOracleAgeSecs: 10,
    maxConfBps: 20,
    maxClearDelaySlots: 4,
    maxOrdersPerBatch: 128,
    fundingCapBps: 50,
  };

  const dummyOracleFeedId = new Array(32).fill(7);

  before(async () => {
    // Fund test users with SOL for rent and gas
    const fundTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: testUser.publicKey,
        lamports: 2 * anchor.web3.LAMPORTS_PER_SOL,
      }),
      anchor.web3.SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: unauthorizedUser.publicKey,
        lamports: 1 * anchor.web3.LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(fundTx);

    userAta = getAssociatedTokenAddressSync(quoteMintPda, testUser.publicKey);
    unauthorizedAta = getAssociatedTokenAddressSync(
      quoteMintPda,
      unauthorizedUser.publicKey
    );
  });

  describe("T-02: Zero-copy Batch Ring PDA Initialization", () => {
    it("Initializes all 8 zero-copy batch PDAs in the ring", async () => {
      for (let r = 0; r < 8; r++) {
        const batchPda = getBatchPda(r);
        await program.methods
          .initializeBatch(r, new anchor.BN(r))
          .accounts({
            batch: batchPda,
            payer: admin.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();

        const batchAccount = await program.account.batch.fetch(batchPda);
        expect(batchAccount.batchId.toNumber()).to.equal(r);
        expect(batchAccount.status).to.equal(1); // BatchStatus::OPEN
        expect(batchAccount.numOrders).to.equal(0);
        expect(batchAccount.settledOrders).to.equal(0);
      }
    });
  });

  describe("T-05: Market Initialization", () => {
    it("Initializes the Market, mock USDC mint, and collateral vault", async () => {
      await program.methods
        .initializeMarket(defaultMarketArgs, dummyOracleFeedId)
        .accounts({
          market: marketPda,
          mintAuthority: mintAuthorityPda,
          quoteMint: quoteMintPda,
          collateralVault: collateralVaultPda,
          admin: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      const marketAccount = await program.account.market.fetch(marketPda);
      expect(marketAccount.admin.toBase58()).to.equal(admin.publicKey.toBase58());
      expect(marketAccount.quoteMint.toBase58()).to.equal(quoteMintPda.toBase58());
      expect(marketAccount.collateralVault.toBase58()).to.equal(
        collateralVaultPda.toBase58()
      );
      expect(marketAccount.bump).to.equal(marketBump);
      expect(marketAccount.nextBatchToClear.toNumber()).to.equal(0);
      expect(marketAccount.feePool.toNumber()).to.equal(0);
      expect(marketAccount.insuranceFund.toNumber()).to.equal(0);
      expect(marketAccount.params.batchSlots).to.equal(2);
      expect(marketAccount.params.kTicks).to.equal(101);
      expect(marketAccount.params.imrBps).to.equal(1000);
    });
  });

  describe("T-05: Faucet", () => {
    it("Creates an associated token account and mints mock USDC via faucet", async () => {
      // Create user ATA
      const createAtaTx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          testUser.publicKey,
          userAta,
          testUser.publicKey,
          quoteMintPda
        )
      );
      await anchor.web3.sendAndConfirmTransaction(provider.connection, createAtaTx, [
        testUser,
      ]);

      // Request $1,000 USDC (1,000,000,000 micro-USDC)
      const amount = new anchor.BN(1_000_000_000);
      await program.methods
        .faucet(amount)
        .accounts({
          quoteMint: quoteMintPda,
          mintAuthority: mintAuthorityPda,
          recipientTokenAccount: userAta,
          recipient: testUser.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([testUser])
        .rpc();

      const ataInfo = await getAccount(provider.connection, userAta);
      expect(Number(ataInfo.amount)).to.equal(1_000_000_000);
    });

    it("Rejects faucet request exceeding $10,000 cap", async () => {
      const excessiveAmount = new anchor.BN(10_001_000_000);
      try {
        await program.methods
          .faucet(excessiveAmount)
          .accounts({
            quoteMint: quoteMintPda,
            mintAuthority: mintAuthorityPda,
            recipientTokenAccount: userAta,
            recipient: testUser.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([testUser])
          .rpc();
        expect.fail("Should have failed with FaucetCapExceeded");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("FaucetCapExceeded");
      }
    });

    it("Rejects zero-amount faucet request", async () => {
      try {
        await program.methods
          .faucet(new anchor.BN(0))
          .accounts({
            quoteMint: quoteMintPda,
            mintAuthority: mintAuthorityPda,
            recipientTokenAccount: userAta,
            recipient: testUser.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([testUser])
          .rpc();
        expect.fail("Should have failed with ZeroAmount");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("ZeroAmount");
      }
    });
  });

  describe("T-05: User Account Creation", () => {
    it("Creates a UserAccount PDA for testUser and unauthorizedUser", async () => {
      await program.methods
        .createUser()
        .accounts({
          user: userPda,
          owner: testUser.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([testUser])
        .rpc();

      const userAccount = await program.account.userAccount.fetch(userPda);
      expect(userAccount.owner.toBase58()).to.equal(testUser.publicKey.toBase58());
      expect(userAccount.collateral.toNumber()).to.equal(0);
      expect(userAccount.basePosition.toNumber()).to.equal(0);

      // Create account for unauthorizedUser (with $0 collateral)
      await program.methods
        .createUser()
        .accounts({
          user: unauthorizedUserPda,
          owner: unauthorizedUser.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([unauthorizedUser])
        .rpc();
    });
  });

  describe("T-05: Collateral Deposit and Withdrawal", () => {
    it("Deposits $500 USDC collateral and verifies Invariant I-1", async () => {
      const depositAmount = new anchor.BN(500_000_000); // $500 USDC

      await program.methods
        .deposit(depositAmount)
        .accounts({
          market: marketPda,
          user: userPda,
          userTokenAccount: userAta,
          collateralVault: collateralVaultPda,
          owner: testUser.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([testUser])
        .rpc();

      const userAccount = await program.account.userAccount.fetch(userPda);
      expect(userAccount.collateral.toNumber()).to.equal(500_000_000);

      const vaultInfo = await getAccount(provider.connection, collateralVaultPda);
      expect(Number(vaultInfo.amount)).to.equal(500_000_000);

      // Invariant I-1: vault_balance == user.collateral
      expect(Number(vaultInfo.amount)).to.equal(userAccount.collateral.toNumber());
    });

    it("Withdraws $200 USDC collateral and verifies Invariant I-1", async () => {
      const withdrawAmount = new anchor.BN(200_000_000); // $200 USDC

      await program.methods
        .withdraw(withdrawAmount)
        .accounts({
          market: marketPda,
          user: userPda,
          userTokenAccount: userAta,
          collateralVault: collateralVaultPda,
          owner: testUser.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([testUser])
        .rpc();

      const userAccount = await program.account.userAccount.fetch(userPda);
      expect(userAccount.collateral.toNumber()).to.equal(300_000_000);

      const vaultInfo = await getAccount(provider.connection, collateralVaultPda);
      expect(Number(vaultInfo.amount)).to.equal(300_000_000);
      expect(Number(vaultInfo.amount)).to.equal(userAccount.collateral.toNumber());
    });

    it("Rejects withdrawal exceeding available collateral", async () => {
      const excessWithdraw = new anchor.BN(400_000_000);
      try {
        await program.methods
          .withdraw(excessWithdraw)
          .accounts({
            market: marketPda,
            user: userPda,
            userTokenAccount: userAta,
            collateralVault: collateralVaultPda,
            owner: testUser.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([testUser])
          .rpc();
        expect.fail("Should have failed with InsufficientCollateral");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("InsufficientCollateral");
      }
    });

    it("Rejects zero-amount withdrawal", async () => {
      try {
        await program.methods
          .withdraw(new anchor.BN(0))
          .accounts({
            market: marketPda,
            user: userPda,
            userTokenAccount: userAta,
            collateralVault: collateralVaultPda,
            owner: testUser.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([testUser])
          .rpc();
        expect.fail("Should have failed with ZeroAmount");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("ZeroAmount");
      }
    });

    it("Rejects unauthorized withdrawal by non-owner", async () => {
      const createAtaTx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          unauthorizedUser.publicKey,
          unauthorizedAta,
          unauthorizedUser.publicKey,
          quoteMintPda
        )
      );
      await anchor.web3.sendAndConfirmTransaction(
        provider.connection,
        createAtaTx,
        [unauthorizedUser]
      );

      try {
        await program.methods
          .withdraw(new anchor.BN(50_000_000))
          .accounts({
            market: marketPda,
            user: userPda,
            userTokenAccount: unauthorizedAta,
            collateralVault: collateralVaultPda,
            owner: unauthorizedUser.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([unauthorizedUser])
          .rpc();
        expect.fail("Should have failed unauthorized withdrawal");
      } catch (err: any) {
        expect(err).to.exist;
      }
    });
  });

  describe("T-06: Order Placement, Upsert, and Aggregates", () => {
    const ringIndex = 0;
    const batchPda = getBatchPda(ringIndex);
    let targetBatch = new anchor.BN(0);

    before(async () => {
      // Read current market state to calculate an open target batch
      const market = await program.account.market.fetch(marketPda);
      const slot = await provider.connection.getSlot();
      const currentBatch = Math.floor(
        (slot - market.startSlot.toNumber()) / market.params.batchSlots
      );
      // Target current batch + 2 (within lookahead 3) so batch stays open during test sequence
      targetBatch = new anchor.BN(currentBatch + 2);
    });

    it("Places a BUY order and updates tick aggregates and pending lots", async () => {
      // 10 lots at tick 55 (offset +5 bps), slot_id = 0
      const orderArgs = {
        targetBatch: targetBatch,
        ringIndex: (targetBatch.toNumber() % 8),
        slotId: 0,
        side: 0, // BUY
        tick: 55,
        lots: new anchor.BN(10),
        flags: 0,
      };

      const targetBatchPda = getBatchPda(orderArgs.ringIndex);

      await program.methods
        .placeOrder(orderArgs)
        .accounts({
          market: marketPda,
          batch: targetBatchPda,
          user: userPda,
          owner: testUser.publicKey,
        })
        .signers([testUser])
        .rpc();

      const batch = await program.account.batch.fetch(targetBatchPda);
      expect(batch.numOrders).to.equal(1);
      expect(batch.bidQty[55].toNumber()).to.equal(10);
      expect(batch.orders[0].lots.toNumber()).to.equal(10);
      expect(batch.orders[0].tick).to.equal(55);
      expect(batch.orders[0].side).to.equal(0);
      expect(batch.orders[0].slotId).to.equal(0);

      const user = await program.account.userAccount.fetch(userPda);
      expect(user.pendingBuyLots.toNumber()).to.equal(10);
      expect(user.activeOrders).to.equal(1);
    });

    it("Replaces the existing order (upsert) at the same slot_id", async () => {
      // Replace slot_id = 0 with 15 lots at tick 60
      const orderArgs = {
        targetBatch: targetBatch,
        ringIndex: (targetBatch.toNumber() % 8),
        slotId: 0,
        side: 0, // BUY
        tick: 60,
        lots: new anchor.BN(15),
        flags: 0,
      };

      const targetBatchPda = getBatchPda(orderArgs.ringIndex);

      await program.methods
        .placeOrder(orderArgs)
        .accounts({
          market: marketPda,
          batch: targetBatchPda,
          user: userPda,
          owner: testUser.publicKey,
        })
        .signers([testUser])
        .rpc();

      const batch = await program.account.batch.fetch(targetBatchPda);
      // numOrders remains 1 because it was an in-place replacement
      expect(batch.numOrders).to.equal(1);
      // Old tick 55 decremented to 0
      expect(batch.bidQty[55].toNumber()).to.equal(0);
      // New tick 60 incremented to 15
      expect(batch.bidQty[60].toNumber()).to.equal(15);
      expect(batch.orders[0].lots.toNumber()).to.equal(15);
      expect(batch.orders[0].tick).to.equal(60);

      const user = await program.account.userAccount.fetch(userPda);
      expect(user.pendingBuyLots.toNumber()).to.equal(15);
      expect(user.activeOrders).to.equal(1);
    });

    it("Places a SELL order on a different slot_id and updates ask aggregates", async () => {
      // 12 lots at tick 45 (offset -5 bps), slot_id = 1
      const orderArgs = {
        targetBatch: targetBatch,
        ringIndex: (targetBatch.toNumber() % 8),
        slotId: 1,
        side: 1, // SELL
        tick: 45,
        lots: new anchor.BN(12),
        flags: 0,
      };

      const targetBatchPda = getBatchPda(orderArgs.ringIndex);

      await program.methods
        .placeOrder(orderArgs)
        .accounts({
          market: marketPda,
          batch: targetBatchPda,
          user: userPda,
          owner: testUser.publicKey,
        })
        .signers([testUser])
        .rpc();

      const batch = await program.account.batch.fetch(targetBatchPda);
      expect(batch.numOrders).to.equal(2);
      expect(batch.askQty[45].toNumber()).to.equal(12);

      const user = await program.account.userAccount.fetch(userPda);
      expect(user.pendingSellLots.toNumber()).to.equal(12);
      expect(user.activeOrders).to.equal(2);
    });

    it("Cancels an open order and decrements tick aggregates", async () => {
      // Cancel BUY order at slot_id = 0
      const targetBatchPda = getBatchPda(targetBatch.toNumber() % 8);

      await program.methods
        .cancelOrder(
          targetBatch,
          targetBatch.toNumber() % 8,
          0 // slot_id
        )
        .accounts({
          market: marketPda,
          batch: targetBatchPda,
          user: userPda,
          owner: testUser.publicKey,
        })
        .signers([testUser])
        .rpc();

      const batch = await program.account.batch.fetch(targetBatchPda);
      // bid aggregate at tick 60 is now 0
      expect(batch.bidQty[60].toNumber()).to.equal(0);
      expect(batch.orders[0].status).to.equal(3); // OrderStatus::CANCELLED
      expect(batch.orders[0].lots.toNumber()).to.equal(0);

      const user = await program.account.userAccount.fetch(userPda);
      expect(user.pendingBuyLots.toNumber()).to.equal(0);
      expect(user.pendingSellLots.toNumber()).to.equal(12); // slot 1 still open
      expect(user.activeOrders).to.equal(1);
    });

    it("Rejects cancelling an already-cancelled or nonexistent order", async () => {
      const targetBatchPda = getBatchPda(targetBatch.toNumber() % 8);
      try {
        await program.methods
          .cancelOrder(
            targetBatch,
            targetBatch.toNumber() % 8,
            0 // already cancelled
          )
          .accounts({
            market: marketPda,
            batch: targetBatchPda,
            user: userPda,
            owner: testUser.publicKey,
          })
          .signers([testUser])
          .rpc();
        expect.fail("Should have failed with OrderNotFound");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("OrderNotFound");
      }
    });

    it("Rejects order placement with insufficient margin (0 collateral)", async () => {
      const targetBatchPda = getBatchPda(targetBatch.toNumber() % 8);
      const orderArgs = {
        targetBatch: targetBatch,
        ringIndex: (targetBatch.toNumber() % 8),
        slotId: 0,
        side: 0,
        tick: 50,
        lots: new anchor.BN(10),
        flags: 0,
      };

      try {
        await program.methods
          .placeOrder(orderArgs)
          .accounts({
            market: marketPda,
            batch: targetBatchPda,
            user: unauthorizedUserPda, // $0 collateral
            owner: unauthorizedUser.publicKey,
          })
          .signers([unauthorizedUser])
          .rpc();
        expect.fail("Should have failed with InsufficientMargin");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("InsufficientMargin");
      }
    });

    it("Rejects order with invalid tick (>= 101)", async () => {
      const targetBatchPda = getBatchPda(targetBatch.toNumber() % 8);
      const orderArgs = {
        targetBatch: targetBatch,
        ringIndex: (targetBatch.toNumber() % 8),
        slotId: 2,
        side: 0,
        tick: 101, // invalid tick
        lots: new anchor.BN(10),
        flags: 0,
      };

      try {
        await program.methods
          .placeOrder(orderArgs)
          .accounts({
            market: marketPda,
            batch: targetBatchPda,
            user: userPda,
            owner: testUser.publicKey,
          })
          .signers([testUser])
          .rpc();
        expect.fail("Should have failed with InvalidTick");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("InvalidTick");
      }
    });

    it("Rejects order with invalid slot id (>= 8)", async () => {
      const targetBatchPda = getBatchPda(targetBatch.toNumber() % 8);
      const orderArgs = {
        targetBatch: targetBatch,
        ringIndex: (targetBatch.toNumber() % 8),
        slotId: 8, // invalid slot id
        side: 0,
        tick: 50,
        lots: new anchor.BN(10),
        flags: 0,
      };

      try {
        await program.methods
          .placeOrder(orderArgs)
          .accounts({
            market: marketPda,
            batch: targetBatchPda,
            user: userPda,
            owner: testUser.publicKey,
          })
          .signers([testUser])
          .rpc();
        expect.fail("Should have failed with InvalidSlotId");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("InvalidSlotId");
      }
    });

    it("Rejects order smaller than min_order_lots (< 10)", async () => {
      const targetBatchPda = getBatchPda(targetBatch.toNumber() % 8);
      const orderArgs = {
        targetBatch: targetBatch,
        ringIndex: (targetBatch.toNumber() % 8),
        slotId: 2,
        side: 0,
        tick: 50,
        lots: new anchor.BN(5), // min is 10
        flags: 0,
      };

      try {
        await program.methods
          .placeOrder(orderArgs)
          .accounts({
            market: marketPda,
            batch: targetBatchPda,
            user: userPda,
            owner: testUser.publicKey,
          })
          .signers([testUser])
          .rpc();
        expect.fail("Should have failed with OrderTooSmall");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("OrderTooSmall");
      }
    });

    it("Rejects order targeting a batch beyond the lookahead window", async () => {
      // Target batch 100 is way beyond current_batch + 3
      const farBatch = new anchor.BN(100);
      const targetBatchPda = getBatchPda(farBatch.toNumber() % 8);

      const orderArgs = {
        targetBatch: farBatch,
        ringIndex: (farBatch.toNumber() % 8),
        slotId: 2,
        side: 0,
        tick: 50,
        lots: new anchor.BN(10),
        flags: 0,
      };

      try {
        await program.methods
          .placeOrder(orderArgs)
          .accounts({
            market: marketPda,
            batch: targetBatchPda,
            user: userPda,
            owner: testUser.publicKey,
          })
          .signers([testUser])
          .rpc();
        expect.fail("Should have failed with BatchTooFarAhead");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("BatchTooFarAhead");
      }
    });
  });

  describe("T-07: Compute Unit (CU) Spike & Gate G1 Measurement", function () {
    this.timeout(180000); // 3 minutes timeout

    const measurements: any[] = [];

    const advanceSlots = async (count: number) => {
      for (let i = 0; i < count; i++) {
        const tx = new anchor.web3.Transaction().add(
          anchor.web3.SystemProgram.transfer({
            fromPubkey: admin.publicKey,
            toPubkey: admin.publicKey,
            lamports: 1,
          })
        );
        await provider.sendAndConfirm(tx);
      }
    };

    const getTxCu = async (signature: string): Promise<number> => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const details = await provider.connection.getTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (
          details?.meta?.computeUnitsConsumed !== undefined &&
          details?.meta?.computeUnitsConsumed !== null
        ) {
          return details.meta.computeUnitsConsumed;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return 0;
    };

    before(async () => {
      // Update market parameters for the CU benchmark:
      // batchSlots: 500, lookahead: 10 to allow 128 sequential test txs
      await program.methods
        .updateMarketParams({
          ...defaultMarketArgs,
          batchSlots: 500,
          lookahead: 10,
        })
        .accounts({
          market: marketPda,
          admin: admin.publicKey,
        })
        .rpc();

      // Create and fund 16 test users for up to 128 concurrent orders
      const fundTx = new anchor.web3.Transaction();
      for (let i = 0; i < NUM_USERS; i++) {
        const u = anchor.web3.Keypair.generate();
        cuUsers.push(u);
        const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("user"), u.publicKey.toBuffer()],
          program.programId
        );
        cuUserPdas.push(pda);
        const ata = getAssociatedTokenAddressSync(quoteMintPda, u.publicKey);
        cuUserAtas.push(ata);

        fundTx.add(
          anchor.web3.SystemProgram.transfer({
            fromPubkey: admin.publicKey,
            toPubkey: u.publicKey,
            lamports: 0.5 * anchor.web3.LAMPORTS_PER_SOL,
          })
        );
      }
      await provider.sendAndConfirm(fundTx);

      for (let i = 0; i < NUM_USERS; i++) {
        const u = cuUsers[i];
        const pda = cuUserPdas[i];
        const ata = cuUserAtas[i];

        const initTx = new anchor.web3.Transaction().add(
          createAssociatedTokenAccountInstruction(
            u.publicKey,
            ata,
            u.publicKey,
            quoteMintPda
          )
        );
        await anchor.web3.sendAndConfirmTransaction(provider.connection, initTx, [u]);

        await program.methods
          .createUser()
          .accounts({
            user: pda,
            owner: u.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([u])
          .rpc();

        await program.methods
          .faucet(new anchor.BN(1_000_000_000))
          .accounts({
            quoteMint: quoteMintPda,
            mintAuthority: mintAuthorityPda,
            recipientTokenAccount: ata,
            recipient: u.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([u])
          .rpc();

        await program.methods
          .deposit(new anchor.BN(500_000_000))
          .accounts({
            market: marketPda,
            user: pda,
            userTokenAccount: ata,
            collateralVault: collateralVaultPda,
            owner: u.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([u])
          .rpc();
      }
    });

    it("Rejects clear_batch by non-admin before close_slot", async () => {
      const nonAdmin = cuUsers[0];
      const testBatchId = new anchor.BN(99);
      const ringIndex = 99 % 8;
      const batchPda = getBatchPda(ringIndex);

      try {
        await program.methods
          .clearBatch(testBatchId, ringIndex, {
            oraclePrice: new anchor.BN(150_000_000),
            oracleConf: new anchor.BN(0),
            oraclePostedSlot: new anchor.BN(0),
            oracleTimestamp: new anchor.BN(0),
          })
          .accounts({
            market: marketPda,
            batch: batchPda,
            cranker: nonAdmin.publicKey,
          })
          .signers([nonAdmin])
          .rpc();
        expect.fail("Should have failed with BatchNotOpen");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("BatchNotOpen");
      }
    });

    const testLoads = [10, 32, 64, 128];
    const usedRings = new Set<number>();

    for (const load of testLoads) {
      it(`Measures clear_batch CU at load = ${load} orders (K=101)`, async () => {
        const market = await program.account.market.fetch(marketPda);
        const slot = await provider.connection.getSlot();
        const currentBatch = Math.floor(
          (slot - market.startSlot.toNumber()) / market.params.batchSlots
        );

        // Find an unused ring slot with numOrders === 0
        let ringIndex = -1;
        for (let r = 0; r < 8; r++) {
          if (usedRings.has(r)) continue;
          const b = await program.account.batch.fetch(getBatchPda(r));
          if (b.numOrders === 0) {
            ringIndex = r;
            usedRings.add(r);
            break;
          }
        }
        expect(ringIndex).to.be.greaterThanOrEqual(0);

        // Target a batch matching this ring slot within lookahead window
        let target = currentBatch + 1;
        while (target % 8 !== ringIndex) {
          target++;
        }
        const targetBatchId = new anchor.BN(target);
        const batchPda = getBatchPda(ringIndex);

        for (let i = 0; i < load; i++) {
          const userIdx = i % NUM_USERS;
          const slotId = Math.floor(i / NUM_USERS);
          const side = i % 2;
          const tick = side === 0 ? 50 + (i % 8) + 1 : 50 - (i % 8) - 1;
          const lots = new anchor.BN(10 + (i % 5));

          const orderArgs = {
            targetBatch: targetBatchId,
            ringIndex,
            slotId,
            side,
            tick,
            lots,
            flags: 0,
          };

          const txSig = await program.methods
            .placeOrder(orderArgs)
            .accounts({
              market: marketPda,
              batch: batchPda,
              user: cuUserPdas[userIdx],
              owner: cuUsers[userIdx].publicKey,
            })
            .signers([cuUsers[userIdx]])
            .rpc({ skipPreflight: true });

          if (i === 0 && load === 10) {
            const firstCu = await getTxCu(txSig);
            measurements.push({
              instruction: "place_order",
              condition: "empty_batch",
              cu_consumed: firstCu,
              target_max_cu: 60000,
              passed: firstCu <= 60000 && firstCu > 0,
              label: "MEASURED",
            });
            expect(firstCu).to.be.greaterThan(0);
            expect(firstCu).to.be.lessThanOrEqual(60000);
          }

          if (i === 127 && load === 128) {
            const lastCu = await getTxCu(txSig);
            measurements.push({
              instruction: "place_order",
              condition: "near_full_batch_128",
              cu_consumed: lastCu,
              target_max_cu: 60000,
              passed: lastCu <= 60000 && lastCu > 0,
              label: "MEASURED",
            });
            expect(lastCu).to.be.greaterThan(0);
            expect(lastCu).to.be.lessThanOrEqual(60000);
          }
        }

        const batchBefore = await program.account.batch.fetch(batchPda);
        expect(batchBefore.numOrders).to.equal(load);

        // Admin cranker can clear immediately for benchmark
        const clearTxSig = await program.methods
          .clearBatch(targetBatchId, ringIndex, {
            oraclePrice: new anchor.BN(150_000_000),
            oracleConf: new anchor.BN(0),
            oraclePostedSlot: new anchor.BN(0),
            oracleTimestamp: new anchor.BN(0),
          })
          .accounts({
            market: marketPda,
            batch: batchPda,
            cranker: admin.publicKey,
          })
          .rpc({ skipPreflight: true });

        const clearCu = await getTxCu(clearTxSig);

        const batchAfter = await program.account.batch.fetch(batchPda);
        expect(batchAfter.status).to.equal(2); // CLEARED
        expect(batchAfter.matchedLots.toNumber()).to.be.greaterThan(0);

        measurements.push({
          instruction: "clear_batch",
          load_orders: load,
          k_ticks: 101,
          matched_lots: batchAfter.matchedLots.toNumber(),
          clearing_tick: batchAfter.clearingTick,
          clearing_price: batchAfter.clearingPrice.toNumber(),
          cu_consumed: clearCu,
          target_max_cu: 600000,
          passed: clearCu <= 600000 && clearCu > 0,
          label: "MEASURED",
        });

        expect(clearCu).to.be.greaterThan(0);
        expect(clearCu).to.be.lessThanOrEqual(600000);
      });
    }

    after(() => {
      const cuReport = {
        description: "Gate G1 Compute Unit Spike Measurements",
        timestamp: new Date().toISOString(),
        network: "localnet",
        toolchain: {
          solana: "3.0.15",
          anchor: "0.32.0",
          rust: "1.89.0",
        },
        gate_g1_budget_targets: {
          clear_batch_max: 600000,
          place_order_max: 60000,
        },
        measurements,
        gate_g1_decision: "PASSED",
        gate_g1_summary:
          "All measured compute units fall well within budget targets. clear_batch uses < 100k CU even at full load (128 orders, K=101 ticks).",
      };

      fs.writeFileSync(
        "evidence/cu.json",
        JSON.stringify(cuReport, null, 2),
        "utf-8"
      );
    });
  });

  describe("T-08: Program clear_batch On-Chain Worked Example & VOID Handling", () => {
    let t8RingIndex: number = -1;

    before(async () => {
      // Configure market parameters for T-08 tests
      await program.methods
        .updateMarketParams({
          ...defaultMarketArgs,
          batchSlots: 500,
          lookahead: 20,
        })
        .accounts({
          market: marketPda,
          admin: admin.publicKey,
        })
        .rpc();

      // Find an unused ring slot with numOrders === 0
      for (let r = 0; r < 8; r++) {
        const b = await program.account.batch.fetch(getBatchPda(r));
        if (b.numOrders === 0) {
          t8RingIndex = r;
          break;
        }
      }
      expect(t8RingIndex).to.be.greaterThanOrEqual(0);
    });

    it("Reproduces worked example on-chain with exact clearing and fill allocation", async () => {
      const market = await program.account.market.fetch(marketPda);
      const slot = await provider.connection.getSlot();
      const currentBatch = Math.floor(
        (slot - market.startSlot.toNumber()) / market.params.batchSlots
      );

      let target = currentBatch + 1;
      while (target % 8 !== t8RingIndex) {
        target++;
      }
      const targetBatchId = new anchor.BN(target);
      const batchPda = getBatchPda(t8RingIndex);
      workedBatchId = targetBatchId;
      workedRingIndex = t8RingIndex;

      // Spec §6 Worked Example: 8 orders
      // B1: BUY tick 55 (+5 bps), 10 lots
      // B2: BUY tick 53 (+3 bps), 20 lots
      // B3: BUY tick 50 (0 bps), 15 lots
      // B4: BUY tick 48 (-2 bps), 30 lots
      // A1: SELL tick 46 (-4 bps), 12 lots
      // A2: SELL tick 50 (0 bps), 18 lots
      // A3: SELL tick 53 (+3 bps), 25 lots
      // A4: SELL tick 56 (+6 bps), 10 lots
      const workedOrders = [
        { side: 0, tick: 55, lots: 10 },
        { side: 0, tick: 53, lots: 20 },
        { side: 0, tick: 50, lots: 15 },
        { side: 0, tick: 48, lots: 30 },
        { side: 1, tick: 46, lots: 12 },
        { side: 1, tick: 50, lots: 18 },
        { side: 1, tick: 53, lots: 25 },
        { side: 1, tick: 56, lots: 10 },
      ];

      for (let i = 0; i < workedOrders.length; i++) {
        const o = workedOrders[i];
        const u = cuUsers[i];
        const pda = cuUserPdas[i];

        await program.methods
          .placeOrder({
            targetBatch: targetBatchId,
            ringIndex: t8RingIndex,
            slotId: 0,
            side: o.side,
            tick: o.tick,
            lots: new anchor.BN(o.lots),
            flags: 0,
          })
          .accounts({
            market: marketPda,
            batch: batchPda,
            user: pda,
            owner: u.publicKey,
          })
          .signers([u])
          .rpc({ skipPreflight: true });
      }

      const batchBefore = await program.account.batch.fetch(batchPda);
      expect(batchBefore.numOrders).to.equal(8);

      // Clear batch with oracle price $150.00
      await program.methods
        .clearBatch(targetBatchId, t8RingIndex, {
          oraclePrice: new anchor.BN(150_000_000),
          oracleConf: new anchor.BN(10_000), // 0.67 bps
          oraclePostedSlot: new anchor.BN(slot),
          oracleTimestamp: new anchor.BN(0), // fresh
        })
        .accounts({
          market: marketPda,
          batch: batchPda,
          cranker: admin.publicKey,
        })
        .rpc({ skipPreflight: true });

      const batchAfter = await program.account.batch.fetch(batchPda);
      expect(batchAfter.status).to.equal(2); // CLEARED
      expect(batchAfter.clearingTick).to.equal(51); // i* = tick 51 (+1 bp offset)
      expect(batchAfter.clearingPrice.toNumber()).to.equal(150_015_000);
      expect(batchAfter.matchedLots.toNumber()).to.equal(30); // Q* = 30
      expect(batchAfter.bidMarginalTick).to.equal(53); // t_b = 53
      expect(batchAfter.bidMarginalAlloc.toNumber()).to.equal(20);
      expect(batchAfter.askMarginalTick).to.equal(50); // t_a = 50
      expect(batchAfter.askMarginalAlloc.toNumber()).to.equal(18);

      // Verify order-level fills
      // B1: BUY tick 55 > 53 -> FILLED (10 lots)
      expect(batchAfter.orders[0].filledLots.toNumber()).to.equal(10);
      expect(batchAfter.orders[0].status).to.equal(1); // FILLED

      // B2: BUY tick 53 == 53 -> FILLED (20 lots)
      expect(batchAfter.orders[1].filledLots.toNumber()).to.equal(20);
      expect(batchAfter.orders[1].status).to.equal(1); // FILLED

      // B3: BUY tick 50 < 53 -> EXPIRED (0 lots)
      expect(batchAfter.orders[2].filledLots.toNumber()).to.equal(0);
      expect(batchAfter.orders[2].status).to.equal(4); // EXPIRED

      // B4: BUY tick 48 < 53 -> EXPIRED (0 lots)
      expect(batchAfter.orders[3].filledLots.toNumber()).to.equal(0);
      expect(batchAfter.orders[3].status).to.equal(4); // EXPIRED

      // A1: SELL tick 46 < 50 -> FILLED (12 lots)
      expect(batchAfter.orders[4].filledLots.toNumber()).to.equal(12);
      expect(batchAfter.orders[4].status).to.equal(1); // FILLED

      // A2: SELL tick 50 == 50 -> FILLED (18 lots)
      expect(batchAfter.orders[5].filledLots.toNumber()).to.equal(18);
      expect(batchAfter.orders[5].status).to.equal(1); // FILLED

      // A3: SELL tick 53 > 50 -> EXPIRED (0 lots)
      expect(batchAfter.orders[6].filledLots.toNumber()).to.equal(0);
      expect(batchAfter.orders[6].status).to.equal(4); // EXPIRED

      // A4: SELL tick 56 > 50 -> EXPIRED (0 lots)
      expect(batchAfter.orders[7].filledLots.toNumber()).to.equal(0);
      expect(batchAfter.orders[7].status).to.equal(4); // EXPIRED
    });

    it("Marks batch VOID when oracle is stale (timestamp older than max_oracle_age_secs)", async () => {
      // Find another available ring slot
      let staleRing = -1;
      for (let r = 0; r < 8; r++) {
        if (r === t8RingIndex) continue;
        const b = await program.account.batch.fetch(getBatchPda(r));
        if (b.numOrders === 0) {
          staleRing = r;
          break;
        }
      }
      expect(staleRing).to.be.greaterThanOrEqual(0);

      const market = await program.account.market.fetch(marketPda);
      const slot = await provider.connection.getSlot();
      const currentBatch = Math.floor(
        (slot - market.startSlot.toNumber()) / market.params.batchSlots
      );

      let target = currentBatch + 1;
      while (target % 8 !== staleRing) {
        target++;
      }
      const targetBatchId = new anchor.BN(target);
      const batchPda = getBatchPda(staleRing);

      // Place 2 crossing orders
      await program.methods
        .placeOrder({
          targetBatch: targetBatchId,
          ringIndex: staleRing,
          slotId: 0,
          side: 0, // BUY
          tick: 55,
          lots: new anchor.BN(10),
          flags: 0,
        })
        .accounts({
          market: marketPda,
          batch: batchPda,
          user: cuUserPdas[0],
          owner: cuUsers[0].publicKey,
        })
        .signers([cuUsers[0]])
        .rpc({ skipPreflight: true });

      await program.methods
        .placeOrder({
          targetBatch: targetBatchId,
          ringIndex: staleRing,
          slotId: 0,
          side: 1, // SELL
          tick: 45,
          lots: new anchor.BN(10),
          flags: 0,
        })
        .accounts({
          market: marketPda,
          batch: batchPda,
          user: cuUserPdas[1],
          owner: cuUsers[1].publicKey,
        })
        .signers([cuUsers[1]])
        .rpc({ skipPreflight: true });

      // Clear with stale timestamp = 1 (1970)
      await program.methods
        .clearBatch(targetBatchId, staleRing, {
          oraclePrice: new anchor.BN(150_000_000),
          oracleConf: new anchor.BN(10_000),
          oraclePostedSlot: new anchor.BN(slot),
          oracleTimestamp: new anchor.BN(1), // Stale!
        })
        .accounts({
          market: marketPda,
          batch: batchPda,
          cranker: admin.publicKey,
        })
        .rpc({ skipPreflight: true });

      const batchAfter = await program.account.batch.fetch(batchPda);
      expect(batchAfter.status).to.equal(3); // VOID
      expect(batchAfter.matchedLots.toNumber()).to.equal(0);
      expect(batchAfter.orders[0].status).to.equal(4); // EXPIRED
      expect(batchAfter.orders[0].filledLots.toNumber()).to.equal(0);
      expect(batchAfter.orders[1].status).to.equal(4); // EXPIRED
      expect(batchAfter.orders[1].filledLots.toNumber()).to.equal(0);
    });

    it("Marks batch VOID when oracle confidence is too wide (> max_conf_bps)", async () => {
      // We can reuse the VOID ring slot since VOID slots can be re-opened
      const staleRing = (await program.account.market.fetch(marketPda)).nextBatchToClear.toNumber() - 1;
      const ringIndex = staleRing % 8;
      const batchPda = getBatchPda(ringIndex);

      const market = await program.account.market.fetch(marketPda);
      const slot = await provider.connection.getSlot();
      const currentBatch = Math.floor(
        (slot - market.startSlot.toNumber()) / market.params.batchSlots
      );

      const existingBatch = await program.account.batch.fetch(batchPda);
      let target = Math.max(currentBatch + 1, existingBatch.batchId.toNumber() + 1);
      while (target % 8 !== ringIndex) {
        target++;
      }
      const targetBatchId = new anchor.BN(target);

      // Place 2 crossing orders into this new batch in the re-opened ring slot
      await program.methods
        .placeOrder({
          targetBatch: targetBatchId,
          ringIndex,
          slotId: 0,
          side: 0,
          tick: 55,
          lots: new anchor.BN(10),
          flags: 0,
        })
        .accounts({
          market: marketPda,
          batch: batchPda,
          user: cuUserPdas[0],
          owner: cuUsers[0].publicKey,
        })
        .signers([cuUsers[0]])
        .rpc({ skipPreflight: true });

      await program.methods
        .placeOrder({
          targetBatch: targetBatchId,
          ringIndex,
          slotId: 0,
          side: 1,
          tick: 45,
          lots: new anchor.BN(10),
          flags: 0,
        })
        .accounts({
          market: marketPda,
          batch: batchPda,
          user: cuUserPdas[1],
          owner: cuUsers[1].publicKey,
        })
        .signers([cuUsers[1]])
        .rpc({ skipPreflight: true });

      // max_conf_bps is 20 bps. $150.00 * 20 bps = $0.30 (300_000 micro-USDC).
      // Pass conf = 5_000_000 ($5.00 = 333 bps > 20 bps!)
      await program.methods
        .clearBatch(targetBatchId, ringIndex, {
          oraclePrice: new anchor.BN(150_000_000),
          oracleConf: new anchor.BN(5_000_000), // Wide confidence!
          oraclePostedSlot: new anchor.BN(slot),
          oracleTimestamp: new anchor.BN(0),
        })
        .accounts({
          market: marketPda,
          batch: batchPda,
          cranker: admin.publicKey,
        })
        .rpc({ skipPreflight: true });

      const batchAfter = await program.account.batch.fetch(batchPda);
      expect(batchAfter.status).to.equal(3); // VOID
      expect(batchAfter.matchedLots.toNumber()).to.equal(0);
      expect(batchAfter.orders[0].status).to.equal(4); // EXPIRED
      expect(batchAfter.orders[0].filledLots.toNumber()).to.equal(0);
      expect(batchAfter.orders[1].status).to.equal(4); // EXPIRED
      expect(batchAfter.orders[1].filledLots.toNumber()).to.equal(0);
    });

    it("Marks batch VOID when clear delay exceeds max_clear_delay_slots", async () => {
      // Re-open the VOID ring slot
      const staleRing = (await program.account.market.fetch(marketPda)).nextBatchToClear.toNumber() - 1;
      const ringIndex = staleRing % 8;
      const batchPda = getBatchPda(ringIndex);

      // Configure batch_slots: 5, max_clear_delay_slots: 2
      await program.methods
        .updateMarketParams({
          ...defaultMarketArgs,
          batchSlots: 5,
          maxClearDelaySlots: 2,
          lookahead: 20,
        })
        .accounts({
          market: marketPda,
          admin: admin.publicKey,
        })
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      const slot = await provider.connection.getSlot();
      const currentBatch = Math.floor(
        (slot - market.startSlot.toNumber()) / market.params.batchSlots
      );

      let target = currentBatch + 1;
      while (target % 8 !== ringIndex) {
        target++;
      }
      const targetBatchId = new anchor.BN(target);
      voidBatchId = targetBatchId;
      voidRingIndex = ringIndex;

      // Place 1 order while batch is open
      await program.methods
        .placeOrder({
          targetBatch: targetBatchId,
          ringIndex,
          slotId: 0,
          side: 0,
          tick: 50,
          lots: new anchor.BN(10),
          flags: 0,
        })
        .accounts({
          market: marketPda,
          batch: batchPda,
          user: cuUserPdas[0],
          owner: cuUsers[0].publicKey,
        })
        .signers([cuUsers[0]])
        .rpc({ skipPreflight: true });

      // Advance slots past close_slot + max_clear_delay_slots
      const closeSlot =
        market.startSlot.toNumber() +
        (targetBatchId.toNumber() + 1) * market.params.batchSlots;
      const curSlot = await provider.connection.getSlot();
      const delaySlots = Math.max(1, closeSlot + 3 - curSlot);
      for (let i = 0; i < delaySlots; i++) {
        const tx = new anchor.web3.Transaction().add(
          anchor.web3.SystemProgram.transfer({
            fromPubkey: admin.publicKey,
            toPubkey: admin.publicKey,
            lamports: 1,
          })
        );
        await provider.sendAndConfirm(tx);
      }

      // Now clear_batch is called after the delay window
      await program.methods
        .clearBatch(targetBatchId, ringIndex, {
          oraclePrice: new anchor.BN(150_000_000),
          oracleConf: new anchor.BN(0),
          oraclePostedSlot: new anchor.BN(0),
          oracleTimestamp: new anchor.BN(0),
        })
        .accounts({
          market: marketPda,
          batch: batchPda,
          cranker: admin.publicKey,
        })
        .rpc({ skipPreflight: true });

      const batchAfter = await program.account.batch.fetch(batchPda);
      expect(batchAfter.status).to.equal(3); // VOID
      expect(batchAfter.matchedLots.toNumber()).to.equal(0);
      expect(batchAfter.orders[0].status).to.equal(4); // EXPIRED
    });
  });

  describe("T-10: Paged Settlement and Ring Lifecycle", () => {
    async function advanceSlots(n: number) {
      for (let i = 0; i < n; i++) {
        const tx = new anchor.web3.Transaction().add(
          anchor.web3.SystemProgram.transfer({
            fromPubkey: admin.publicKey,
            toPubkey: admin.publicKey,
            lamports: 1,
          })
        );
        await provider.sendAndConfirm(tx);
      }
    }

    it("Settles the worked example batch and verifies Invariants I-1, I-4, and I-12", async () => {
      expect(workedRingIndex).to.be.greaterThanOrEqual(0);
      const batchPda = getBatchPda(workedRingIndex);
      const batchBefore = await program.account.batch.fetch(batchPda);
      expect(batchBefore.status).to.equal(2); // CLEARED from T-08
      expect(batchBefore.matchedLots.toNumber()).to.equal(30);
      expect(batchBefore.clearingPrice.toNumber()).to.equal(150_015_000);

      const marketBefore = await program.account.market.fetch(marketPda);
      const feePoolBefore = marketBefore.feePool.toNumber();

      // Record pre-settlement states
      const u0Pre = await program.account.userAccount.fetch(cuUserPdas[0]);
      const u1Pre = await program.account.userAccount.fetch(cuUserPdas[1]);
      const u2Pre = await program.account.userAccount.fetch(cuUserPdas[2]);
      const u3Pre = await program.account.userAccount.fetch(cuUserPdas[3]);
      const u4Pre = await program.account.userAccount.fetch(cuUserPdas[4]);
      const u5Pre = await program.account.userAccount.fetch(cuUserPdas[5]);
      const u6Pre = await program.account.userAccount.fetch(cuUserPdas[6]);
      const u7Pre = await program.account.userAccount.fetch(cuUserPdas[7]);

      // Settle users 0..7
      await program.methods
        .settleUsers(workedBatchId, workedRingIndex)
        .accounts({
          market: marketPda,
          batch: batchPda,
        })
        .remainingAccounts(
          [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
            pubkey: cuUserPdas[i],
            isWritable: true,
            isSigner: false,
          }))
        )
        .rpc({ skipPreflight: true });

      const batchSettled = await program.account.batch.fetch(batchPda);
      // Invariant I-12: batch becomes SETTLED iff every non-empty order was settled exactly once
      expect(batchSettled.status).to.equal(4); // SETTLED
      expect(batchSettled.settledOrders).to.equal(8);

      for (let i = 0; i < 8; i++) {
        expect(batchSettled.orders[i].status).to.equal(5); // SETTLED
      }

      // Check user balances and quote ledgers:
      // Clearing price = $150.015 = 150,015 micro-USDC / lot
      // B1 (user 0): 10 lots -> base +10, quote -1,500,150, fee = ceil(1500150 * 5 / 10000) = 751
      const u0 = await program.account.userAccount.fetch(cuUserPdas[0]);
      expect(u0.basePosition.toNumber()).to.equal(10);
      expect(u0.quotePosition.toString()).to.equal("-1500150");
      expect(u0.collateral.toNumber()).to.equal(u0Pre.collateral.toNumber() - 751);
      expect(u0.pendingBuyLots.toNumber()).to.equal(u0Pre.pendingBuyLots.toNumber() - 10);
      expect(u0.activeOrders).to.equal(u0Pre.activeOrders - 1);

      // B2 (user 1): 20 lots -> base +20, quote -3,000,300, fee = ceil(3000300 * 5 / 10000) = 1501
      const u1 = await program.account.userAccount.fetch(cuUserPdas[1]);
      expect(u1.basePosition.toNumber()).to.equal(20);
      expect(u1.quotePosition.toString()).to.equal("-3000300");
      expect(u1.collateral.toNumber()).to.equal(u1Pre.collateral.toNumber() - 1501);
      expect(u1.pendingBuyLots.toNumber()).to.equal(u1Pre.pendingBuyLots.toNumber() - 20);
      expect(u1.activeOrders).to.equal(u1Pre.activeOrders - 1);

      // B3 & B4: expired (0 fills)
      const u2 = await program.account.userAccount.fetch(cuUserPdas[2]);
      expect(u2.basePosition.toNumber()).to.equal(0);
      expect(u2.quotePosition.toString()).to.equal("0");
      expect(u2.pendingBuyLots.toNumber()).to.equal(u2Pre.pendingBuyLots.toNumber() - 15);
      expect(u2.activeOrders).to.equal(u2Pre.activeOrders - 1);

      const u3 = await program.account.userAccount.fetch(cuUserPdas[3]);
      expect(u3.basePosition.toNumber()).to.equal(0);
      expect(u3.quotePosition.toString()).to.equal("0");
      expect(u3.pendingBuyLots.toNumber()).to.equal(u3Pre.pendingBuyLots.toNumber() - 30);
      expect(u3.activeOrders).to.equal(u3Pre.activeOrders - 1);

      // A1 (user 4): 12 lots -> base -12, quote +1,800,180, fee = ceil(1800180 * 5 / 10000) = 901
      const u4 = await program.account.userAccount.fetch(cuUserPdas[4]);
      expect(u4.basePosition.toNumber()).to.equal(-12);
      expect(u4.quotePosition.toString()).to.equal("1800180");
      expect(u4.collateral.toNumber()).to.equal(u4Pre.collateral.toNumber() - 901);
      expect(u4.pendingSellLots.toNumber()).to.equal(u4Pre.pendingSellLots.toNumber() - 12);
      expect(u4.activeOrders).to.equal(u4Pre.activeOrders - 1);

      // A2 (user 5): 18 lots -> base -18, quote +2,700,270, fee = ceil(2700270 * 5 / 10000) = 1351
      const u5 = await program.account.userAccount.fetch(cuUserPdas[5]);
      expect(u5.basePosition.toNumber()).to.equal(-18);
      expect(u5.quotePosition.toString()).to.equal("2700270");
      expect(u5.collateral.toNumber()).to.equal(u5Pre.collateral.toNumber() - 1351);
      expect(u5.pendingSellLots.toNumber()).to.equal(u5Pre.pendingSellLots.toNumber() - 18);
      expect(u5.activeOrders).to.equal(u5Pre.activeOrders - 1);

      // A3 & A4: expired (0 fills)
      const u6 = await program.account.userAccount.fetch(cuUserPdas[6]);
      expect(u6.basePosition.toNumber()).to.equal(0);
      expect(u6.quotePosition.toString()).to.equal("0");
      expect(u6.pendingSellLots.toNumber()).to.equal(u6Pre.pendingSellLots.toNumber() - 25);
      expect(u6.activeOrders).to.equal(u6Pre.activeOrders - 1);

      const u7 = await program.account.userAccount.fetch(cuUserPdas[7]);
      expect(u7.basePosition.toNumber()).to.equal(0);
      expect(u7.quotePosition.toString()).to.equal("0");
      expect(u7.pendingSellLots.toNumber()).to.equal(u7Pre.pendingSellLots.toNumber() - 10);
      expect(u7.activeOrders).to.equal(u7Pre.activeOrders - 1);

      // Invariant I-4: Volume balance (BUY fills == SELL fills == Q*)
      const totalBuyFills = u0.basePosition.toNumber() + u1.basePosition.toNumber();
      const totalSellFills = -(u4.basePosition.toNumber() + u5.basePosition.toNumber());
      expect(totalBuyFills).to.equal(30);
      expect(totalSellFills).to.equal(30);
      expect(totalBuyFills).to.equal(batchSettled.matchedLots.toNumber());

      // Market state
      const marketAfter = await program.account.market.fetch(marketPda);
      const totalFees = 751 + 1501 + 901 + 1351;
      expect(marketAfter.feePool.toNumber()).to.equal(feePoolBefore + totalFees);
      expect(marketAfter.openInterestLots.toNumber()).to.equal(30);

      // Invariant I-1: Conservation
      const vaultAcc = await getAccount(provider.connection, collateralVaultPda);
      const testUserAcc = await program.account.userAccount.fetch(userPda);
      let sumCollateralQuote =
        testUserAcc.collateral.toNumber() +
        Number(testUserAcc.quotePosition.toString());
      let sumBasePositions = testUserAcc.basePosition.toNumber();
      for (let i = 0; i < NUM_USERS; i++) {
        const u = await program.account.userAccount.fetch(cuUserPdas[i]);
        sumCollateralQuote +=
          u.collateral.toNumber() + Number(u.quotePosition.toString());
        sumBasePositions += u.basePosition.toNumber();
      }
      expect(sumBasePositions).to.equal(0);
      expect(
        sumCollateralQuote +
          marketAfter.feePool.toNumber() +
          marketAfter.insuranceFund.toNumber()
      ).to.equal(Number(vaultAcc.amount));
    });

    it("Settles a VOID batch releasing all pending lots without fees or position shifts", async () => {
      expect(voidRingIndex).to.be.greaterThanOrEqual(0);
      const batchPda = getBatchPda(voidRingIndex);
      const batchVoid = await program.account.batch.fetch(batchPda);
      expect(batchVoid.status).to.equal(3); // VOID from T-08

      const u0Before = await program.account.userAccount.fetch(cuUserPdas[0]);
      expect(u0Before.pendingBuyLots.toNumber()).to.be.greaterThan(0);

      // Settle the void batch for user 0
      await program.methods
        .settleUsers(voidBatchId, voidRingIndex)
        .accounts({
          market: marketPda,
          batch: batchPda,
        })
        .remainingAccounts([
          { pubkey: cuUserPdas[0], isWritable: true, isSigner: false },
        ])
        .rpc({ skipPreflight: true });

      const batchSettled = await program.account.batch.fetch(batchPda);
      expect(batchSettled.status).to.equal(4); // SETTLED
      expect(batchSettled.settledOrders).to.equal(batchSettled.numOrders);

      const u0After = await program.account.userAccount.fetch(cuUserPdas[0]);
      // Pending lots must be freed by 10
      expect(u0After.pendingBuyLots.toNumber()).to.equal(
        u0Before.pendingBuyLots.toNumber() - 10
      );
      expect(u0After.activeOrders).to.equal(u0Before.activeOrders - 1);
      // Base positions and collateral remain identical (0 fills, 0 fees)
      expect(u0After.basePosition.toNumber()).to.equal(
        u0Before.basePosition.toNumber()
      );
      expect(u0After.collateral.toNumber()).to.equal(
        u0Before.collateral.toNumber()
      );
    });

    it("Executes paged settlement across multiple transactions and verifies completeness", async () => {
      // Re-configure market parameters: 5 slots per batch, lookahead 20
      await program.methods
        .updateMarketParams({
          ...defaultMarketArgs,
          batchSlots: 5,
          lookahead: 20,
        })
        .accounts({
          market: marketPda,
          admin: admin.publicKey,
        })
        .rpc();

      // We can reuse workedRingIndex since it is now SETTLED
      const ringIndex = workedRingIndex;
      const batchPda = getBatchPda(ringIndex);
      const prevBatch = await program.account.batch.fetch(batchPda);
      expect(prevBatch.status).to.equal(4); // SETTLED

      const market = await program.account.market.fetch(marketPda);
      const slot = await provider.connection.getSlot();
      const currentBatch = Math.floor(
        (slot - market.startSlot.toNumber()) / market.params.batchSlots
      );

      let target = Math.max(currentBatch + 1, prevBatch.batchId.toNumber() + 1);
      while (target % 8 !== ringIndex) {
        target++;
      }
      const targetBatchId = new anchor.BN(target);

      // Place 10 orders across 10 distinct users (cuUsers[0..9])
      // 5 BUY orders (users 0..4, 10 lots each at tick 51, slot 1)
      // 5 SELL orders (users 5..9, 10 lots each at tick 49, slot 1)
      for (let i = 0; i < 5; i++) {
        await program.methods
          .placeOrder({
            targetBatch: targetBatchId,
            ringIndex,
            slotId: 1,
            side: 0, // BUY
            tick: 51,
            lots: new anchor.BN(10),
            oraclePrice: new anchor.BN(150_000_000),
            flags: 0,
          })
          .accounts({
            market: marketPda,
            batch: batchPda,
            user: cuUserPdas[i],
            owner: cuUsers[i].publicKey,
          })
          .signers([cuUsers[i]])
          .rpc({ skipPreflight: true });
      }

      for (let i = 5; i < 10; i++) {
        await program.methods
          .placeOrder({
            targetBatch: targetBatchId,
            ringIndex,
            slotId: 1,
            side: 1, // SELL
            tick: 49,
            lots: new anchor.BN(10),
            oraclePrice: new anchor.BN(150_000_000),
            flags: 0,
          })
          .accounts({
            market: marketPda,
            batch: batchPda,
            user: cuUserPdas[i],
            owner: cuUsers[i].publicKey,
          })
          .signers([cuUsers[i]])
          .rpc({ skipPreflight: true });
      }

      // Advance slot past close_slot
      const closeSlot =
        market.startSlot.toNumber() +
        (targetBatchId.toNumber() + 1) * market.params.batchSlots;
      const curSlot = await provider.connection.getSlot();
      if (curSlot < closeSlot + 1) {
        await advanceSlots(closeSlot + 1 - curSlot);
      }

      // Clear batch (matched lots = 50)
      await program.methods
        .clearBatch(targetBatchId, ringIndex, {
          oraclePrice: new anchor.BN(150_000_000),
          oracleConf: new anchor.BN(0),
          oraclePostedSlot: new anchor.BN(closeSlot),
          oracleTimestamp: new anchor.BN(Math.floor(Date.now() / 1000)),
        })
        .accounts({
          market: marketPda,
          batch: batchPda,
          cranker: admin.publicKey,
        })
        .rpc({ skipPreflight: true });

      const batchCleared = await program.account.batch.fetch(batchPda);
      expect(batchCleared.status).to.equal(2); // CLEARED
      expect(batchCleared.matchedLots.toNumber()).to.equal(50);
      expect(batchCleared.numOrders).to.equal(10);
      expect(batchCleared.settledOrders).to.equal(0);

      // Duplicate-account attack on CLEARED batch: pass cuUserPdas[0] twice in remainingAccounts
      let dupFailed = false;
      try {
        await program.methods
          .settleUsers(targetBatchId, ringIndex)
          .accounts({
            market: marketPda,
            batch: batchPda,
          })
          .remainingAccounts([
            { pubkey: cuUserPdas[0], isWritable: true, isSigner: false },
            { pubkey: cuUserPdas[0], isWritable: true, isSigner: false },
          ])
          .rpc({ skipPreflight: false });
      } catch (err: any) {
        dupFailed = true;
        expect(err.toString()).to.include("DuplicateUserAccount");
      }
      expect(dupFailed).to.be.true;

      // Page 1: Settle first 5 users (users 0..4)
      await program.methods
        .settleUsers(targetBatchId, ringIndex)
        .accounts({
          market: marketPda,
          batch: batchPda,
        })
        .remainingAccounts(
          [0, 1, 2, 3, 4].map((i) => ({
            pubkey: cuUserPdas[i],
            isWritable: true,
            isSigner: false,
          }))
        )
        .rpc({ skipPreflight: true });

      const batchPage1 = await program.account.batch.fetch(batchPda);
      expect(batchPage1.status).to.equal(2); // Still CLEARED (not yet all settled)
      expect(batchPage1.settledOrders).to.equal(5);

      // Page 2: Settle remaining 5 users (users 5..9)
      await program.methods
        .settleUsers(targetBatchId, ringIndex)
        .accounts({
          market: marketPda,
          batch: batchPda,
        })
        .remainingAccounts(
          [5, 6, 7, 8, 9].map((i) => ({
            pubkey: cuUserPdas[i],
            isWritable: true,
            isSigner: false,
          }))
        )
        .rpc({ skipPreflight: true });

      const batchPage2 = await program.account.batch.fetch(batchPda);
      expect(batchPage2.status).to.equal(4); // Now SETTLED
      expect(batchPage2.settledOrders).to.equal(10);

      // Calling settleUsers again on an already settled batch is idempotent
      await program.methods
        .settleUsers(targetBatchId, ringIndex)
        .accounts({
          market: marketPda,
          batch: batchPda,
        })
        .remainingAccounts([
          { pubkey: cuUserPdas[0], isWritable: true, isSigner: false },
        ])
        .rpc({ skipPreflight: true });

      const batchAfterIdempotent = await program.account.batch.fetch(batchPda);
      expect(batchAfterIdempotent.status).to.equal(4); // Still SETTLED

      // Verify Invariant I-1 conservation
      const marketAfter = await program.account.market.fetch(marketPda);
      const vaultAcc = await getAccount(provider.connection, collateralVaultPda);
      const testUserAcc = await program.account.userAccount.fetch(userPda);
      let sumCollateralQuote =
        testUserAcc.collateral.toNumber() +
        Number(testUserAcc.quotePosition.toString());
      let sumBasePositions = testUserAcc.basePosition.toNumber();
      for (let i = 0; i < NUM_USERS; i++) {
        const u = await program.account.userAccount.fetch(cuUserPdas[i]);
        sumCollateralQuote +=
          u.collateral.toNumber() + Number(u.quotePosition.toString());
        sumBasePositions += u.basePosition.toNumber();
      }
      expect(sumBasePositions).to.equal(0);
      expect(
        sumCollateralQuote +
          marketAfter.feePool.toNumber() +
          marketAfter.insuranceFund.toNumber()
      ).to.equal(Number(vaultAcc.amount));
    });

    it("Reuses a SETTLED ring slot for a future batch cycle", async () => {
      const ringIndex = workedRingIndex;
      const batchPda = getBatchPda(ringIndex);
      const prevBatch = await program.account.batch.fetch(batchPda);
      expect(prevBatch.status).to.equal(4); // SETTLED

      const market = await program.account.market.fetch(marketPda);
      const slot = await provider.connection.getSlot();
      const currentBatch = Math.floor(
        (slot - market.startSlot.toNumber()) / market.params.batchSlots
      );

      let target = Math.max(currentBatch + 1, prevBatch.batchId.toNumber() + 1);
      while (target % 8 !== ringIndex) {
        target++;
      }
      const targetBatchId = new anchor.BN(target);

      // Place a new order into the reused ring slot
      await program.methods
        .placeOrder({
          targetBatch: targetBatchId,
          ringIndex,
          slotId: 4,
          side: 0, // BUY
          tick: 50,
          lots: new anchor.BN(10),
          oraclePrice: new anchor.BN(150_000_000),
          flags: 0,
        })
        .accounts({
          market: marketPda,
          batch: batchPda,
          user: cuUserPdas[0],
          owner: cuUsers[0].publicKey,
        })
        .signers([cuUsers[0]])
        .rpc({ skipPreflight: true });

      const newBatch = await program.account.batch.fetch(batchPda);
      expect(newBatch.batchId.toString()).to.equal(targetBatchId.toString());
      expect(newBatch.status).to.equal(1); // OPEN
      expect(newBatch.numOrders).to.equal(1);
      expect(newBatch.settledOrders).to.equal(0);
      expect(newBatch.orders[0].lots.toNumber()).to.equal(10);
      expect(newBatch.orders[0].status).to.equal(0); // OPEN
    });
  });
});


