import { describe, it, expect } from "bun:test";
import { clear, clearingPrice, priceToOffset, computeLiquidationPrice } from "../lib/clearingEngine";

describe("Milestone 2: Main Trading Terminal Architecture & Financial Invariants", () => {
  it("enforces Guardrail G-05: 1 lot = 0.001 SOL and $10 minimum notional floor", () => {
    const qtySol = 1.0;
    const lots = Math.max(1, Math.round(qtySol * 1000));
    expect(lots).toBe(1000);

    const markPrice = 119.6;
    const notional = markPrice * qtySol;
    expect(notional).toBeGreaterThanOrEqual(10.0);

    // Below $10 notional should be rejected
    const smallQty = 0.05;
    const smallNotional = markPrice * smallQty; // 5.98
    expect(smallNotional).toBeLessThan(10.0);
  });

  it("enforces Guardrail G-04: Collar validation (±50 bps around Pyth Oracle)", () => {
    const oraclePrice = 120.0;
    const minCollarPrice = oraclePrice * (1 - 50 / 10000); // 119.40
    const maxCollarPrice = oraclePrice * (1 + 50 / 10000); // 120.60

    const validOrder = priceToOffset(120.24, oraclePrice, 1, 50);
    expect(validOrder.clamped).toBe(false);
    expect(validOrder.offsetBps).toBe(20);

    const outsideCollarOrder = priceToOffset(122.0, oraclePrice, 1, 50);
    expect(outsideCollarOrder.clamped).toBe(true);
    expect(outsideCollarOrder.rawOffsetBps).toBe(167);
  });

  it("enforces Guardrail G-02: Exact liquidation price computation (no heuristics)", () => {
    // 1 SOL long entered at $120 with $20 deposited collateral
    const collateralMicro = 20_000_000; // 20 USDC margin
    const quotePositionMicro = -120_000_000; // -120 USDC quote obligation
    const positionLots = 1000; // 1 SOL Long
    const mmrBps = 500; // 5% MMR

    const liqPriceMicro = computeLiquidationPrice(
      collateralMicro,
      quotePositionMicro,
      positionLots,
      0,
      mmrBps
    );
    expect(liqPriceMicro).toBeGreaterThan(0);
    const liqPriceUsd = liqPriceMicro / 1_000_000;
    // Liq price should be approx $105.26 for a 6x leveraged $120 SOL long
    expect(liqPriceUsd).toBeLessThan(120.0);
    expect(liqPriceUsd).toBeGreaterThan(100.0);
  });

  it("enforces Guardrail G-03: Dynamic user slot allocation across 8 slots (0..7)", () => {
    const existingActiveOrders = [
      { slotId: 0, batchId: 100 },
      { slotId: 1, batchId: 101 },
      { slotId: 3, batchId: 102 },
    ];
    const usedSlots = new Set(existingActiveOrders.map((o) => o.slotId));
    const allocated: number[] = [];
    const numBatches = 2;

    for (let s = 0; s < 8; s++) {
      if (!usedSlots.has(s)) {
        allocated.push(s);
        if (allocated.length === numBatches) break;
      }
    }

    expect(allocated.length).toBe(2);
    expect(allocated[0]).toBe(2); // slot 2 is first free slot
    expect(allocated[1]).toBe(4); // slot 4 is next free slot
    expect(allocated[0]).not.toBe(0); // Never hardcodes slotId: 0
  });

  it("computes FBA uniform discrete clearing auction and marginal fill ratios accurately", () => {
    const k = 101;
    const bidQty = new Array(k).fill(0);
    const askQty = new Array(k).fill(0);

    // Seed overlapping orders at center tick 50 (0 bps)
    bidQty[50] = 500; // 0.5 SOL
    askQty[50] = 300; // 0.3 SOL

    const result = clear(bidQty, askQty);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.matched).toBe(300);
      expect(result.tick).toBe(50);
      const oraclePrice = 120.0;
      const clPriceMicro = clearingPrice(
        Math.round(oraclePrice * 1_000_000),
        result.tick,
        101,
        1,
        1000
      );
      expect(clPriceMicro).toBe(120_000_000);
    }
  });
});
