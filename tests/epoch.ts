import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Epoch } from "../target/types/epoch";
import { expect } from "chai";
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
});
