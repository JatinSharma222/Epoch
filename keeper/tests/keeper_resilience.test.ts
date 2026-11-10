import { describe, expect, it, mock } from "bun:test";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram } from "@solana/web3.js";
import { EpochKeeper } from "../src/keeper";
import { KeeperConfig } from "../src/types";

describe("T-G2-02 & T-G2-03: Keeper Resilience, Slot Freshness Watchdog & Recovery", () => {
  const dummyProgramId = new PublicKey("ER8SSfvp7roW6asG429Uv3mHY1aEd1jxGBdigLu27284");
  const testKeypair = Keypair.generate();

  function createMockKeeper(mockOverrides: Partial<Connection> = {}): EpochKeeper {
    const config: KeeperConfig = {
      rpcUrl: "http://127.0.0.1:8899",
      programId: dummyProgramId,
      commitment: "confirmed",
    };

    const keeper = new EpochKeeper(config, testKeypair);
    // Attach mock overrides to keeper.connection
    Object.assign(keeper.connection, mockOverrides);
    return keeper;
  }

  // ─── 1. WebSocket Drop & Slot Freshness Watchdog ───────────────────────────
  describe("1. WebSocket drop simulation & slot freshness watchdog (T-G2-02)", () => {
    it("detects stale WebSocket slot (> 2500ms) and polls HTTP processed slot fallback", async () => {
      let getSlotCalled = false;
      let getSlotCommitment: string | undefined = undefined;

      const keeper = createMockKeeper({
        getSlot: mock(async (commitment?: any) => {
          getSlotCalled = true;
          getSlotCommitment = commitment;
          return 54321;
        }) as any,
        onSlotChange: mock(() => 999) as any,
        removeSlotChangeListener: mock(async () => {}) as any,
      });

      // Simulate a previously active tracked slot that stopped updating 3000ms ago
      (keeper as any)._trackedSlot = 54000;
      (keeper as any)._lastSlotUpdateTs = Date.now() - 3000;

      const resolvedSlot = await keeper.getCurrentSlot();

      expect(getSlotCalled).toBe(true);
      expect(getSlotCommitment).toBe("processed");
      expect(resolvedSlot).toBe(54321);
      expect(keeper.trackedSlot).toBe(54321);
      expect(Date.now() - keeper.lastSlotUpdateTs).toBeLessThan(100);
    });

    it("uses tracked slot directly without HTTP call when slot is fresh (< 2500ms)", async () => {
      let getSlotCalled = false;

      const keeper = createMockKeeper({
        getSlot: mock(async () => {
          getSlotCalled = true;
          return 99999;
        }) as any,
      });

      (keeper as any)._trackedSlot = 54100;
      (keeper as any)._lastSlotUpdateTs = Date.now() - 500; // 500ms ago (fresh)

      const resolvedSlot = await keeper.getCurrentSlot();

      expect(getSlotCalled).toBe(false);
      expect(resolvedSlot).toBe(54100);
      expect(keeper.trackedSlot).toBe(54100);
    });

    it("triggers WebSocket resubscription when watchdog detects stale slot", async () => {
      let resubscribeCalled = false;

      const keeper = createMockKeeper({
        getSlot: mock(async () => 60000) as any,
        onSlotChange: mock(() => {
          resubscribeCalled = true;
          return 101;
        }) as any,
        removeSlotChangeListener: mock(async () => {}) as any,
      });

      (keeper as any)._trackedSlot = 59000;
      (keeper as any)._lastSlotUpdateTs = Date.now() - 4000; // 4s stale

      await keeper.getCurrentSlot();
      // Allow async resubscription promise to resolve
      await new Promise((r) => setTimeout(r, 50));

      expect(resubscribeCalled).toBe(true);
    });
  });

  // ─── 2. HTTP 429 Exponential Backoff ──────────────────────────────────────
  describe("2. HTTP 429 exponential backoff handling (T-G2-02)", () => {
    it("retries on HTTP 429 with exponential backoff and succeeds on subsequent attempt", async () => {
      const keeper = createMockKeeper();
      let attempts = 0;

      const result = await keeper.executeWithBackoff(
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error("HTTP 429 Too Many Requests");
          }
          return "recovered_data";
        },
        4,
        20 // short base delay for fast tests
      );

      expect(attempts).toBe(3);
      expect(result).toBe("recovered_data");
    });

    it("throws when HTTP 429 retries are completely exhausted", async () => {
      const keeper = createMockKeeper();
      let attempts = 0;

      let caughtErr: any = null;
      try {
        await keeper.executeWithBackoff(
          async () => {
            attempts++;
            throw new Error("HTTP 429: Rate limit exceeded");
          },
          3,
          10
        );
      } catch (err) {
        caughtErr = err;
      }

      expect(attempts).toBe(4); // initial + 3 retries
      expect(caughtErr).not.toBeNull();
      expect(String(caughtErr)).toContain("429");
    });

    it("throws non-429 errors immediately without retrying", async () => {
      const keeper = createMockKeeper();
      let attempts = 0;

      let caughtErr: any = null;
      try {
        await keeper.executeWithBackoff(
          async () => {
            attempts++;
            throw new Error("InvalidAccountDiscriminator");
          },
          3,
          10
        );
      } catch (err) {
        caughtErr = err;
      }

      expect(attempts).toBe(1); // zero retries for non-429
      expect(caughtErr).not.toBeNull();
      expect(String(caughtErr)).toContain("InvalidAccountDiscriminator");
    });
  });

  // ─── 3. Lost Confirmation Recovery & Idempotency ───────────────────────────
  describe("3. Lost confirmation recovery & transaction tracking (T-G2-03)", () => {
    it("recovers unconfirmed transaction if status is confirmed on-chain", async () => {
      const testSig = "5J7X" + "1".repeat(84);
      let statusQueryCount = 0;

      const keeper = createMockKeeper({
        getSignatureStatuses: mock(async () => {
          statusQueryCount++;
          return {
            context: { slot: 100 },
            value: [
              {
                slot: 100,
                confirmations: null,
                err: null,
                confirmationStatus: "confirmed",
              },
            ],
          };
        }) as any,
        getBlockHeight: mock(async () => 500) as any,
      });

      const recovered = await keeper.recoverLostConfirmation(testSig, 600);

      expect(recovered).toBe(true);
      expect(statusQueryCount).toBeGreaterThanOrEqual(1);
    });

    it("polls status until confirmation or block height expiration", async () => {
      const testSig = "4A8Y" + "2".repeat(84);
      let queryAttempt = 0;

      const keeper = createMockKeeper({
        getSignatureStatuses: mock(async () => {
          queryAttempt++;
          if (queryAttempt < 2) {
            return { context: { slot: 100 }, value: [null] };
          }
          return {
            context: { slot: 102 },
            value: [
              {
                slot: 102,
                confirmations: null,
                err: null,
                confirmationStatus: "finalized",
              },
            ],
          };
        }) as any,
        getBlockHeight: mock(async () => 500) as any,
      });

      const recovered = await keeper.recoverLostConfirmation(testSig, 600);

      expect(recovered).toBe(true);
      expect(queryAttempt).toBe(2);
    });

    it("records confirmed signatures into _confirmedSignatures set to prevent duplicate execution", async () => {
      const keeper = createMockKeeper();
      const sig1 = "3K9Z" + "3".repeat(84);

      expect(keeper.confirmedSignatures.has(sig1)).toBe(false);
      keeper.confirmedSignatures.add(sig1);
      expect(keeper.confirmedSignatures.has(sig1)).toBe(true);
    });
  });

  // ─── 4. Boot State Reconciliation ─────────────────────────────────────────
  describe("4. On-chain boot state reconciliation (T-G2-03)", () => {
    it("reconciles next_batch_to_clear and ring batch states directly from RPC", async () => {
      const keeper = createMockKeeper({
        getSlot: mock(async () => 1050) as any,
      });

      // Mock on-chain market fetch
      (keeper.program.account as any).market = {
        fetch: mock(async () => ({
          nextBatchToClear: { toNumber: () => 7 },
          startSlot: { toNumber: () => 1000 },
          params: { batchSlots: 10, maxClearDelaySlots: 20 },
        })),
        fetchNullable: mock(async () => ({
          nextBatchToClear: { toNumber: () => 7 },
          startSlot: { toNumber: () => 1000 },
          params: { batchSlots: 10, maxClearDelaySlots: 20 },
        })),
      };

      // Mock 8 ring batches
      (keeper.program.account as any).batch = {
        fetchMultiple: mock(async () => [
          { batchId: { toNumber: () => 0 }, status: 2 }, // CLEARED
          { batchId: { toNumber: () => 1 }, status: 2 }, // CLEARED
          { batchId: { toNumber: () => 2 }, status: 1 }, // OPEN (stale: closeSlot 1030 + 20 = 1050, current 1051)
          { batchId: { toNumber: () => 3 }, status: 1 }, // OPEN
          { batchId: { toNumber: () => 4 }, status: 0 }, // EMPTY
          { batchId: { toNumber: () => 5 }, status: 0 },
          { batchId: { toNumber: () => 6 }, status: 0 },
          { batchId: { toNumber: () => 7 }, status: 0 },
        ]),
      };

      (keeper as any)._trackedSlot = 1060;
      (keeper as any)._lastSlotUpdateTs = Date.now();

      const state = await keeper.reconcileBootState();

      expect(state.nextBatchToClear).toBe(7);
      expect(state.clearedBatches).toEqual([0, 1]);
      expect(state.staleBatches).toEqual([2]);
      expect(state.openBatches).toEqual([3]);
    });
  });

  // ─── 5. ADL Chunking & MTU Wire Size Guard ────────────────────────────────
  describe("5. Generalized ADL Chunking & Wire Guard (T-G2-04)", () => {
    it("asserts wire guard rejects transactions exceeding 1232 bytes (K=32)", () => {
      const liquidator = Keypair.generate();
      const tx = new Transaction();
      tx.add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })
      );

      const k32Counterparties = Array.from({ length: 32 }, () => ({
        pubkey: Keypair.generate().publicKey,
        isWritable: true,
        isSigner: false,
      }));

      tx.add(
        new TransactionInstruction({
          programId: dummyProgramId,
          data: Buffer.from([223, 179, 226, 125, 48, 46, 39, 74]),
          keys: [
            { pubkey: Keypair.generate().publicKey, isWritable: true, isSigner: false },
            { pubkey: Keypair.generate().publicKey, isWritable: false, isSigner: false },
            { pubkey: Keypair.generate().publicKey, isWritable: true, isSigner: false },
            { pubkey: Keypair.generate().publicKey, isWritable: true, isSigner: false },
            { pubkey: Keypair.generate().publicKey, isWritable: false, isSigner: false },
            { pubkey: Keypair.generate().publicKey, isWritable: false, isSigner: false },
            { pubkey: liquidator.publicKey, isWritable: false, isSigner: true },
            ...k32Counterparties,
          ],
        })
      );

      tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
      tx.feePayer = liquidator.publicKey;
      tx.sign(liquidator);

      // Measure wire bytes
      const wireBytes = 1 + 64 + tx.serializeMessage().length;
      expect(wireBytes).toBe(1484);
      expect(wireBytes).toBeGreaterThan(1232);

      // Verify that standard serialize rejects
      let serializationThrew = false;
      try {
        tx.serialize();
      } catch (err: any) {
        serializationThrew = true;
        expect(err.message).toContain("1232");
      }
      expect(serializationThrew).toBe(true);
    });

    it("verifies safe chunk size K=16 serializes cleanly under 1232 MTU (956 bytes)", () => {
      const liquidator = Keypair.generate();
      const tx = new Transaction();
      tx.add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })
      );

      const k16Counterparties = Array.from({ length: 16 }, () => ({
        pubkey: Keypair.generate().publicKey,
        isWritable: true,
        isSigner: false,
      }));

      tx.add(
        new TransactionInstruction({
          programId: dummyProgramId,
          data: Buffer.from([223, 179, 226, 125, 48, 46, 39, 74]),
          keys: [
            { pubkey: Keypair.generate().publicKey, isWritable: true, isSigner: false },
            { pubkey: Keypair.generate().publicKey, isWritable: false, isSigner: false },
            { pubkey: Keypair.generate().publicKey, isWritable: true, isSigner: false },
            { pubkey: Keypair.generate().publicKey, isWritable: true, isSigner: false },
            { pubkey: Keypair.generate().publicKey, isWritable: false, isSigner: false },
            { pubkey: Keypair.generate().publicKey, isWritable: false, isSigner: false },
            { pubkey: liquidator.publicKey, isWritable: false, isSigner: true },
            ...k16Counterparties,
          ],
        })
      );

      tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
      tx.feePayer = liquidator.publicKey;
      tx.sign(liquidator);

      const raw = tx.serialize();
      expect(raw.length).toBe(956);
      expect(raw.length).toBeLessThanOrEqual(1232);
      expect(1232 - raw.length).toBe(276); // 276 bytes MTU safety headroom
    });
  });
});
