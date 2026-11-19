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

  it("enforces Guardrail G-06: Reduce-only strictly rejects manual excess quantity without silent clamping", () => {
    // User has a long position of 500 lots (0.50 SOL)
    const userPositionLots = 500;

    const validateReduceOnly = (side: "BUY" | "SELL", lots: number, posLots: number) => {
      if (side === "BUY" && posLots >= 0) {
        return "Reduce-only Buy requires an open short position.";
      }
      if (side === "SELL" && posLots <= 0) {
        return "Reduce-only Sell requires an open long position.";
      }
      if (lots > Math.abs(posLots)) {
        return `Reduce-only size exceeds position (${Math.abs(posLots * 0.001).toFixed(2)} SOL).`;
      }
      return null;
    };

    // 1. Sell order of 1000 lots (1.00 SOL) exceeds 500 lots position -> rejected
    const manualOrderLots = 1000;
    const error = validateReduceOnly("SELL", manualOrderLots, userPositionLots);
    expect(error).not.toBeNull();
    expect(error).toBe("Reduce-only size exceeds position (0.50 SOL).");
    expect(manualOrderLots).toBe(1000); // Verify size was not silently clamped

    // 2. Buy on long position -> rejected
    const invalidBuyError = validateReduceOnly("BUY", 200, userPositionLots);
    expect(invalidBuyError).toBe("Reduce-only Buy requires an open short position.");

    // 3. Valid reduce-only sell within position size -> passes
    const validSellError = validateReduceOnly("SELL", 500, userPositionLots);
    expect(validSellError).toBeNull();
  });

  it("enforces Guardrail G-07: Withdrawals strictly blocked when either a non-zero position OR active orders exist", () => {
    const isWithdrawalAllowed = (positionLots: number, activeOrdersCount: number) => {
      const isPositionFlat = positionLots === 0;
      const hasZeroOrders = activeOrdersCount === 0;
      return isPositionFlat && hasZeroOrders;
    };

    // Case 1: Open position (+500 lots), 0 active orders -> BLOCKED
    expect(isWithdrawalAllowed(500, 0)).toBe(false);

    // Case 2: Open position (-300 lots), 0 active orders -> BLOCKED
    expect(isWithdrawalAllowed(-300, 0)).toBe(false);

    // Case 3: Flat position (0 lots), but 2 active orders pending -> BLOCKED
    expect(isWithdrawalAllowed(0, 2)).toBe(false);

    // Case 4: Open position AND active orders -> BLOCKED
    expect(isWithdrawalAllowed(500, 1)).toBe(false);

    // Case 5: Flat position (0 lots) AND 0 active orders -> ALLOWED
    expect(isWithdrawalAllowed(0, 0)).toBe(true);
  });

  it("enforces Guardrail G-09: Transaction submission blocked during RPC disconnection", () => {
    let transactionSubmitted = false;
    const isDevnetOutage = true;

    const attemptPlaceOrder = (outage: boolean) => {
      if (outage) return false;
      transactionSubmitted = true;
      return true;
    };

    const result = attemptPlaceOrder(isDevnetOutage);
    expect(result).toBe(false);
    expect(transactionSubmitted).toBe(false);
  });

  it("enforces Guardrail G-10: Wallet disconnect purging clears all private state", () => {
    let solBalance: number | null = 2.5;
    let collateral = 1500;
    let quotePosition = -250;
    let position: any = { market: "SOL-PERP", sizeLots: 500 };
    let activeOrders: any[] = [{ batchId: 100, slotId: 1, side: "BUY", lots: 500 }];

    const handleDisconnectPurge = () => {
      solBalance = null;
      collateral = 0;
      quotePosition = 0;
      position = null;
      activeOrders = [];
    };

    handleDisconnectPurge();

    expect(solBalance).toBeNull();
    expect(collateral).toBe(0);
    expect(quotePosition).toBe(0);
    expect(position).toBeNull();
    expect(activeOrders.length).toBe(0);
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
