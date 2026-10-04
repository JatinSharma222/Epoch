/**
 * Epoch Reference Clearing Engine (TypeScript Port for T-29 & Client-Side Preview).
 *
 * Implements the exact uniform-price double-auction matching algorithm
 * specified in docs/02-MECHANISM_SPEC.md §4-§6 and crates/epoch-ref/src/lib.rs.
 * Validated against shared golden test vectors (UX-1).
 */

export interface Marginal {
  tick: number;
  alloc: number;
  total: number;
}

export interface ClearResult {
  tick: number;
  matched: number;
  bid: Marginal;
  ask: Marginal;
  clearingPrice?: number;
}

export interface OrderInput {
  side: number; // 0 = BUY, 1 = SELL
  tick: number; // 0..K-1
  lots: number;
}

/**
 * Deterministic tie-breaker for midpoint rounding.
 * Picks the candidate integer strictly closer to the center tick `c`.
 */
export function midpoint(lo: number, hi: number, c: number): number {
  const sum = lo + hi;
  const m = Math.floor(sum / 2);
  if (sum % 2 === 0) {
    return m;
  }
  const d_m = Math.abs(m - c);
  const d_m1 = Math.abs(m + 1 - c);
  return d_m1 < d_m ? m + 1 : m;
}

/**
 * Runs the uniform clearing auction algorithm on aggregate tick arrays.
 * Implements docs/02-MECHANISM_SPEC.md §4:
 * 1. D[t] = suffix sum of bids; S[t] = prefix sum of asks.
 * 2. V[t] = min(D[t], S[t]). Vmax = max(V[t]). If Vmax == 0, returns null.
 * 3. Plateau P = { t : V[t] == Vmax }.
 * 4. Min-imbalance Q = argmin |D[t] - S[t]| in P.
 * 5. i* = midpoint(min(Q), max(Q), c).
 * 6. Computes buy/sell marginal ticks and allocations.
 */
export function clear(
  bidQty: (number | bigint)[],
  askQty: (number | bigint)[]
): ClearResult | null {
  const k = bidQty.length;
  if (k === 0 || askQty.length !== k) return null;
  const c = Math.floor((k - 1) / 2);

  const bids = bidQty.map(Number);
  const asks = askQty.map(Number);

  // Cumulative Demand D[t] = sum of bids at tick >= t
  const d = new Array(k + 1).fill(0);
  for (let t = k - 1; t >= 0; t--) {
    d[t] = d[t + 1] + bids[t];
  }

  // Cumulative Supply S[t] = sum of asks at tick <= t
  const s = new Array(k).fill(0);
  let acc = 0;
  for (let t = 0; t < k; t++) {
    acc += asks[t];
    s[t] = acc;
  }

  // V[t] = min(D[t], S[t])
  let vmax = 0;
  for (let t = 0; t < k; t++) {
    const v = Math.min(d[t], s[t]);
    if (v > vmax) vmax = v;
  }
  if (vmax === 0) return null;

  // Plateau P: contiguous interval where V == Vmax
  const plateau: number[] = [];
  for (let t = 0; t < k; t++) {
    if (Math.min(d[t], s[t]) === vmax) {
      plateau.push(t);
    }
  }

  // Min imbalance in plateau
  let minImb = Infinity;
  for (const t of plateau) {
    const imb = Math.abs(d[t] - s[t]);
    if (imb < minImb) minImb = imb;
  }
  const q: number[] = [];
  for (const t of plateau) {
    if (Math.abs(d[t] - s[t]) === minImb) {
      q.push(t);
    }
  }

  const lo = q[0];
  const hi = q[q.length - 1];
  const iStar = midpoint(lo, hi, c);
  const qStar = vmax;

  // Buy-side marginal: t_b = max{t : D[t] >= Q*}
  let t_b = -1;
  for (let t = k - 1; t >= 0; t--) {
    if (d[t] >= qStar) {
      t_b = t;
      break;
    }
  }
  const m_b = qStar - d[t_b + 1];

  // Sell-side marginal: t_a = min{t : S[t] >= Q*}
  let t_a = -1;
  for (let t = 0; t < k; t++) {
    if (s[t] >= qStar) {
      t_a = t;
      break;
    }
  }
  const m_a = qStar - (t_a === 0 ? 0 : s[t_a - 1]);

  return {
    tick: iStar,
    matched: qStar,
    bid: {
      tick: t_b,
      alloc: m_b,
      total: bids[t_b],
    },
    ask: {
      tick: t_a,
      alloc: m_a,
      total: asks[t_a],
    },
  };
}

/**
 * Calculates uniform discrete clearing price in micro-USDC.
 * Formula (spec §4):
 * offset_bps = (tick - c) * tick_bps
 * raw = round(oracle_price * (10,000 + offset_bps) / 10,000)
 * rounded = round(raw / price_tick) * price_tick
 */
export function clearingPrice(
  oraclePrice: number | bigint,
  clearingTick: number,
  kTicks: number = 101,
  tickBps: number = 1,
  priceTick: number = 1000
): number {
  const p = BigInt(oraclePrice);
  const c = BigInt(Math.floor((kTicks - 1) / 2));
  const offsetTicks = BigInt(clearingTick) - c;
  const offsetBps = offsetTicks * BigInt(tickBps);

  const num = p * (BigInt(10_000) + offsetBps);
  const raw = (num + BigInt(5_000)) / BigInt(10_000);
  const pt = BigInt(priceTick);
  const rounded = ((raw + pt / BigInt(2)) / pt) * pt;
  return Number(rounded);
}

/**
 * Allocates order-level fills according to 02-MECHANISM_SPEC §5:
 * Strictly better orders fill 100%.
 * Marginal tick fills pro-rata with buffer-order dust (+1 lot).
 * Out-of-the-money orders fill 0.
 */
export function allocateOrderFills(
  orders: OrderInput[],
  result: ClearResult
): number[] {
  const fills = new Array(orders.length).fill(0);

  // Group marginal indices
  const buyMarginalIndices: number[] = [];
  const sellMarginalIndices: number[] = [];

  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    if (o.side === 0) {
      // BUY
      if (o.tick > result.bid.tick) {
        fills[i] = o.lots; // strictly better
      } else if (o.tick === result.bid.tick) {
        buyMarginalIndices.push(i);
      }
    } else {
      // SELL
      if (o.tick < result.ask.tick) {
        fills[i] = o.lots; // strictly better
      } else if (o.tick === result.ask.tick) {
        sellMarginalIndices.push(i);
      }
    }
  }

  // Allocate buy marginal
  if (result.bid.total > 0 && buyMarginalIndices.length > 0) {
    let allocatedFloor = 0;
    const remainders: { idx: number; rem: number }[] = [];

    for (const idx of buyMarginalIndices) {
      const lots = orders[idx].lots;
      const floorFill = Math.floor((lots * result.bid.alloc) / result.bid.total);
      fills[idx] = floorFill;
      allocatedFloor += floorFill;
      const rem = (lots * result.bid.alloc) % result.bid.total;
      remainders.push({ idx, rem });
    }

    let dust = result.bid.alloc - allocatedFloor;
    for (const r of remainders) {
      if (dust <= 0) break;
      if (r.rem > 0 && fills[r.idx] < orders[r.idx].lots) {
        fills[r.idx] += 1;
        dust -= 1;
      }
    }
  }

  // Allocate sell marginal
  if (result.ask.total > 0 && sellMarginalIndices.length > 0) {
    let allocatedFloor = 0;
    const remainders: { idx: number; rem: number }[] = [];

    for (const idx of sellMarginalIndices) {
      const lots = orders[idx].lots;
      const floorFill = Math.floor((lots * result.ask.alloc) / result.ask.total);
      fills[idx] = floorFill;
      allocatedFloor += floorFill;
      const rem = (lots * result.ask.alloc) % result.ask.total;
      remainders.push({ idx, rem });
    }

    let dust = result.ask.alloc - allocatedFloor;
    for (const r of remainders) {
      if (dust <= 0) break;
      if (r.rem > 0 && fills[r.idx] < orders[r.idx].lots) {
        fills[r.idx] += 1;
        dust -= 1;
      }
    }
  }

  return fills;
}

/**
 * Matched Volume Highlight Calculator (09-UX_SPEC.md §3.3).
 * Produces the styling classification for every tick in [0, K):
 * - isSolidMatched: 100% matched fills (solid 1px border box).
 * - isMarginal: marginal tick with partial pro-rata allocation (dashed 1px border box).
 * - marginalPct: allocation percentage formatted (e.g. 62.5%).
 * - isClearingLine: horizontal clearing price line.
 */
export interface TickHighlight {
  tick: number;
  bidStatus: "empty" | "unmatched" | "matched" | "marginal";
  bidAllocLots: number;
  bidMarginalPct: number;
  askStatus: "empty" | "unmatched" | "matched" | "marginal";
  askAllocLots: number;
  askMarginalPct: number;
  isClearingLine: boolean;
}

export function computeMatchedHighlights(
  bidQty: number[],
  askQty: number[],
  result: ClearResult | null,
  kTicks: number = 101
): TickHighlight[] {
  const highlights: TickHighlight[] = [];

  for (let t = 0; t < kTicks; t++) {
    const hasBids = (bidQty[t] || 0) > 0;
    const hasAsks = (askQty[t] || 0) > 0;

    let bidStatus: TickHighlight["bidStatus"] = hasBids ? "unmatched" : "empty";
    let bidAllocLots = 0;
    let bidMarginalPct = 0;

    let askStatus: TickHighlight["askStatus"] = hasAsks ? "unmatched" : "empty";
    let askAllocLots = 0;
    let askMarginalPct = 0;

    const isClearingLine = result !== null && t === result.tick;

    if (result && result.matched > 0) {
      // Buy side: ticks > bid.tick are fully matched; tick == bid.tick is marginal
      if (hasBids) {
        if (t > result.bid.tick) {
          bidStatus = "matched";
          bidAllocLots = bidQty[t] || 0;
        } else if (t === result.bid.tick && result.bid.alloc > 0) {
          if (result.bid.alloc === result.bid.total) {
            bidStatus = "matched";
            bidAllocLots = result.bid.alloc;
          } else {
            bidStatus = "marginal";
            bidAllocLots = result.bid.alloc;
            bidMarginalPct = (result.bid.alloc / result.bid.total) * 100;
          }
        }
      }

      // Sell side: ticks < ask.tick are fully matched; tick == ask.tick is marginal
      if (hasAsks) {
        if (t < result.ask.tick) {
          askStatus = "matched";
          askAllocLots = askQty[t] || 0;
        } else if (t === result.ask.tick && result.ask.alloc > 0) {
          if (result.ask.alloc === result.ask.total) {
            askStatus = "matched";
            askAllocLots = result.ask.alloc;
          } else {
            askStatus = "marginal";
            askAllocLots = result.ask.alloc;
            askMarginalPct = (result.ask.alloc / result.ask.total) * 100;
          }
        }
      }
    }

    highlights.push({
      tick: t,
      bidStatus,
      bidAllocLots,
      bidMarginalPct,
      askStatus,
      askAllocLots,
      askMarginalPct,
      isClearingLine,
    });
  }

  return highlights;
}

/**
 * UX-2: Price-to-offset conversion (09-UX_SPEC.md §4).
 * Converts dollar limit price to oracle offset in basis points,
 * clamped to [-50, +50] with tick rounding.
 */
export function priceToOffset(
  limitPriceUsd: number,
  oraclePriceUsd: number,
  tickBps: number = 1,
  kHalf: number = 50
): { offsetBps: number; effectivePriceUsd: number; clamped: boolean } {
  const rawOffset = Math.round(
    (10_000 * (limitPriceUsd - oraclePriceUsd)) / oraclePriceUsd
  );
  let offsetTicks = Math.round(rawOffset / tickBps);
  let clamped = false;
  if (offsetTicks > kHalf) {
    offsetTicks = kHalf;
    clamped = true;
  } else if (offsetTicks < -kHalf) {
    offsetTicks = -kHalf;
    clamped = true;
  }
  const effectiveOffsetBps = offsetTicks * tickBps;
  const effectivePriceUsd =
    Math.round(oraclePriceUsd * (1 + effectiveOffsetBps / 10_000) * 1000) / 1000;

  return { offsetBps: effectiveOffsetBps, effectivePriceUsd, clamped };
}

/**
 * UX-4: Liquidation price formula (09-UX_SPEC.md §7.3).
 * Solves for price p where Equity(p) == MMR * MaintenanceNotional(p).
 */
export function computeLiquidationPrice(
  collateralMicroUsdc: number,
  quotePositionMicroUsdc: number,
  baseLots: number,
  pendingFundingMicroUsdc: number,
  mmrBps: number = 500 // 5%
): number {
  if (baseLots === 0) return 0;
  const c = collateralMicroUsdc + quotePositionMicroUsdc - pendingFundingMicroUsdc;
  const b = baseLots; // lots (1 lot = 0.001 SOL)
  const mmr = mmrBps / 10_000;

  if (b > 0) {
    // Long liquidation: equity drops below MMR
    // C + Q + (b * p / 1000) = mmr * (b * p / 1000)
    // p * (b/1000) * (1 - mmr) = -c
    // p = -c / ((b/1000) * (1 - mmr))
    const p = -c / ((b / 1000) * (1 - mmr));
    return Math.max(0, Math.round(p));
  } else {
    // Short liquidation:
    // C + Q + (b * p / 1000) = mmr * (|b| * p / 1000)
    // c - (|b| * p / 1000) = mmr * (|b| * p / 1000)
    // p * (|b|/1000) * (1 + mmr) = c
    // p = c / ((|b| / 1000) * (1 + mmr))
    const absB = Math.abs(b);
    const p = c / ((absB / 1000) * (1 + mmr));
    return Math.max(0, Math.round(p));
  }
}
