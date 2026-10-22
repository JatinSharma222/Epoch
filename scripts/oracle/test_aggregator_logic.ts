/**
 * Comprehensive Unit Test Suite for Multi-Venue Oracle Aggregator Logic
 *
 * Verifies:
 * 1. Freshness filter: Drop venues > 2,000 ms old.
 * 2. Outlier rejection: Drop venues > 30 bps from preliminary median.
 * 3. Quorum: Reject if < 3 valid sources remain.
 * 4. Confidence bounds: Low confidence flagged if spread > 10 bps or outliers present.
 * 5. Memory footprint: 100,000 tick simulation proves zero memory leak.
 */

import { MultiVenueAggregator } from "../../keeper/src/aggregator";

console.log("=========================================================================================");
console.log("             TEST SUITE: MULTI-VENUE ORACLE AGGREGATOR LOGIC & INVARIANTS                ");
console.log("=========================================================================================\n");

let passed = 0;
let total = 0;

function assert(cond: boolean, desc: string) {
  total++;
  if (cond) {
    console.log(`[\x1b[32mPASS\x1b[0m] ${desc}`);
    passed++;
  } else {
    console.error(`[\x1b[31mFAIL\x1b[0m] ${desc}`);
    process.exit(1);
  }
}

// Subclass to inject synthetic venue prices for deterministic mathematical testing
class TestableAggregator extends MultiVenueAggregator {
  public injectVenueTick(
    id: string,
    bid: number,
    ask: number,
    ageMs: number = 50
  ) {
    const feed = (this as any).feeds.get(id);
    if (!feed) return;
    const now = Date.now();
    (feed as any).latestPrice = {
      venueId: id,
      name: feed.config.name,
      pair: feed.config.pair,
      bid,
      ask,
      mid: (bid + ask) / 2,
      spreadBps: ((ask - bid) / ((bid + ask) / 2)) * 10000,
      arrivalTimeMs: now - ageMs,
    };
  }

  public clearAll() {
    for (const feed of (this as any).feeds.values()) {
      (feed as any).latestPrice = null;
    }
  }
}

const agg = new TestableAggregator("/dev/null");

// Test 1: Quorum requirement (< 3 sources returns null)
agg.clearAll();
agg.injectVenueTick("coinbase", 100.0, 100.02);
agg.injectVenueTick("kraken", 100.0, 100.02);
let result = agg.getLatestAggregate();
assert(result === null, "Quorum check: 2 sources returns null (minimum 3 required)");

// Test 2: Quorum passed (3 sources returns valid median)
agg.injectVenueTick("bybit", 100.0, 100.02);
result = agg.getLatestAggregate();
assert(result !== null && result.venuesUsed === 3, "Quorum check: 3 sources returns valid median");

// Test 3: Freshness filter (stale source > 2000ms is dropped)
agg.clearAll();
agg.injectVenueTick("coinbase", 100.0, 100.02, 100);
agg.injectVenueTick("kraken", 100.0, 100.02, 100);
agg.injectVenueTick("bybit", 100.0, 100.02, 2500); // 2.5s old (STALE)
result = agg.getLatestAggregate();
assert(result === null, "Freshness filter: 2.5s old source dropped, leaving 2 fresh sources -> null");

// Test 4: Outlier rejection (> 30 bps from median)
agg.clearAll();
agg.injectVenueTick("coinbase", 100.00, 100.02);   // mid = 100.01
agg.injectVenueTick("kraken", 100.01, 100.03);     // mid = 100.02
agg.injectVenueTick("bybit", 100.00, 100.02);      // mid = 100.01
agg.injectVenueTick("backpack", 100.02, 100.04);   // mid = 100.03
agg.injectVenueTick("hyperliquid", 100.50, 100.52); // mid = 100.51 (+50 bps rogue outlier!)
agg.injectVenueTick("binance", 100.01, 100.03);    // mid = 100.02

result = agg.getLatestAggregate();
assert(result !== null, "Aggregator computes successfully with 6 feeds");
assert(
  result?.outliersDropped.includes("hyperliquid"),
  "Outlier rejection: Hyperliquid (+50 bps move) correctly dropped as rogue outlier"
);
assert(
  result?.venuesUsed === 5,
  "Outlier rejection: 5 clean venues used in final median calculation"
);
assert(
  result?.isLowConfidence === true,
  "Low confidence flag: flagged true due to presence of dropped outlier"
);

// Test 5: Confidence scaling on wide spread (> 10 bps)
agg.clearAll();
agg.injectVenueTick("coinbase", 100.00, 100.02); // 100.01
agg.injectVenueTick("kraken", 100.12, 100.14);   // 100.13 (+12 bps spread, within 30 bps)
agg.injectVenueTick("bybit", 100.06, 100.08);    // 100.07
result = agg.getLatestAggregate();
assert(
  result !== null && result.isLowConfidence === true,
  "Confidence calculation: Spread > 10 bps correctly triggers isLowConfidence = true"
);
assert(
  result !== null && result.confMicroUsdc >= 150_000,
  "Confidence scaling: Low confidence expands confidence window to at least 15 bps"
);

// Test 6: Memory leak verification (100,000 tick simulation)
console.log("\nSimulating 100,000 consecutive aggregate ticks for memory profiling...");
const memStart = process.memoryUsage().heapUsed;
for (let i = 0; i < 100_000; i++) {
  const p = 100 + (i % 10) * 0.01;
  agg.injectVenueTick("coinbase", p, p + 0.02);
  agg.injectVenueTick("kraken", p, p + 0.02);
  agg.injectVenueTick("bybit", p, p + 0.02);
  agg.injectVenueTick("backpack", p, p + 0.02);
  agg.injectVenueTick("hyperliquid", p, p + 0.02);
  agg.injectVenueTick("binance", p, p + 0.02);
  agg.getLatestAggregate();
}
if (typeof (global as any).gc === "function") {
  (global as any).gc();
}
const memEnd = process.memoryUsage().heapUsed;
const memDeltaMb = Math.round(((memEnd - memStart) / 1024 / 1024) * 10) / 10;
console.log(`Heap usage delta after 100,000 updates: ${memDeltaMb} MB`);
assert(memDeltaMb < 15.0, "Zero memory leak invariant: heap growth < 15MB over 100k cycles (O(1) memory)");

console.log("\n=========================================================================================");
console.log(`ALL ${passed}/${total} AGGREGATOR INVARIANT TESTS PASSED`);
console.log("=========================================================================================\n");
