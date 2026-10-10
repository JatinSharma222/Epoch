#!/usr/bin/env bun
/**
 * Measure RPC Round-Trip Latency (Round 14 Item 7)
 * Takes median of 20 getSlot calls and reports latency statistics.
 */

import { Connection } from "@solana/web3.js";

async function main() {
  const rpcUrl =
    process.env.EPOCH_RPC_URL ||
    "https://devnet.helius-rpc.com/?api-key=7f051d79-ac86-4394-bae9-346f64974d1a";
  const connection = new Connection(rpcUrl, "confirmed");

  console.log(`=== RPC Latency Measurement ===`);
  console.log(`Endpoint: ${rpcUrl}`);
  console.log(`Sampling: 20 getSlot calls...\n`);

  const samples: number[] = [];

  // Warmup call
  await connection.getSlot();

  for (let i = 1; i <= 20; i++) {
    const start = performance.now();
    const slot = await connection.getSlot();
    const duration = performance.now() - start;
    samples.push(duration);
    console.log(`Sample ${i.toString().padStart(2, " ")}: ${duration.toFixed(2)} ms (slot ${slot})`);
  }

  samples.sort((a, b) => a - b);
  const min = samples[0];
  const max = samples[samples.length - 1];
  const median = (samples[9] + samples[10]) / 2;
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const p95 = samples[Math.floor(samples.length * 0.95)];

  console.log(`\n--- Latency Results [MEASURED] ---`);
  console.log(`Min:    ${min.toFixed(2)} ms`);
  console.log(`Median: ${median.toFixed(2)} ms`);
  console.log(`Mean:   ${avg.toFixed(2)} ms`);
  console.log(`p95:    ${p95.toFixed(2)} ms`);
  console.log(`Max:    ${max.toFixed(2)} ms`);

  // Write JSON artifact
  const result = {
    rpc_url: rpcUrl,
    num_samples: 20,
    min_ms: parseFloat(min.toFixed(2)),
    median_ms: parseFloat(median.toFixed(2)),
    mean_ms: parseFloat(avg.toFixed(2)),
    p95_ms: parseFloat(p95.toFixed(2)),
    max_ms: parseFloat(max.toFixed(2)),
    measured_at: new Date().toISOString(),
  };

  console.log(`\nJSON Output:`, JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
