import * as fs from "fs";
import * as path from "path";
import {
  clear,
  clearingPrice,
  allocateOrderFills,
  computeMatchedHighlights,
} from "../app/src/lib/clearingEngine";

interface GoldenVector {
  id: string;
  oracle_price: number;
  tick_bps: number;
  k_ticks: number;
  bid_qty: number[];
  ask_qty: number[];
  orders: { side: number; tick: number; lots: number }[];
  expected: {
    cleared: boolean;
    clearing_tick: number;
    clearing_price: number;
    matched_lots: number;
    bid_marginal_tick: number;
    bid_marginal_alloc: number;
    bid_marginal_total: number;
    ask_marginal_tick: number;
    ask_marginal_alloc: number;
    ask_marginal_total: number;
    order_fills: number[];
  };
}

async function runAcceptanceTests() {
  console.log("=== Running Acceptance Tests UX-1, UX-9, UX-10, UX-11 (T-29) ===");

  const vectorsPath = path.resolve(__dirname, "../evidence/golden_vectors.json");
  if (!fs.existsSync(vectorsPath)) {
    throw new Error(`Golden vectors file not found at ${vectorsPath}`);
  }

  const raw = fs.readFileSync(vectorsPath, "utf-8");
  const vectors: GoldenVector[] = JSON.parse(raw);
  console.log(`Loaded ${vectors.length} golden vectors.`);

  let ux1Passed = 0;
  let ux9Passed = 0;
  let ux10Passed = 0;
  let ux11Passed = 0;

  for (let idx = 0; idx < vectors.length; idx++) {
    const v = vectors[idx];
    const res = clear(v.bid_qty, v.ask_qty);

    if (!v.expected.cleared) {
      if (res === null) {
        ux1Passed++;
        ux9Passed++;
        ux10Passed++;
        ux11Passed++;
      } else {
        console.error(`Mismatch on vector ${v.id}: expected no trade, got trade`);
      }
      continue;
    }

    if (!res) {
      console.error(`Mismatch on vector ${v.id}: expected trade, got null`);
      continue;
    }

    // UX-1 Check: tick, matched, clearing price, marginals, and fills match reference engine
    const price = clearingPrice(v.oracle_price, res.tick, v.k_ticks, v.tick_bps, 1000);
    const fills = allocateOrderFills(v.orders, res);

    const ux1Match =
      res.tick === v.expected.clearing_tick &&
      res.matched === v.expected.matched_lots &&
      price === v.expected.clearing_price &&
      res.bid.tick === v.expected.bid_marginal_tick &&
      res.bid.alloc === v.expected.bid_marginal_alloc &&
      res.bid.total === v.expected.bid_marginal_total &&
      res.ask.tick === v.expected.ask_marginal_tick &&
      res.ask.alloc === v.expected.ask_marginal_alloc &&
      res.ask.total === v.expected.ask_marginal_total &&
      JSON.stringify(fills) === JSON.stringify(v.expected.order_fills);

    if (ux1Match) {
      ux1Passed++;
    } else {
      console.error(`UX-1 failed on vector ${v.id}:`, {
        got: { tick: res.tick, matched: res.matched, price },
        expected: v.expected,
      });
      process.exit(1);
    }

    // UX-9, UX-10, UX-11 Checks on Matched-Volume Highlights (09-UX_SPEC §3.3)
    const highlights = computeMatchedHighlights(v.bid_qty, v.ask_qty, res, v.k_ticks);

    // UX-9: Boxed rows equal filled ticks
    let ux9Match = true;
    for (const h of highlights) {
      // If tick > bid marginal tick and has bids, must be 'matched'
      if (h.tick > res.bid.tick && v.bid_qty[h.tick] > 0) {
        if (h.bidStatus !== "matched") ux9Match = false;
      }
      // If tick < ask marginal tick and has asks, must be 'matched'
      if (h.tick < res.ask.tick && v.ask_qty[h.tick] > 0) {
        if (h.askStatus !== "matched") ux9Match = false;
      }
    }
    if (ux9Match) ux9Passed++;

    // UX-10: Marginal row percentage equals M / T, dashed border appears only on t_b and t_a
    let ux10Match = true;
    for (const h of highlights) {
      if (h.bidStatus === "marginal") {
        if (h.tick !== res.bid.tick) ux10Match = false;
        const expectedPct = (res.bid.alloc / res.bid.total) * 100;
        if (Math.abs(h.bidMarginalPct - expectedPct) > 0.01) ux10Match = false;
      }
      if (h.askStatus === "marginal") {
        if (h.tick !== res.ask.tick) ux10Match = false;
        const expectedPct = (res.ask.alloc / res.ask.total) * 100;
        if (Math.abs(h.askMarginalPct - expectedPct) > 0.01) ux10Match = false;
      }
    }
    if (ux10Match) ux10Passed++;

    // UX-11: Rationality on screen: no matched bid is below clearing line (tick < clearingTick)
    // and no matched ask is above clearing line (tick > clearingTick)
    let ux11Match = true;
    for (const h of highlights) {
      if ((h.bidStatus === "matched" || h.bidStatus === "marginal") && h.tick < res.tick) {
        ux11Match = false;
      }
      if ((h.askStatus === "matched" || h.askStatus === "marginal") && h.tick > res.tick) {
        ux11Match = false;
      }
    }
    if (ux11Match) ux11Passed++;
  }

  console.log("\n=== Test Results Summary ===");
  console.log(`UX-1 (Indicative Price & Golden Vector Match): ${ux1Passed}/${vectors.length} PASSED [MEASURED]`);
  console.log(`UX-9 (Matched-Volume Solid Highlight Parity): ${ux9Passed}/${vectors.length} PASSED [MEASURED]`);
  console.log(`UX-10 (Marginal Pro-Rata % & Dashed Border): ${ux10Passed}/${vectors.length} PASSED [MEASURED]`);
  console.log(`UX-11 (On-Screen Matching Rationality): ${ux11Passed}/${vectors.length} PASSED [MEASURED]`);

  if (
    ux1Passed === vectors.length &&
    ux9Passed === vectors.length &&
    ux10Passed === vectors.length &&
    ux11Passed === vectors.length
  ) {
    console.log("\nALL ACCEPTANCE TESTS (UX-1, UX-9, UX-10, UX-11) PASSED! (Gate G3 Ready)\n");
  } else {
    process.exit(1);
  }
}

runAcceptanceTests().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
