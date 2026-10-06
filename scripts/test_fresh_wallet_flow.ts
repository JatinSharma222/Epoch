#!/usr/bin/env bun
/**
 * Test Fresh-Wallet First-Time Flow & Fill Reliability (Round 9 Track A)
 * 
 * Verifies:
 * 1. Fresh wallet that has never traded before.
 * 2. Deposit collateral flow.
 * 3. Default order type (Market Order pegged at collar/crossing to fill against demo liquidity).
 * 4. 5 consecutive runs: deposit -> default order -> fill.
 * 5. Measures fill rate and slippage vs oracle price.
 * 6. Documents counterparty (Backstop Vault ladder).
 */

import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import epochIdl from "../app/src/lib/epoch_idl.json";
import {
  getMarketPda,
  getQuoteMintPda,
  getCollateralVaultPda,
  getVaultAuthorityPda,
  getUserPda,
  getBatchPda,
} from "../app/src/lib/constants";
import { PythOracleService } from "../keeper/src/oracle";

function getMintAuthorityPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("mint_authority")], programId);
}

interface RunResult {
  run: number;
  batchId: number;
  targetLots: number;
  matchedLots: number;
  fillRatePct: number;
  oraclePriceUsd: number;
  clearingPriceUsd: number;
  slippageBps: number;
  counterparty: string;
  txClearSig: string;
}

async function main() {
  console.log("=========================================================================");
  console.log("   EPOCH PROTOCOL — FRESH WALLET FIRST-TIME FLOW & FILL VERIFICATION     ");
  console.log("   5 Consecutive Runs: Deposit → Default Order → Fill                    ");
  console.log("=========================================================================\n");

  const rpcUrl = process.env.EPOCH_RPC_URL || "https://api.devnet.solana.com";
  const wsUrl = process.env.EPOCH_WS_URL || "wss://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, { commitment: "confirmed", wsEndpoint: wsUrl });

  // Load admin/funder keypair
  const adminKeyPath =
    process.env.ANCHOR_WALLET ||
    path.join(process.env.HOME || "", ".config/solana/id.json");
  const adminSecret = JSON.parse(fs.readFileSync(adminKeyPath, "utf-8"));
  const admin = Keypair.fromSecretKey(Uint8Array.from(adminSecret));

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(admin),
    { commitment: "confirmed" }
  );
  const program = new anchor.Program(epochIdl as any, provider);

  const [marketPda] = getMarketPda();
  const [quoteMintPda] = getQuoteMintPda();
  const [mintAuthorityPda] = getMintAuthorityPda(program.programId);
  const [collateralVaultPda] = getCollateralVaultPda();
  const [vaultAuthorityPda] = getVaultAuthorityPda();
  const [vaultUserPda] = getUserPda(vaultAuthorityPda);

  const oracleService = new PythOracleService(connection);

  // 1. Generate FRESH WALLET that never traded
  const freshUser = Keypair.generate();
  const [userPda] = getUserPda(freshUser.publicKey);
  const userAta = getAssociatedTokenAddressSync(quoteMintPda, freshUser.publicKey);

  console.log(`[Fresh Wallet] Public Key: ${freshUser.publicKey.toBase58()}`);
  console.log(`[Fresh Wallet] User PDA:   ${userPda.toBase58()}`);

  // Transfer 0.05 SOL from admin to fresh wallet for gas
  console.log("Funding fresh wallet with 0.05 SOL for transaction fees...");
  const fundSolTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: admin.publicKey,
      toPubkey: freshUser.publicKey,
      lamports: 50_000_000,
    })
  );
  await provider.sendAndConfirm(fundSolTx, [admin]);

  // Create user ATA
  console.log("Creating user quote ATA...");
  const createAtaTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      admin.publicKey,
      userAta,
      freshUser.publicKey,
      quoteMintPda
    )
  );
  await provider.sendAndConfirm(createAtaTx, [admin]);

  // Faucet 1,000 mock USDC to user ATA
  console.log("Fauceting 1,000 mock USDC to user ATA...");
  const faucetTx = new Transaction().add(
    await program.methods
      .faucet(new anchor.BN(1_000_000_000))
      .accounts({
        quoteMint: quoteMintPda,
        mintAuthority: mintAuthorityPda,
        recipientTokenAccount: userAta,
        recipient: freshUser.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction()
  );
  await provider.sendAndConfirm(faucetTx, [admin, freshUser]);

  // Create on-chain UserAccount
  console.log("Initializing on-chain UserAccount PDA...");
  const createUserTx = new Transaction().add(
    await program.methods
      .createUser()
      .accounts({
        user: userPda,
        owner: freshUser.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction()
  );
  await provider.sendAndConfirm(createUserTx, [admin, freshUser]);

  // Deposit 500 USDC
  console.log("Depositing 500 USDC collateral into protocol margin vault...");
  const depositTx = new Transaction().add(
    await program.methods
      .deposit(new anchor.BN(500_000_000))
      .accounts({
        market: marketPda,
        user: userPda,
        userTokenAccount: userAta,
        collateralVault: collateralVaultPda,
        owner: freshUser.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction()
  );
  await provider.sendAndConfirm(depositTx, [admin, freshUser]);
  console.log("✓ Deposit complete! Collateral credited to margin ledger.\n");

  let liveSlot = await connection.getSlot("processed");
  const slotSub = connection.onSlotChange((info) => {
    liveSlot = info.slot;
  });

  const results: RunResult[] = [];
  const TOTAL_RUNS = 5;

  for (let run = 1; run <= TOTAL_RUNS; run++) {
    console.log(`-------------------------------------------------------------------------`);
    console.log(`>>> EXECUTING RUN ${run} of ${TOTAL_RUNS}`);
    console.log(`-------------------------------------------------------------------------`);

    const marketAcc = await (program.account as any).market.fetch(marketPda);
    let placeSig = "";
    let targetBatch = 0;
    let ringIndex = 0;
    let targetBatchPda: PublicKey = PublicKey.default;
    let oraclePriceMicro = 0;
    let oraclePriceUsd = 0;
    const orderLots = 10;

    while (!placeSig) {
      try {
        const oracleData = await oracleService.getLatestPrice();
        oraclePriceMicro = oracleData.price.toNumber();
        oraclePriceUsd = oraclePriceMicro / 1_000_000;

        const currentBatch = Math.floor(
          (liveSlot - marketAcc.startSlot.toNumber()) / marketAcc.params.batchSlots
        );
        targetBatch = currentBatch + 3;
        ringIndex = targetBatch % 8;
        [targetBatchPda] = getBatchPda(ringIndex);

        // 1. Vault quotes liquidity ladder: Asks at +12, +18, +25 bps
        const vQuoteIx = await program.methods
          .vaultQuote({
            targetBatch: new anchor.BN(targetBatch),
            ringIndex,
            oraclePrice: oracleData.price,
            oracleConf: oracleData.conf,
            oracleTimestamp: oracleData.publishTime,
          })
          .accounts({
            market: marketPda,
            batch: targetBatchPda,
            vaultAuthority: vaultAuthorityPda,
            vaultUser: vaultUserPda,
            cranker: admin.publicKey,
          })
          .instruction();

        // 2. Default order: Market BUY 10 lots (0.010 SOL) at collar tick 100 (+50 bps)
        const placeOrderIx = await program.methods
          .placeOrder({
            targetBatch: new anchor.BN(targetBatch),
            ringIndex,
            slotId: 0,
            side: 0, // BUY
            tick: 100, // Band edge (+50 bps) guarantees fill against demo vault ladder
            lots: new anchor.BN(orderLots),
            flags: 0,
          })
          .accounts({
            market: marketPda,
            batch: targetBatchPda,
            user: userPda,
            owner: freshUser.publicKey,
          })
          .instruction();

        const placeTx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
          vQuoteIx,
          placeOrderIx
        );
        placeSig = await sendAndConfirmTransaction(connection, placeTx, [admin, freshUser], {
          commitment: "confirmed",
        });
        console.log(`✓ Order placed in Batch #${targetBatch}! Tx: ${placeSig}`);
      } catch (err: any) {
        console.log(`Retrying order placement:`, err.message);
        try {
          if (typeof err.getLogs === "function") console.log("GetLogs:", await err.getLogs(connection));
        } catch {}
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    // Wait for batch to close: close_slot = start_slot + (targetBatch + 1) * batch_slots
    const closeSlot =
      marketAcc.startSlot.toNumber() + (targetBatch + 1) * marketAcc.params.batchSlots;
    console.log(`Waiting for Batch #${targetBatch} close at slot ${closeSlot} (current: ${liveSlot})...`);
    while (liveSlot < closeSlot + 1) {
      await new Promise((r) => setTimeout(r, 100));
    }

    // 3. Clear batch and settle user
    let clearSig = "";
    while (!clearSig) {
      try {
        const clearOracle = await oracleService.getLatestPrice();
        const clearIx = await program.methods
          .clearBatch(new anchor.BN(targetBatch), ringIndex, {
            oraclePrice: clearOracle.price,
            oracleConf: clearOracle.conf,
            oraclePostedSlot: new anchor.BN(closeSlot),
            oracleTimestamp: clearOracle.publishTime,
          })
          .accounts({
            market: marketPda,
            batch: targetBatchPda,
            cranker: admin.publicKey,
          })
          .instruction();

        const settleIx = await program.methods
          .settleUsers(new anchor.BN(targetBatch), ringIndex)
          .accounts({
            market: marketPda,
            batch: targetBatchPda,
          })
          .remainingAccounts([
            { pubkey: userPda, isWritable: true, isSigner: false },
            { pubkey: vaultUserPda, isWritable: true, isSigner: false },
          ])
          .instruction();

        const clearTx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
          clearIx,
          settleIx
        );
        clearSig = await provider.sendAndConfirm(clearTx, [admin], {
          commitment: "confirmed",
          skipPreflight: true,
        });
        console.log(`✓ Batch #${targetBatch} cleared & settled! Tx: ${clearSig}`);
      } catch (err: any) {
        console.log(`Retrying clearance: ${err.message?.slice(0, 70)}`);
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    // Fetch batch account and user state to inspect fill
    const batchAcc = await (program.account as any).batch.fetch(targetBatchPda);
    const clearingPriceMicro = batchAcc.clearingPrice.toNumber();
    const clearingPriceUsd = clearingPriceMicro / 1_000_000;
    const matchedLots = batchAcc.matchedLots.toNumber();

    // Slippage in bps: |clearing_price - oracle_price| / oracle_price * 10,000
    const slippageBps = parseFloat(
      (
        (Math.abs(clearingPriceMicro - oraclePriceMicro) / oraclePriceMicro) *
        10_000
      ).toFixed(2)
    );

    const isFilled = matchedLots >= orderLots;
    console.log(`Run ${run} Result:`);
    console.log(`  Matched Lots:    ${matchedLots} / ${orderLots} (${isFilled ? "FILLED" : "PARTIAL/UNFILLED"})`);
    console.log(`  Clearing Price:  $${clearingPriceUsd.toFixed(2)}`);
    console.log(`  Slippage:        +${slippageBps} bps vs Oracle`);
    console.log(`  Counterparty:    Backstop Vault (${vaultUserPda.toBase58().slice(0, 8)}...)`);

    results.push({
      run,
      batchId: targetBatch,
      targetLots: orderLots,
      matchedLots,
      fillRatePct: isFilled ? 100 : Math.round((matchedLots / orderLots) * 100),
      oraclePriceUsd,
      clearingPriceUsd,
      slippageBps,
      counterparty: `Backstop Vault (${vaultUserPda.toBase58()})`,
      txClearSig: clearSig,
    });

    // Flatten user position (sell back orderLots) so next run starts clean
    let flatSig = "";
    while (!flatSig) {
      try {
        const clearOracle = await oracleService.getLatestPrice();
        const curB = Math.floor(
          (liveSlot - marketAcc.startSlot.toNumber()) / marketAcc.params.batchSlots
        );
        const nextTargetBatch = curB + 3;
        const nextRingIndex = nextTargetBatch % 8;
        const [nextBatchPda] = getBatchPda(nextRingIndex);

        const vFlattenQuoteIx = await program.methods
          .vaultQuote({
            targetBatch: new anchor.BN(nextTargetBatch),
            ringIndex: nextRingIndex,
            oraclePrice: clearOracle.price,
            oracleConf: clearOracle.conf,
            oracleTimestamp: clearOracle.publishTime,
          })
          .accounts({
            market: marketPda,
            batch: nextBatchPda,
            vaultAuthority: vaultAuthorityPda,
            vaultUser: vaultUserPda,
            cranker: admin.publicKey,
          })
          .instruction();

        const flattenOrderIx = await program.methods
          .placeOrder({
            targetBatch: new anchor.BN(nextTargetBatch),
            ringIndex: nextRingIndex,
            slotId: 0,
            side: 1, // SELL (reduce-only)
            tick: 0,  // Collar tick for sell
            lots: new anchor.BN(orderLots),
            flags: 1, // REDUCE_ONLY
          })
          .accounts({
            market: marketPda,
            batch: nextBatchPda,
            user: userPda,
            owner: freshUser.publicKey,
          })
          .instruction();

        const flattenTx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
          vFlattenQuoteIx,
          flattenOrderIx
        );
        flatSig = await provider.sendAndConfirm(flattenTx, [admin, freshUser], {
          commitment: "confirmed",
          skipPreflight: true,
        });

        const flattenCloseSlot =
          marketAcc.startSlot.toNumber() + (nextTargetBatch + 1) * marketAcc.params.batchSlots;
        while (liveSlot < flattenCloseSlot + 1) {
          await new Promise((r) => setTimeout(r, 100));
        }

        const flatClearIx = await program.methods
          .clearBatch(new anchor.BN(nextTargetBatch), nextRingIndex, {
            oraclePrice: clearOracle.price,
            oracleConf: clearOracle.conf,
            oraclePostedSlot: new anchor.BN(flattenCloseSlot),
            oracleTimestamp: clearOracle.publishTime,
          })
          .accounts({
            market: marketPda,
            batch: nextBatchPda,
            cranker: admin.publicKey,
          })
          .instruction();

        const flatSettleIx = await program.methods
          .settleUsers(new anchor.BN(nextTargetBatch), nextRingIndex)
          .accounts({
            market: marketPda,
            batch: nextBatchPda,
          })
          .remainingAccounts([
            { pubkey: userPda, isWritable: true, isSigner: false },
            { pubkey: vaultUserPda, isWritable: true, isSigner: false },
          ])
          .instruction();

        const flatClearTx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
          flatClearIx,
          flatSettleIx
        );
        await provider.sendAndConfirm(flatClearTx, [admin], {
          commitment: "confirmed",
          skipPreflight: true,
        });
        console.log(`✓ Position flattened to 0 lots for next run.\n`);
      } catch (err: any) {
        console.log(`Retrying flattening: ${err.message?.slice(0, 70)}`);
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  // Summary Report
  console.log("=========================================================================");
  console.log("                   FRESH WALLET FLOW 5-RUN SUMMARY                       ");
  console.log("=========================================================================");
  const totalFills = results.filter((r) => r.fillRatePct === 100).length;
  const overallFillRate = (totalFills / TOTAL_RUNS) * 100;
  const avgSlippage =
    results.reduce((acc, r) => acc + r.slippageBps, 0) / results.length;

  console.log(`Total Runs:       ${TOTAL_RUNS}`);
  console.log(`Filled Runs:      ${totalFills} / ${TOTAL_RUNS}`);
  console.log(`Fill Rate:        ${overallFillRate.toFixed(1)}% [MEASURED]`);
  console.log(`Average Slippage: +${avgSlippage.toFixed(2)} bps [MEASURED]`);
  console.log(`Counterparty:     Backstop Vault Ladder (Tier 1: 12 bps, Tier 2: 18 bps)`);
  await connection.removeSlotChangeListener(slotSub);

  const reportFile = path.resolve(__dirname, "../evidence/fresh_wallet_flow_report.json");
  fs.writeFileSync(
    reportFile,
    JSON.stringify(
      {
        scenario: "Fresh Wallet First-Time Flow & Fill Reliability",
        tested_at: new Date().toISOString(),
        total_runs: TOTAL_RUNS,
        overall_fill_rate_pct: overallFillRate,
        label: "MEASURED",
        mean_slippage_bps: avgSlippage,
        counterparty_structure: {
          type: "Backstop Vault Automated Ladder",
          tiers: [
            { offset_bps: 12, lots: 500 },
            { offset_bps: 18, lots: 1000 },
            { offset_bps: 25, lots: 2000 },
          ],
          theoretical_slippage_10_lots: 12.0,
          theoretical_slippage_1000_lots: 15.0,
        },
        runs: results,
      },
      null,
      2
    )
  );
  console.log(`Report written to: ${reportFile}`);
  console.log("=========================================================================");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
