/**
 * Epoch Permissionless Keeper
 *
 * Scaffolding service for T-00 / Phase 2.
 * Clears batches and settles user accounts in paged transactions on Solana devnet.
 */

console.log("[epoch-keeper] Service starting...");
console.log(`[epoch-keeper] Environment: RPC=${process.env.EPOCH_RPC_URL || "default"}, Program=${process.env.EPOCH_PROGRAM_ID || "not set"}`);
console.log("[epoch-keeper] Service ready (scaffold mode).");

if (process.env.NODE_ENV !== "test") {
  // If run directly, report readiness
  process.exit(0);
}
