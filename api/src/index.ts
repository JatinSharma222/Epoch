// Note: Not used in v1; replaced by the JSONL log and snapshot export.
/**
 * Epoch Read-Only API
 *
 * Scaffolding service for T-00 / Phase 2.
 * Serves batch history, user fills, and verified evidence statistics.
 */

console.log("[epoch-api] Service starting...");
console.log(`[epoch-api] Port=${process.env.PORT || "8080"}, DB=${process.env.EPOCH_DATABASE_URL ? "configured" : "not set"}`);
console.log("[epoch-api] Service ready (scaffold mode).");

if (process.env.NODE_ENV === "test") {
  process.exit(0);
} else {
  // Idle scaffold heartbeat to prevent container restart loop
  setInterval(() => {}, 60_000);
}
