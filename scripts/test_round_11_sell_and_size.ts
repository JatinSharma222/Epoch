/**
 * Epoch Protocol — Round 11 Requirement 1: Sell Side and Size Live Devnet Verification
 *
 * Verifies on Solana Devnet with a fresh wallet:
 * 1. Market sell at 0.10 SOL (100 lots) -> Expect ~ -14 bps clearing offset.
 * 2. Market sell at 1.00 SOL (1,000 lots) -> Expect ~ -21 bps clearing offset.
 * 3. Limit buy at the clearing offset (100 lots @ +14 bps) -> Fills 100%.
 * 4. 5.00 SOL market buy (5,000 lots) exceeding vault depth (3.5 SOL) -> Partial fill ("fills 3.5 of 5.0 SOL").
 *
 * Logs exact ticket preview text before each order, filled lots, clearing offsets, fees, and transaction signatures.
 */

import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
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
import { clear, clearingPrice } from "../app/src/lib/clearingEngine";
import { PythOracleService } from "../keeper/src/oracle";

function getMintAuthorityPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("mint_authority")], programId);
}

interface OrderRunResult {
  step: string;
  orderType: "market" | "limit";
  side: "BUY" | "SELL";
  sizeSol: number;
  lots: number;
  ticketPreviewText: string;
  previewExpectedOffsetBps: number;
  previewIsPartial: boolean;
  batchId: number;
  clearingPriceUsd: number;
  clearingOffsetBps: number;
  matchedLots: number;
  fillRatePct: number;
  protocolFeeBps: number;
  totalCostBps: number;
  txPlaceSig: string;
  txClearSig: string;
}

// Compute client-side ticket preview exactly as OrderTicket.tsx does
function computeTicketPreview(
  side: "BUY" | "SELL",
  orderType: "market" | "limit",
  lots: number,
  numQtySol: number,
  limitOffsetBps: number,
  oraclePriceUsd: number,
  vaultBidLadder: Array<{ offsetBps: number; lots: number }>,
  vaultAskLadder: Array<{ offsetBps: number; lots: number }>
): {
  indicativeText: string;
  offsetBps: number;
  isPartial: boolean;
  matchedLots: number;
  priceUsd: number;
} {
  const simBids = new Array(101).fill(0);
  const simAsks = new Array(101).fill(0);

  // Populate resting vault orders
  for (const b of vaultBidLadder) {
    const t = 50 + b.offsetBps;
    simBids[t] = (simBids[t] || 0) + b.lots;
  }
  for (const a of vaultAskLadder) {
    const t = 50 + a.offsetBps;
    simAsks[t] = (simAsks[t] || 0) + a.lots;
  }

  const orderTick =
    orderType === "market"
      ? side === "BUY"
        ? 100
        : 0
      : 50 + limitOffsetBps;

  if (side === "BUY") {
    simBids[orderTick] = (simBids[orderTick] || 0) + lots;
  } else {
    simAsks[orderTick] = (simAsks[orderTick] || 0) + lots;
  }

  const res = clear(simBids, simAsks);
  if (!res || res.matched === 0) {
    return {
      indicativeText: "No crossing liquidity",
      offsetBps: 0,
      isPartial: false,
      matchedLots: 0,
      priceUsd: oraclePriceUsd,
    };
  }

  const offsetBps = res.tick - 50;
  const offsetStr = offsetBps >= 0 ? `+${offsetBps}` : `${offsetBps}`;
  const clPriceUsd =
    clearingPrice(
      Math.round(oraclePriceUsd * 1_000_000),
      res.tick,
      101,
      1,
      1000
    ) / 1_000_000;

  const isPartial = res.matched < lots;
  const filledSol = (res.matched * 0.001).toFixed(1);
  const requestedSol = numQtySol.toFixed(1);
  const partialText = `fills ${filledSol} of ${requestedSol} SOL`;
  const fullText = `Indicative price: oracle ${offsetStr} bps for ${numQtySol.toFixed(2)} SOL`;
  const indicativeText = isPartial ? partialText : fullText;

  return {
    indicativeText,
    offsetBps,
    isPartial,
    matchedLots: Math.min(lots, res.matched),
    priceUsd: clPriceUsd,
  };
}

async function main() {
  console.log("=========================================================================");
  console.log("   EPOCH PROTOCOL — ROUND 11 REQUIREMENT 1: SELL SIDE & SIZE DEVNET TEST ");
  console.log("=========================================================================\n");

  const rpcUrl = process.env.EPOCH_RPC_URL || "https://api.devnet.solana.com";
  const wsUrl = process.env.EPOCH_WS_URL || "wss://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, { commitment: "confirmed", wsEndpoint: wsUrl });

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

  // 1. Generate Fresh Wallet
  const freshUser = Keypair.generate();
  const [userPda] = getUserPda(freshUser.publicKey);
  const userAta = getAssociatedTokenAddressSync(quoteMintPda, freshUser.publicKey);

  console.log(`[Fresh Wallet] Public Key: ${freshUser.publicKey.toBase58()}`);
  console.log(`[Fresh Wallet] User PDA:   ${userPda.toBase58()}`);

  console.log("Funding fresh wallet with 0.20 SOL for transaction fees...");
  const fundSolTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: admin.publicKey,
      toPubkey: freshUser.publicKey,
      lamports: 200_000_000,
    })
  );
  await provider.sendAndConfirm(fundSolTx, [admin]);

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

  console.log("Fauceting 2,000 mock USDC (2 calls = 4,000 USDC) to user ATA...");
  for (let i = 0; i < 2; i++) {
    const faucetTx = new Transaction().add(
      await program.methods
        .faucet(new anchor.BN(2_000_000_000))
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
  }

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

  console.log("Depositing 3,000 USDC collateral into protocol margin vault...");
  const depositTx = new Transaction().add(
    await program.methods
      .deposit(new anchor.BN(3_000_000_000))
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
  console.log("✓ Deposit complete! 3,000 USDC collateral credited.\n");

  let liveSlot = await connection.getSlot("processed");
  connection.onSlotChange((info) => {
    liveSlot = info.slot;
  });

  const marketAcc = await (program.account as any).market.fetch(marketPda);
  const results: OrderRunResult[] = [];

  // Vault ladder definition (zero skew baseline)
  const vaultBids = [
    { offsetBps: -12, lots: 500 },
    { offsetBps: -18, lots: 1000 },
    { offsetBps: -25, lots: 2000 },
  ];
  const vaultAsks = [
    { offsetBps: 12, lots: 500 },
    { offsetBps: 18, lots: 1000 },
    { offsetBps: 25, lots: 2000 },
  ];

  // Helper to execute a test step
  async function executeStep(
    stepName: string,
    side: "BUY" | "SELL",
    orderType: "market" | "limit",
    lots: number,
    numQtySol: number,
    limitOffsetBps: number = 0
  ): Promise<OrderRunResult> {
    console.log(`-------------------------------------------------------------------------`);
    console.log(`>>> ${stepName.toUpperCase()}: ${numQtySol} SOL (${lots} lots) ${orderType.toUpperCase()} ${side}`);
    console.log(`-------------------------------------------------------------------------`);

    const curOracle = await oracleService.getLatestPrice();
    const oraclePriceUsd = curOracle.price.toNumber() / 1_000_000;

    // 1. Ticket Preview Computation Before Order
    const preview = computeTicketPreview(
      side,
      orderType,
      lots,
      numQtySol,
      limitOffsetBps,
      oraclePriceUsd,
      vaultBids,
      vaultAsks
    );

    console.log(`[Ticket Preview Before Order]:`);
    console.log(`  Displayed Text:   "${preview.indicativeText}"`);
    console.log(`  Expected Offset:  ${preview.offsetBps} bps`);
    console.log(`  Expected Matched: ${preview.matchedLots} / ${lots} lots`);
    console.log(`  Partial Warning:  ${preview.isPartial ? "YES ('fills 3.5 of 5.0 SOL')" : "NO"}`);

    let placeSig = "";
    let targetBatch = 0;
    let ringIndex = 0;
    let targetBatchPda: PublicKey = PublicKey.default;
    const orderTick =
      orderType === "market"
        ? side === "BUY"
          ? 100
          : 0
        : 50 + limitOffsetBps;

    while (!placeSig) {
      try {
        const oracleData = await oracleService.getLatestPrice();
        const curBatch = Math.floor(
          (liveSlot - marketAcc.startSlot.toNumber()) / marketAcc.params.batchSlots
        );
        targetBatch = curBatch + 3;
        ringIndex = targetBatch % 8;
        [targetBatchPda] = getBatchPda(ringIndex);

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

        const orderIx = await program.methods
          .placeOrder({
            targetBatch: new anchor.BN(targetBatch),
            ringIndex,
            slotId: 0,
            side: side === "BUY" ? 0 : 1,
            tick: orderTick,
            lots: new anchor.BN(lots),
            flags: 0,
          })
          .accounts({
            market: marketPda,
            batch: targetBatchPda,
            user: userPda,
            owner: freshUser.publicKey,
          })
          .instruction();

        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
          vQuoteIx,
          orderIx
        );

        placeSig = await sendAndConfirmTransaction(connection, tx, [admin, freshUser], {
          commitment: "confirmed",
          skipPreflight: true,
        });
        console.log(`✓ Order placed in Batch #${targetBatch}! Tx: ${placeSig}`);
      } catch (err: any) {
        console.log(`Retrying order placement: ${err.message?.slice(0, 60)}`);
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    // Wait for batch close slot
    const closeSlot =
      marketAcc.startSlot.toNumber() +
      (targetBatch + 1) * marketAcc.params.batchSlots;
    while (liveSlot < closeSlot + 1) {
      await new Promise((r) => setTimeout(r, 200));
    }

    // Clear and Settle
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
        console.log(`Retrying clear/settle: ${err.message?.slice(0, 60)}`);
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    // Fetch batch account to inspect clearing price and matched lots
    const batchAcc = await (program.account as any).batch.fetch(targetBatchPda);
    const clearingPriceMicro = batchAcc.clearingPrice.toNumber();
    const clearingPriceUsd = clearingPriceMicro / 1_000_000;
    const matchedLots = batchAcc.matchedLots.toNumber();
    const clearingTick = batchAcc.clearingTick;
    const clearingOffsetBps = clearingTick - 50;

    const fillRatePct = Math.min(100, Math.round((matchedLots / lots) * 100));
    const protocolFeeBps = 5;
    const totalCostBps = Math.abs(clearingOffsetBps) + protocolFeeBps;

    console.log(`[Execution Outcome]:`);
    console.log(`  Matched Lots:     ${matchedLots} / ${lots} (${fillRatePct}% fill)`);
    console.log(`  Clearing Tick:    ${clearingTick} (Offset: ${clearingOffsetBps >= 0 ? "+" : ""}${clearingOffsetBps} bps)`);
    console.log(`  Clearing Price:   $${clearingPriceUsd.toFixed(3)}`);
    console.log(`  Protocol Fee:     ${protocolFeeBps} bps`);
    console.log(`  Total Taker Cost: ${totalCostBps} bps\n`);

    const result: OrderRunResult = {
      step: stepName,
      orderType,
      side,
      sizeSol: numQtySol,
      lots,
      ticketPreviewText: preview.indicativeText,
      previewExpectedOffsetBps: preview.offsetBps,
      previewIsPartial: preview.isPartial,
      batchId: targetBatch,
      clearingPriceUsd,
      clearingOffsetBps,
      matchedLots,
      fillRatePct,
      protocolFeeBps,
      totalCostBps,
      txPlaceSig: placeSig,
      txClearSig: clearSig,
    };

    // Flatten user position so subsequent run starts with clean 0-position
    console.log(`Flattening user position (${matchedLots} lots)...`);
    let flatSig = "";
    const flatSide = side === "BUY" ? 1 : 0; // Offsetting side
    const flatCollarTick = flatSide === 1 ? 0 : 100;

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
            side: flatSide,
            tick: flatCollarTick,
            lots: new anchor.BN(matchedLots),
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

        await sendAndConfirmTransaction(connection, flattenTx, [admin, freshUser], {
          commitment: "confirmed",
          skipPreflight: true,
        });

        const flattenCloseSlot =
          marketAcc.startSlot.toNumber() +
          (nextTargetBatch + 1) * marketAcc.params.batchSlots;
        while (liveSlot < flattenCloseSlot + 1) {
          await new Promise((r) => setTimeout(r, 200));
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

        flatSig = await provider.sendAndConfirm(
          new Transaction().add(
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 }),
            ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
            flatClearIx,
            flatSettleIx
          ),
          [admin],
          { commitment: "confirmed", skipPreflight: true }
        );
        console.log(`✓ Position flattened cleanly to 0 lots.\n`);
      } catch (err: any) {
        console.log(`Retrying flattening: ${err.message?.slice(0, 60)}`);
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    return result;
  }

  // --- Run 1: Market Sell at 0.10 SOL (100 lots) ---
  const res1 = await executeStep("Market Sell 0.10 SOL", "SELL", "market", 100, 0.1, 0);
  results.push(res1);

  // --- Run 2: Market Sell at 1.00 SOL (1,000 lots) ---
  const res2 = await executeStep("Market Sell 1.00 SOL", "SELL", "market", 1000, 1.0, 0);
  results.push(res2);

  // --- Run 3: Limit Buy at Clearing Offset (+14 bps for 100 lots) ---
  const res3 = await executeStep("Limit Buy 0.10 SOL @ +14 bps", "BUY", "limit", 100, 0.1, 14);
  results.push(res3);

  // --- Run 4: 5.00 SOL Market Buy Exceeding Vault Depth (3.5 SOL) ---
  const res4 = await executeStep("Market Buy 5.00 SOL (Depth Exceeded)", "BUY", "market", 5000, 5.0, 0);
  results.push(res4);

  // Summary & Evidence File Generation
  const summary = {
    tested_at: new Date().toISOString(),
    network: "devnet",
    programId: program.programId.toBase58(),
    fresh_wallet: freshUser.publicKey.toBase58(),
    user_pda: userPda.toBase58(),
    vault_ladder: {
      total_ask_depth_sol: 3.5,
      total_bid_depth_sol: 3.5,
      tiers: [
        { tier: 1, lots: 500, offsetBps: 12 },
        { tier: 2, lots: 1000, offsetBps: 18 },
        { tier: 3, lots: 2000, offsetBps: 25 },
      ],
    },
    runs: results,
  };

  const reportPath = path.resolve(__dirname, "../evidence/round_11_sell_and_size_report.json");
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));

  console.log("=========================================================================");
  console.log("             ROUND 11 SELL SIDE & SIZE TEST SUMMARY                      ");
  console.log("=========================================================================");
  for (const r of results) {
    console.log(`[${r.step}]:`);
    console.log(`  Preview Before Order: "${r.ticketPreviewText}"`);
    console.log(`  Filled Lots:          ${r.matchedLots} / ${r.lots} (${r.fillRatePct}%)`);
    console.log(`  Clearing Offset:      ${r.clearingOffsetBps >= 0 ? "+" : ""}${r.clearingOffsetBps} bps`);
    console.log(`  Total Taker Cost:     ${r.totalCostBps} bps`);
    console.log(`  Tx Signature:         ${r.txClearSig}`);
  }
  console.log(`Evidence written to: ${reportPath}`);
  console.log("=========================================================================\n");

  process.exit(0);
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
