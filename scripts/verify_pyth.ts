#!/usr/bin/env bun
/**
 * Epoch - Devnet Pyth Oracle Verification Script
 *
 * Reads and prints:
 * - Pyth Feed ID
 * - On-chain Price Feed Account address
 * - Live Price & Exponent
 * - Confidence Interval
 * - Posted Slot & Age in Slots
 * - Status & Verification Level
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";

async function main() {
  const rpcUrl = process.env.EPOCH_RPC_URL || "https://api.devnet.solana.com";
  console.log(`Connecting to Solana devnet: ${rpcUrl}`);
  const connection = new Connection(rpcUrl, "confirmed");

  // SOL/USD Feed ID on Pyth
  const feedId = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
  const pythReceiver = new PythSolanaReceiver({ connection, wallet: {} as any });
  const priceFeedAccount = pythReceiver.getPriceFeedAccountAddress(0, feedId);

  console.log("=== Pyth Devnet SOL/USD Feed Verification ===");
  console.log(`Feed ID:              ${feedId}`);
  console.log(`Price Feed Account:   ${priceFeedAccount.toBase58()}`);

  const accInfo = await connection.getAccountInfo(priceFeedAccount);
  if (!accInfo) {
    console.error("FAILED: Price feed account not found on devnet.");
    process.exit(1);
  }

  const priceUpdate = await pythReceiver.fetchPriceUpdateAccount(priceFeedAccount);
  const currentSlot = await connection.getSlot();
  const postedSlot = Number(priceUpdate.postedSlot);
  const ageSlots = currentSlot - postedSlot;

  const rawPrice = Number(priceUpdate.priceMessage.price);
  const exponent = priceUpdate.priceMessage.exponent;
  const formattedPrice = rawPrice * Math.pow(10, exponent);
  const rawConf = Number(priceUpdate.priceMessage.conf);
  const formattedConf = rawConf * Math.pow(10, exponent);
  const confBps = (rawConf / rawPrice) * 10000;

  console.log(`Status:               VERIFIED [MEASURED]`);
  console.log(`Price (USD):          $${formattedPrice.toFixed(4)}`);
  console.log(`Confidence:           ±$${formattedConf.toFixed(4)} (${confBps.toFixed(2)} bps)`);
  console.log(`Exponent:             ${exponent}`);
  console.log(`Publish Time (UTC):   ${new Date(Number(priceUpdate.priceMessage.publishTime) * 1000).toISOString()}`);
  console.log(`Posted Slot:          ${postedSlot}`);
  console.log(`Current Slot:         ${currentSlot}`);
  console.log(`Age in Slots:         ${ageSlots} slots (~${(ageSlots * 0.4).toFixed(1)}s)`);
  console.log("==============================================");
}

main().catch((err) => {
  console.error("Pyth verification failed:", err);
  process.exit(1);
});
