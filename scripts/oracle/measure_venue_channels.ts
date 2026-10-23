#!/usr/bin/env bun
/**
 * Benchmark Script: Venue Update Rates and Price Age Distribution
 *
 * Measures:
 * 1. Messages per second for all 6 venues (including new Coinbase level2_batch and Kraken BBO channels).
 * 2. Gap between updates (p50, p95).
 * 3. Age of each venue's price actually used in the median aggregate.
 */

import { MultiVenueAggregator } from "../../keeper/src/aggregator";
import { APPROVED_FEEDS } from "../../keeper/src/aggregator/aggregator";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("===============================================================================");
  console.log("       MEASURING VENUE CHANNELS: UPDATE RATES & AGE DISTRIBUTION               ");
  console.log("===============================================================================");

  const aggregator = new MultiVenueAggregator({
    heartbeatMaxAgeMs: 10_000,
  });

  aggregator.start();
  console.log("Connecting to all 6 venue WebSockets...");

  // Wait for initial connections
  await sleep(3000);

  const durationSec = 60; // 60 seconds benchmark
  console.log(`Sampling live feeds for ${durationSec} seconds...`);

  // Venue-specific age tracking
  const venueAges: Record<string, number[]> = {
    coinbase: [],
    kraken: [],
    bybit: [],
    backpack: [],
    hyperliquid: [],
    binance: [],
  };

  const initialHealth = aggregator.getVenueHealth();
  const initialCounts: Record<string, number> = {};
  for (const h of initialHealth) {
    initialCounts[h.venueId] = h.messageCount;
  }

  const startTime = Date.now();
  let samplesCount = 0;

  for (let s = 0; s < durationSec * 2; s++) { // Sample twice per second (500ms)
    await sleep(500);
    const agg = aggregator.getLatestAggregate();
    if (agg && agg.sourceAgesMs) {
      samplesCount++;
      for (const [vId, age] of Object.entries(agg.sourceAgesMs)) {
        if (venueAges[vId]) {
          venueAges[vId].push(age);
        }
      }
    }
  }

  const endTime = Date.now();
  const totalElapsedSec = (endTime - startTime) / 1000;
  const finalHealth = aggregator.getVenueHealth();

  console.log("\n===============================================================================");
  console.log(`RESULTS: VENUE UPDATE RATES (${totalElapsedSec.toFixed(1)}s run) [MEASURED]`);
  console.log("===============================================================================");
  console.log(
    "Venue".padEnd(14) +
    "Channel Type".padEnd(20) +
    "Total Msgs".padEnd(14) +
    "Msgs/sec".padEnd(12) +
    "Avg Gap (ms)"
  );
  console.log("-".repeat(70));

  for (const h of finalHealth) {
    const msgs = h.messageCount - (initialCounts[h.venueId] || 0);
    const msgsPerSec = (msgs / totalElapsedSec).toFixed(2);
    const avgGapMs = msgs > 0 ? (totalElapsedSec * 1000 / msgs).toFixed(0) : "N/A";
    const channelType =
      h.venueId === "coinbase" ? "level2_batch (book)" :
      h.venueId === "kraken" ? "ticker BBO (book)" :
      h.venueId === "bybit" ? "orderbook.1 (book)" :
      h.venueId === "backpack" ? "bookTicker (book)" :
      h.venueId === "hyperliquid" ? "l2Book (book)" :
      "bookTicker (book)";

    console.log(
      h.name.padEnd(14) +
      channelType.padEnd(20) +
      msgs.toString().padEnd(14) +
      msgsPerSec.padEnd(12) +
      avgGapMs
    );
  }

  console.log("\n===============================================================================");
  console.log("AGE DISTRIBUTION OF VENUE PRICES ACTUALLY USED IN MEDIAN (ms) [MEASURED]");
  console.log("===============================================================================");
  console.log(
    "Venue".padEnd(14) +
    "Samples".padEnd(10) +
    "Min".padEnd(8) +
    "P50".padEnd(8) +
    "P90".padEnd(8) +
    "P99".padEnd(8) +
    "Max"
  );
  console.log("-".repeat(70));

  function percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }

  for (const [vId, ages] of Object.entries(venueAges)) {
    if (ages.length === 0) {
      console.log(`${vId.padEnd(14)}: No samples`);
      continue;
    }
    const min = Math.min(...ages);
    const p50 = percentile(ages, 50);
    const p90 = percentile(ages, 90);
    const p99 = percentile(ages, 99);
    const max = Math.max(...ages);

    console.log(
      vId.padEnd(14) +
      ages.length.toString().padEnd(10) +
      min.toString().padEnd(8) +
      p50.toString().padEnd(8) +
      p90.toString().padEnd(8) +
      p99.toString().padEnd(8) +
      max.toString()
    );
  }

  aggregator.stop();
  console.log("\nMeasurement completed.");
}

main().catch(console.error);
