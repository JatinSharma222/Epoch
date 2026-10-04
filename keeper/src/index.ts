#!/usr/bin/env bun
/**
 * Epoch Permissionless Keeper CLI
 *
 * Runs the slot loop, oracle price fetching, clearing, and paged settlement.
 */

import { PublicKey } from "@solana/web3.js";
import { EpochKeeper } from "./keeper";
import { KeeperConfig } from "./types";

const rpcUrl = process.env.EPOCH_RPC_URL || "https://api.devnet.solana.com";
const wsUrl = process.env.EPOCH_WS_URL;
const programIdStr =
  process.env.EPOCH_PROGRAM_ID ||
  "CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap";
const keypairPath =
  process.env.EPOCH_KEEPER_KEYPAIR_PATH || process.env.EPOCH_KEEPER_KEYPAIR;
const databaseUrl = process.env.EPOCH_DATABASE_URL;

const isOnce = process.argv.includes("--once");
const pollIntervalMs = parseInt(
  process.env.EPOCH_KEEPER_INTERVAL_MS || "1000",
  10
);

const config: KeeperConfig = {
  rpcUrl,
  wsUrl,
  programId: new PublicKey(programIdStr),
  keypairPath,
  databaseUrl,
  commitment: "confirmed",
  pollIntervalMs,
  pageSize: 10,
  network: rpcUrl.includes("devnet")
    ? "devnet"
    : rpcUrl.includes("localhost") || rpcUrl.includes("127.0.0.1")
    ? "localnet"
    : "mainnet",
};

async function main() {
  console.log("=== Epoch Permissionless Keeper v1 ===");
  console.log(`RPC URL:     ${config.rpcUrl}`);
  console.log(`Program ID:  ${config.programId.toBase58()}`);
  console.log(`Network:     ${config.network} [SOURCED]`);
  console.log(`Mode:        ${isOnce ? "Single Tick (--once)" : "Continuous Loop"}`);
  console.log("======================================");

  const keeper = new EpochKeeper(config);

  if (isOnce) {
    console.log("[keeper] Executing single tick...");
    const res = await keeper.tick();
    console.log(
      `[keeper] Tick complete: slot=${res.currentSlot}, cleared=${res.clearedCount}, settled_pages=${res.settledCount}, vault_quotes=${res.vaultQuotesCount}, liquidated=${res.liquidatedCount}`
    );
    process.exit(0);
  } else {
    await keeper.start();

    const shutdown = () => {
      console.log("\n[keeper] Shutting down gracefully...");
      keeper.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }
}

main().catch((err) => {
  console.error("[keeper] Fatal error:", err);
  process.exit(1);
});
