import { Connection } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

export interface LocalTimeParams {
  measuredSlotTimeMs: number;
  batchSlots: number;
  clearWindowSlots: number;
  fundingPeriodSlots: number;
  maxOracleAgeSecs: number;
}

export async function measureLocalSlotTime(
  connection: Connection,
  numSlotsToSample: number = 15
): Promise<LocalTimeParams> {
  console.log(`[slot-profiler] Profiling local slot duration over ${numSlotsToSample} slots...`);

  // Wait for initial slot
  let startSlot = await connection.getSlot("confirmed");
  const startTime = Date.now();
  let currentSlot = startSlot;

  while (currentSlot < startSlot + numSlotsToSample) {
    await new Promise((r) => setTimeout(r, 80));
    currentSlot = await connection.getSlot("confirmed");
  }

  const durationMs = Date.now() - startTime;
  const slotsElapsed = currentSlot - startSlot;
  const measuredSlotTimeMs = Math.round((durationMs / slotsElapsed) * 10) / 10;

  // Dynamic parameter derivations:
  // 1. Batch duration targeting ~1.0 s nominal
  const batchSlots = Math.max(2, Math.round(1000 / measuredSlotTimeMs));

  // 2. Clear window targeting ~8.0 s nominal (min 10 slots)
  const clearWindowSlots = Math.max(10, Math.round(8000 / measuredSlotTimeMs));

  // 3. Funding period targeting 8h nominal
  const fundingPeriodSlots = Math.round((8 * 3600 * 1000) / measuredSlotTimeMs);

  const params: LocalTimeParams = {
    measuredSlotTimeMs,
    batchSlots,
    clearWindowSlots,
    fundingPeriodSlots,
    maxOracleAgeSecs: 10,
  };

  console.log(`[slot-profiler] Measured Slot Time: ${measuredSlotTimeMs} ms/slot [MEASURED]`);
  console.log(`[slot-profiler] Dynamic batchSlots:       ${batchSlots} slots (~${Math.round(batchSlots * measuredSlotTimeMs)} ms)`);
  console.log(`[slot-profiler] Dynamic clearWindowSlots: ${clearWindowSlots} slots (~${Math.round(clearWindowSlots * measuredSlotTimeMs)} ms)`);
  console.log(`[slot-profiler] Dynamic fundingPeriod:    ${fundingPeriodSlots} slots (8h)`);

  return params;
}

async function main() {
  const rpcUrl = process.env.EPOCH_RPC_URL || "http://127.0.0.1:8899";
  const connection = new Connection(rpcUrl, "confirmed");

  const params = await measureLocalSlotTime(connection);
  const outPath = path.resolve(__dirname, "local_params.json");
  fs.writeFileSync(outPath, JSON.stringify(params, null, 2));
  console.log(`[slot-profiler] Wrote dynamic parameters to ${outPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[slot-profiler] Error measuring slot time:", err);
    process.exit(1);
  });
}
