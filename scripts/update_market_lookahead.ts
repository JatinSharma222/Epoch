#!/usr/bin/env bun
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
  console.log("Current market lookahead:", currentMarket.params.lookahead);

  console.log("Updating market lookahead to L=3 (aligned with RING_SIZE = 8)...");
  const txSig = await program.methods
    .updateMarketParams({
      baseLot: currentMarket.params.baseLot,
      priceTick: currentMarket.params.priceTick,
      minOrderLots: currentMarket.params.minOrderLots,
      minOrderNotional: currentMarket.params.minOrderNotional,
      fundingPeriodSlots: currentMarket.params.fundingPeriodSlots,
      batchSlots: currentMarket.params.batchSlots,
      lookahead: 3, // Set to L=3
      kTicks: currentMarket.params.kTicks,
      tickBps: currentMarket.params.tickBps,
      imrBps: currentMarket.params.imrBps,
      mmrBps: currentMarket.params.mmrBps,
      feeBps: currentMarket.params.feeBps,
      liqPenaltyBps: currentMarket.params.liqPenaltyBps,
      maxOracleAgeSecs: currentMarket.params.maxOracleAgeSecs,
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

  console.log("✓ Market lookahead updated to L=3!");
  console.log(`Transaction Signature: ${txSig}`);
  console.log(`Solana Explorer: https://explorer.solana.com/tx/${txSig}?cluster=devnet`);

  const updatedMarket = await (program.account as any).market.fetch(marketPda);
  console.log("New market lookahead:", updatedMarket.params.lookahead);
}

main().catch((err) => {
  console.error("Error updating market lookahead:", err);
  process.exit(1);
});
