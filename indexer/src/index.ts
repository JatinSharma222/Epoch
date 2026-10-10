// Note: Not used in v1; replaced by the JSONL log and snapshot export.
/**
 * Epoch Event Indexer
 *
 * Scaffolding service for T-00 / Phase 2.
 * Subscribes to program events, backfills historical slots, and writes to Postgres.
 */

console.log("[epoch-indexer] Service starting...");
console.log(`[epoch-indexer] Environment: RPC=${process.env.EPOCH_RPC_URL || "default"}, DB=${process.env.EPOCH_DATABASE_URL ? "configured" : "not set"}`);
console.log("[epoch-indexer] Service ready (scaffold mode).");

if (process.env.NODE_ENV === "test") {
  process.exit(0);
} else {
  // Idle scaffold heartbeat to prevent container restart loop
  setInterval(() => {}, 60_000);
}
