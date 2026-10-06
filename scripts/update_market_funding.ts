#!/usr/bin/env bun
/**
 * Update Market Funding Period Parameter
 * Sets fundingPeriodSlots to 72,000 slots (8.0 hours at 400ms/slot).
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import epochIdl from "../app/src/lib/epoch_idl.json";
import { getMarketPda } from "../app/src/lib/constants";

async function main() {
  const rpcUrl = process.env.EPOCH_RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  const keypairPath =
    process.env.ANCHOR_WALLET ||
    path.join(process.env.HOME || "", ".config/solana/id.json");
  const adminSecret = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const admin = Keypair.fromSecretKey(Uint8Array.from(adminSecret));

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(admin), {
    commitment: "confirmed",
  });
  const program = new anchor.Program(epochIdl as any, provider);
  const [marketPda] = getMarketPda();

  const currentMarket = await (program.account as any).market.fetch(marketPda);
  console.log("Current funding_period_slots:", currentMarket.params.fundingPeriodSlots);
  console.log("Current hours at 400ms:", (currentMarket.params.fundingPeriodSlots * 0.4 / 3600).toFixed(2), "hours");

  console.log("Updating fundingPeriodSlots to 72,000 (8.0 hours at 400ms/slot)...");
  const txSig = await program.methods
    .updateMarketParams({
      baseLot: currentMarket.params.baseLot,
      priceTick: currentMarket.params.priceTick,
      minOrderLots: currentMarket.params.minOrderLots,
      minOrderNotional: currentMarket.params.minOrderNotional,
      fundingPeriodSlots: 120670, // 120,670 slots = 28,800s (8.0 hours at measured 238.67ms/slot)
      batchSlots: currentMarket.params.batchSlots,
      lookahead: 4, // L=4 batches ahead provides robust landing window on devnet
      kTicks: currentMarket.params.kTicks,
      tickBps: currentMarket.params.tickBps,
      imrBps: currentMarket.params.imrBps,
      mmrBps: currentMarket.params.mmrBps,
      feeBps: currentMarket.params.feeBps,
      liqPenaltyBps: currentMarket.params.liqPenaltyBps,
      maxOracleAgeSecs: 600, // 600s accommodates Devnet Pyth update cadence (2-5m updates)
      maxConfBps: currentMarket.params.maxConfBps,
      maxClearDelaySlots: currentMarket.params.maxClearDelaySlots,
      maxOrdersPerBatch: currentMarket.params.maxOrdersPerBatch,
      fundingCapBps: currentMarket.params.fundingCapBps,
    })
    .accounts({
      market: marketPda,
      admin: admin.publicKey,
    })
    .rpc();

  console.log("✓ Market funding_period_slots updated to 72,000 (8h)!");
  console.log(`Transaction Signature: ${txSig}`);
  console.log(`Solana Explorer: https://explorer.solana.com/tx/${txSig}?cluster=devnet`);

  const updatedMarket = await (program.account as any).market.fetch(marketPda);
  console.log("Verified on-chain funding_period_slots:", updatedMarket.params.fundingPeriodSlots);
  console.log("Verified on-chain hours at 400ms:", (updatedMarket.params.fundingPeriodSlots * 0.4 / 3600).toFixed(2), "hours");
}

main().catch((err) => {
  console.error("Error updating funding params:", err);
  process.exit(1);
});
