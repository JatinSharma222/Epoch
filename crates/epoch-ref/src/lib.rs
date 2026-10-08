//! Epoch Reference Clearing Engine
//!
//! Independent reference implementation of the Epoch Frequent Batch Auction
//! clearing algorithm, as specified in `02-MECHANISM_SPEC.md` §4–§6, §14.
//!
//! This crate is used for differential testing (D-1) against the on-chain program.
//! It has no Solana dependencies and can run on any platform.

#![deny(missing_docs)]

/// Marginal tick allocation info for one side of the book.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Marginal {
    /// Marginal tick index.
    pub tick: u16,
    /// Lots to allocate at the marginal tick (M).
    pub alloc: u64,
    /// Total lots at the marginal tick (T = bid_qty[t] or ask_qty[t]).
    pub total: u64,
}

/// Result of the clearing algorithm.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClearResult {
    /// Clearing tick index (i*).
    pub tick: u16,
    /// Matched lots (Q*).
    pub matched: u64,
    /// Buy-side marginal info (t_b, M_b, T_b).
    pub bid: Marginal,
    /// Sell-side marginal info (t_a, M_a, T_a).
    pub ask: Marginal,
}

/// Order representation used in the reference engine for fill allocation and property tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OrderRef {
    /// Order side: 0 = Buy, 1 = Sell.
    pub side: u8,
    /// Limit tick index in `[0, K-1]`.
    pub tick: u16,
    /// Requested lot quantity.
    pub lots: u64,
}

/// Midpoint rounding with tie-breaking toward the center tick `c`.
///
/// If `lo + hi` is even, returns the exact integer midpoint `(lo + hi) / 2`.
/// If `lo + hi` is odd (midpoint is x.5), breaks the tie by choosing whichever
/// candidate integer is strictly closer to the center tick `c`.
///
/// Because `c` is an integer, one candidate is always strictly closer than the other.
pub fn midpoint(lo: usize, hi: usize, c: usize) -> usize {
    let sum = lo + hi;
    let m = sum / 2;
    if sum % 2 == 0 {
        m
    } else {
        let d_m = (m as isize - c as isize).abs();
        let d_m1 = ((m + 1) as isize - c as isize).abs();
        if d_m1 < d_m {
            m + 1
        } else {
            m
        }
    }
}

/// Run the clearing algorithm on aggregate tick arrays.
///
/// Implements spec §14 exactly:
/// 1. Compute cumulative demand D (suffix sums of bids) and supply S (prefix sums of asks).
/// 2. V[t] = min(D[t], S[t]); find Vmax. If 0, return None (no trade).
/// 3. Plateau P = {t : V[t] == Vmax} — contiguous by unimodality.
/// 4. Min-imbalance set Q = argmin|D-S| within P — contiguous.
/// 5. Midpoint of Q, rounding toward center tick c via `midpoint(lo, hi, c)`.
/// 6. Compute marginal ticks and allocations.
///
/// # Panics
/// Panics if `bid_qty` and `ask_qty` have different lengths.
pub fn clear(bid_qty: &[u64], ask_qty: &[u64]) -> Option<ClearResult> {
    let k = bid_qty.len();
    assert_eq!(
        k,
        ask_qty.len(),
        "bid_qty and ask_qty must have equal length"
    );
    if k == 0 {
        return None;
    }
    let c = (k - 1) / 2;

    // D[t] = suffix sums of bids; D[k] = 0
    let mut d = vec![0u64; k + 1];
    for t in (0..k).rev() {
        d[t] = d[t + 1].checked_add(bid_qty[t]).expect("demand overflow");
    }

    // S[t] = prefix sums of asks
    let mut s = vec![0u64; k];
    let mut acc = 0u64;
    for t in 0..k {
        acc = acc.checked_add(ask_qty[t]).expect("supply overflow");
        s[t] = acc;
    }

    // V[t] = min(D[t], S[t])
    let v = |t: usize| d[t].min(s[t]);
    let vmax = (0..k).map(v).max().unwrap();
    if vmax == 0 {
        return None;
    }

    // Plateau: contiguous interval where V == Vmax
    let plateau: Vec<usize> = (0..k).filter(|&t| v(t) == vmax).collect();

    // Minimum imbalance within plateau
    let imb = |t: usize| d[t].abs_diff(s[t]);
    let m = plateau.iter().map(|&t| imb(t)).min().unwrap();
    let q: Vec<usize> = plateau.into_iter().filter(|&t| imb(t) == m).collect();

    let (lo, hi) = (*q.first().unwrap(), *q.last().unwrap());
    let i_star = midpoint(lo, hi, c);
    let qstar = vmax;

    // Buy-side marginal: t_b = max{t : D[t] >= Q*}
    let t_b = (0..k).rev().find(|&t| d[t] >= qstar).unwrap();
    let m_b = qstar - d[t_b + 1];

    // Sell-side marginal: t_a = min{t : S[t] >= Q*}
    let t_a = (0..k).find(|&t| s[t] >= qstar).unwrap();
    let m_a = qstar - if t_a == 0 { 0 } else { s[t_a - 1] };

    Some(ClearResult {
        tick: i_star as u16,
        matched: qstar,
        bid: Marginal {
            tick: t_b as u16,
            alloc: m_b,
            total: bid_qty[t_b],
        },
        ask: Marginal {
            tick: t_a as u16,
            alloc: m_a,
            total: ask_qty[t_a],
        },
    })
}

/// Compute the floor fill for an order at the marginal tick.
///
/// `fill = floor(lots × alloc / total)`
///
/// For orders strictly better than the marginal tick, the caller should
/// pass `lots` directly (full fill). This function is only for orders
/// AT the marginal tick.
pub fn compute_fill(lots: u64, marginal: &Marginal) -> u64 {
    if marginal.total == 0 {
        return 0;
    }
    let num = lots as u128 * marginal.alloc as u128;
    (num / marginal.total as u128) as u64
}

/// Apply the deterministic dust rule to marginal-tick fills.
///
/// Given pre-computed `floor_fills` for orders at the marginal tick,
/// distributes the remaining `dust = M - sum(floors)` lots to the first
/// orders (in buffer order) with non-zero remainder.
///
/// # Arguments
/// * `fills` - Mutable slice of floor fills (modified in place).
/// * `lots` - Original lot quantities per order at the marginal tick.
/// * `m` - Total lots to allocate at the marginal tick (M).
/// * `t` - Total lots available at the marginal tick (T).
///
/// # Returns
/// The dust count (number of +1 lots distributed).
pub fn apply_dust(fills: &mut [u64], lots: &[u64], m: u64, t: u64) -> u64 {
    assert_eq!(fills.len(), lots.len());
    if t == 0 {
        return 0;
    }

    let floor_sum: u64 = fills.iter().sum();
    let dust = m.saturating_sub(floor_sum);

    let mut given = 0u64;
    for i in 0..lots.len() {
        if given >= dust {
            break;
        }
        let r = (lots[i] as u128 * m as u128) % t as u128;
        if r > 0 {
            fills[i] += 1;
            given += 1;
        }
    }

    debug_assert_eq!(
        fills.iter().sum::<u64>(),
        m,
        "fills must sum to M after dust"
    );
    given
}

/// Allocate fills to an array of individual orders according to a `ClearResult`.
///
/// Follows spec §5:
/// - Price priority: orders strictly better than marginal tick fill in full.
/// - Pro-rata at the marginal tick: `floor(lots × M / T)` plus +1 lot dust to first remainder > 0.
/// - Orders worse than marginal tick: 0 fill.
///
/// Returns a vector of filled lots corresponding to each input order.
pub fn allocate_order_fills(orders: &[OrderRef], clear_result: &ClearResult) -> Vec<u64> {
    let mut fills = vec![0u64; orders.len()];

    // 1. Process Buy orders (side = 0)
    let mut marginal_buy_indices = Vec::new();
    let mut marginal_buy_lots = Vec::new();

    for (i, order) in orders.iter().enumerate() {
        if order.side == 0 {
            if order.tick > clear_result.bid.tick {
                fills[i] = order.lots;
            } else if order.tick == clear_result.bid.tick {
                marginal_buy_indices.push(i);
                marginal_buy_lots.push(order.lots);
            }
        }
    }

    if !marginal_buy_indices.is_empty() {
        let mut marginal_fills: Vec<u64> = marginal_buy_lots
            .iter()
            .map(|&lots| compute_fill(lots, &clear_result.bid))
            .collect();
        apply_dust(
            &mut marginal_fills,
            &marginal_buy_lots,
            clear_result.bid.alloc,
            clear_result.bid.total,
        );
        for (idx, fill) in marginal_buy_indices.into_iter().zip(marginal_fills) {
            fills[idx] = fill;
        }
    }

    // 2. Process Sell orders (side = 1)
    let mut marginal_sell_indices = Vec::new();
    let mut marginal_sell_lots = Vec::new();

    for (i, order) in orders.iter().enumerate() {
        if order.side == 1 {
            if order.tick < clear_result.ask.tick {
                fills[i] = order.lots;
            } else if order.tick == clear_result.ask.tick {
                marginal_sell_indices.push(i);
                marginal_sell_lots.push(order.lots);
            }
        }
    }

    if !marginal_sell_indices.is_empty() {
        let mut marginal_fills: Vec<u64> = marginal_sell_lots
            .iter()
            .map(|&lots| compute_fill(lots, &clear_result.ask))
            .collect();
        apply_dust(
            &mut marginal_fills,
            &marginal_sell_lots,
            clear_result.ask.alloc,
            clear_result.ask.total,
        );
        for (idx, fill) in marginal_sell_indices.into_iter().zip(marginal_fills) {
            fills[idx] = fill;
        }
    }

    fills
}

/// Compute the clearing price from the oracle price and clearing tick.
///
/// `offset = (tick - c) × tick_bps` basis points.
/// `price* = round_to_price_tick(oracle_price × (10000 + offset) / 10000)`.
/// Rounding to nearest multiple of `price_tick`, ties toward oracle_price.
pub fn clearing_price(oracle_price: u64, tick: u16, k: u16, tick_bps: u16, price_tick: u64) -> u64 {
    let c = ((k as i32) - 1) / 2;
    let offset = (tick as i32 - c) * tick_bps as i32; // in bps

    // raw = oracle_price × (10000 + offset) / 10000
    let raw = if offset >= 0 {
        oracle_price as u128 * (10000 + offset as u128) / 10000
    } else {
        let abs_offset = (-offset) as u128;
        oracle_price as u128 * (10000 - abs_offset) / 10000
    };

    // Round to nearest multiple of price_tick, ties toward oracle_price
    let pt = price_tick as u128;
    let remainder = raw % pt;
    let half = pt / 2;

    let rounded = if remainder > half {
        raw - remainder + pt
    } else if remainder < half {
        raw - remainder
    } else {
        // Tie: round toward oracle_price
        let down = raw - remainder;
        let up = down + pt;
        let oracle = oracle_price as u128;
        if oracle.abs_diff(down) <= oracle.abs_diff(up) {
            down
        } else {
            up
        }
    };

    rounded as u64
}

/// Compute notional value of a fill.
///
/// `notional = lots × (price / 1000)` in micro-USDC.
/// This is exact because `price` is always a multiple of `price_tick = 1000`.
pub fn notional(lots: u64, price: u64) -> u64 {
    lots * (price / 1000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_midpoint_rounding_cases() {
        let c = 50usize;

        // 1. Intervals strictly below c
        // [40, 41]: sum=81, m=40, candidates 40 and 41. 41 is closer to 50.
        assert_eq!(midpoint(40, 41, c), 41);
        // [40, 42]: sum=82, exact integer midpoint 41.
        assert_eq!(midpoint(40, 42, c), 41);
        // [46, 47]: sum=93, m=46, candidates 46 and 47. 47 is closer to 50.
        assert_eq!(midpoint(46, 47, c), 47);

        // 2. Intervals strictly above c
        // [59, 60]: sum=119, m=59, candidates 59 and 60. 59 is closer to 50.
        assert_eq!(midpoint(59, 60, c), 59);
        // [58, 60]: sum=118, exact integer midpoint 59.
        assert_eq!(midpoint(58, 60, c), 59);
        // [53, 54]: sum=107, m=53, candidates 53 and 54. 53 is closer to 50.
        assert_eq!(midpoint(53, 54, c), 53);

        // 3. Intervals straddling c
        // [49, 52]: sum=101, m=50. Candidates 50 and 51. 50 is distance 0 from c.
        assert_eq!(midpoint(49, 52, c), 50);
        // [48, 51]: sum=99, m=49. Candidates 49 and 50. 50 is distance 0 from c.
        assert_eq!(midpoint(48, 51, c), 50);
        // [49, 50]: sum=99, m=49. Candidates 49 and 50. 50 is distance 0 from c.
        assert_eq!(midpoint(49, 50, c), 50);
        // [50, 51]: sum=101, m=50. Candidates 50 and 51. 50 is distance 0 from c.
        assert_eq!(midpoint(50, 51, c), 50);

        // 4. Exact center and symmetric intervals
        assert_eq!(midpoint(50, 50, c), 50);
        assert_eq!(midpoint(40, 60, c), 50);
        assert_eq!(midpoint(0, 100, c), 50);
    }

    #[test]
    fn test_worked_example() {
        // Spec §6: Oracle $150, K=13 (offsets -6..+6), c=6
        let k = 13usize;
        let c = 6;
        let mut bid_qty = vec![0u64; k];
        let mut ask_qty = vec![0u64; k];

        // B1: BUY +5 → tick 11, lots 10
        bid_qty[c + 5] = 10;
        // B2: BUY +3 → tick 9, lots 20
        bid_qty[c + 3] = 20;
        // B3: BUY 0 → tick 6, lots 15
        bid_qty[c] = 15;
        // B4: BUY -2 → tick 4, lots 30
        bid_qty[c - 2] = 30;

        // A1: SELL -4 → tick 2, lots 12
        ask_qty[c - 4] = 12;
        // A2: SELL 0 → tick 6, lots 18
        ask_qty[c] = 18;
        // A3: SELL +3 → tick 9, lots 25
        ask_qty[c + 3] = 25;
        // A4: SELL +6 → tick 12, lots 10
        ask_qty[c + 6] = 10;

        let result = clear(&bid_qty, &ask_qty).expect("should produce a trade");

        // i* = tick 7 (offset +1 bp)
        assert_eq!(result.tick, 7);
        // Q* = 30
        assert_eq!(result.matched, 30);
        // Buy marginal: t_b = 9 (offset +3), M_b = 20, T_b = 20
        assert_eq!(result.bid.tick, 9);
        assert_eq!(result.bid.alloc, 20);
        assert_eq!(result.bid.total, 20);
        // Sell marginal: t_a = 6 (offset 0), M_a = 18, T_a = 18
        assert_eq!(result.ask.tick, 6);
        assert_eq!(result.ask.alloc, 18);
        assert_eq!(result.ask.total, 18);

        // Clearing price = round(150_000_000 × 10001 / 10000) = 150_015_000
        let price = clearing_price(150_000_000, 7, 13, 1, 1000);
        assert_eq!(price, 150_015_000);

        // Notional = 30 × 150_015_000 / 1000 = 4_500_450
        assert_eq!(notional(30, 150_015_000), 4_500_450);

        // Verify order-level fills match worked example
        let orders = vec![
            OrderRef {
                side: 0,
                tick: 11,
                lots: 10,
            }, // B1 (+5)
            OrderRef {
                side: 0,
                tick: 9,
                lots: 20,
            }, // B2 (+3)
            OrderRef {
                side: 0,
                tick: 6,
                lots: 15,
            }, // B3 (0)
            OrderRef {
                side: 0,
                tick: 4,
                lots: 30,
            }, // B4 (-2)
            OrderRef {
                side: 1,
                tick: 2,
                lots: 12,
            }, // A1 (-4)
            OrderRef {
                side: 1,
                tick: 6,
                lots: 18,
            }, // A2 (0)
            OrderRef {
                side: 1,
                tick: 9,
                lots: 25,
            }, // A3 (+3)
            OrderRef {
                side: 1,
                tick: 12,
                lots: 10,
            }, // A4 (+6)
        ];
        let fills = allocate_order_fills(&orders, &result);
        assert_eq!(fills, vec![10, 20, 0, 0, 12, 18, 0, 0]);
    }

    #[test]
    fn test_prorata() {
        // M=20, T=50, orders [20, 30] → fills [8, 12]
        let marginal = Marginal {
            tick: 0,
            alloc: 20,
            total: 50,
        };
        assert_eq!(compute_fill(20, &marginal), 8);
        assert_eq!(compute_fill(30, &marginal), 12);
    }

    #[test]
    fn test_dust() {
        // Three orders of 7 lots, T=21, M=10 → fills [4, 3, 3]
        let lots = [7u64, 7, 7];
        let marginal = Marginal {
            tick: 0,
            alloc: 10,
            total: 21,
        };
        let mut fills: Vec<u64> = lots.iter().map(|&l| compute_fill(l, &marginal)).collect();
        assert_eq!(fills, vec![3, 3, 3]);

        let dust = apply_dust(&mut fills, &lots, 10, 21);
        assert_eq!(dust, 1);
        assert_eq!(fills, vec![4, 3, 3]);
        assert_eq!(fills.iter().sum::<u64>(), 10);
    }

    #[test]
    fn test_no_trade() {
        // Only bids, no asks
        let bid_qty = vec![10u64, 20, 30];
        let ask_qty = vec![0u64, 0, 0];
        assert!(clear(&bid_qty, &ask_qty).is_none());

        // Only asks, no bids
        let bid_qty = vec![0u64, 0, 0];
        let ask_qty = vec![10u64, 20, 30];
        assert!(clear(&bid_qty, &ask_qty).is_none());

        // Empty
        assert!(clear(&[], &[]).is_none());
    }

    #[test]
    fn test_single_tick_match() {
        let bid_qty = vec![0u64, 50, 0];
        let ask_qty = vec![0u64, 30, 0];
        let result = clear(&bid_qty, &ask_qty).expect("should trade");
        assert_eq!(result.tick, 1); // center
        assert_eq!(result.matched, 30);
        assert_eq!(result.bid.tick, 1);
        assert_eq!(result.bid.alloc, 30);
        assert_eq!(result.bid.total, 50);
        assert_eq!(result.ask.tick, 1);
        assert_eq!(result.ask.alloc, 30);
        assert_eq!(result.ask.total, 30);
    }

    #[test]
    fn test_notional_exact() {
        assert_eq!(notional(100, 150_015_000), 15_001_500);
        assert_eq!(notional(1, 150_000_000), 150_000);
        assert_eq!(notional(0, 150_000_000), 0);
    }

    #[test]
    fn test_clearing_price_calc() {
        assert_eq!(clearing_price(150_000_000, 7, 13, 1, 1000), 150_015_000);
        assert_eq!(clearing_price(150_000_000, 6, 13, 1, 1000), 150_000_000);
        assert_eq!(clearing_price(150_000_000, 4, 13, 1, 1000), 149_970_000);
        assert_eq!(clearing_price(150_000_000, 51, 101, 1, 1000), 150_015_000);
        assert_eq!(clearing_price(150_000_000, 50, 101, 1, 1000), 150_000_000);
    }

    #[test]
    fn test_dust_no_overflow() {
        for m in 1..=50u64 {
            for n_orders in 1..=5usize {
                let lots_val = 7u64;
                let lots_arr = vec![lots_val; n_orders];
                let t = lots_val * n_orders as u64;
                if m > t {
                    continue;
                }
                let marginal = Marginal {
                    tick: 0,
                    alloc: m,
                    total: t,
                };
                let mut fills: Vec<u64> = lots_arr
                    .iter()
                    .map(|&l| compute_fill(l, &marginal))
                    .collect();
                apply_dust(&mut fills, &lots_arr, m, t);
                assert_eq!(fills.iter().sum::<u64>(), m);
                for (i, &f) in fills.iter().enumerate() {
                    assert!(f <= lots_arr[i], "fill {} exceeds lots {}", f, lots_arr[i]);
                }
            }
        }
    }

    // Fast xorshift PRNG for property testing
    struct SimpleRng(u64);
    impl SimpleRng {
        fn next_u64(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
        fn gen_range(&mut self, max: usize) -> usize {
            (self.next_u64() as usize) % max
        }
    }

    /// Task T-04 Acceptance: 1,000,000 random cases pass property tests P-2..P-7, P-9.
    #[test]
    fn test_one_million_random_clearing_cases() {
        let mut rng = SimpleRng(0xDEADBEEFCAFE1234);
        let k = 101usize;
        let mut bid_qty = vec![0u64; k];
        let mut ask_qty = vec![0u64; k];

        for _ in 0..1_000_000 {
            bid_qty.fill(0);
            ask_qty.fill(0);

            // Generate between 0 and 20 orders per side
            let n_bids = rng.gen_range(20);
            let n_asks = rng.gen_range(20);

            let mut orders = Vec::with_capacity(n_bids + n_asks);

            for _ in 0..n_bids {
                let tick = rng.gen_range(k) as u16;
                let lots = (rng.next_u64() % 100) + 1;
                bid_qty[tick as usize] += lots;
                orders.push(OrderRef {
                    side: 0,
                    tick,
                    lots,
                });
            }

            for _ in 0..n_asks {
                let tick = rng.gen_range(k) as u16;
                let lots = (rng.next_u64() % 100) + 1;
                ask_qty[tick as usize] += lots;
                orders.push(OrderRef {
                    side: 1,
                    tick,
                    lots,
                });
            }

            let clear_opt = clear(&bid_qty, &ask_qty);

            if let Some(res) = clear_opt {
                // Invariant P-4: Matched volume Q* > 0
                assert!(res.matched > 0);

                // P-6: Determinism check (calling clear twice yields identical result)
                let res2 = clear(&bid_qty, &ask_qty).unwrap();
                assert_eq!(res, res2);

                let fills = allocate_order_fills(&orders, &res);

                let mut total_buy_fills = 0u64;
                let mut total_sell_fills = 0u64;

                for (order, &fill) in orders.iter().zip(fills.iter()) {
                    // Invariant P-7: Bounds (0 <= fill <= lots)
                    assert!(fill <= order.lots);

                    if order.side == 0 {
                        total_buy_fills += fill;
                        // Invariant P-3: Rationality (filled buyers have limit >= i*)
                        if fill > 0 {
                            assert!(order.tick >= res.tick);
                        }
                        // Invariant P-5: Maximality (strictly better orders filled in full)
                        if order.tick > res.bid.tick {
                            assert_eq!(fill, order.lots);
                        }
                        if order.tick < res.bid.tick {
                            assert_eq!(fill, 0);
                        }
                    } else {
                        total_sell_fills += fill;
                        // Invariant P-3: Rationality (filled sellers have limit <= i*)
                        if fill > 0 {
                            assert!(order.tick <= res.tick);
                        }
                        // Invariant P-5: Maximality (strictly better orders filled in full)
                        if order.tick < res.ask.tick {
                            assert_eq!(fill, order.lots);
                        }
                        if order.tick > res.ask.tick {
                            assert_eq!(fill, 0);
                        }
                    }
                }

                // Invariant P-4: Volume balance (BUY fills == SELL fills == Q*)
                assert_eq!(total_buy_fills, res.matched);
                assert_eq!(total_sell_fills, res.matched);

                // Invariant P-2: Single price (valid clearing price exists)
                let price = clearing_price(150_000_000, res.tick, k as u16, 1, 1000);
                assert!(price > 0 && price % 1000 == 0);

                // Invariant P-9: Order independence under permutation
                // Permuting arrival order yields the exact same total volume and clearing tick
                let mut permuted_orders = orders.clone();
                // Simple deterministic swap permutation
                if permuted_orders.len() > 1 {
                    let len = permuted_orders.len();
                    for idx in 0..len {
                        let target = (idx * 7 + 3) % len;
                        permuted_orders.swap(idx, target);
                    }
                    let permuted_fills = allocate_order_fills(&permuted_orders, &res);
                    let permuted_buy_sum: u64 = permuted_orders
                        .iter()
                        .zip(permuted_fills.iter())
                        .filter(|(o, _)| o.side == 0)
                        .map(|(_, &f)| f)
                        .sum();
                    assert_eq!(permuted_buy_sum, res.matched);
                }
            } else {
                // No trade: demand and supply do not cross, or one side empty
                let max_bid = (0..k).rev().find(|&t| bid_qty[t] > 0);
                let min_ask = (0..k).find(|&t| ask_qty[t] > 0);
                if let (Some(mb), Some(ma)) = (max_bid, min_ask) {
                    assert!(mb < ma, "no-trade only if max_bid < min_ask");
                }
            }
        }
    }

    #[test]
    fn test_spec_6_1_market_buy_against_vault_ladder_1000_lots() {
        // Spec §6.1: Asks: 500 @ +12, 1000 @ +18, 2000 @ +25.
        // Market buy of 1,000 lots (limit +50 bps).
        let k = 101usize;
        let c = 50usize;
        let mut bid_qty = vec![0u64; k];
        let mut ask_qty = vec![0u64; k];

        ask_qty[c + 12] = 500;
        ask_qty[c + 18] = 1000;
        ask_qty[c + 25] = 2000;

        bid_qty[c + 50] = 1000; // market buy

        let res = clear(&bid_qty, &ask_qty).expect("must clear");
        assert_eq!(res.matched, 1000);
        // Clearing tick is 71 (offset +21 bps), NOT weighted average 15 bps
        assert_eq!(res.tick, 71);
        let offset = res.tick as i32 - c as i32;
        assert_eq!(offset, 21);

        // Taker cost = offset (21 bps) + 5 bps protocol fee = 26 bps one way
        let fee_bps = 5i32;
        let taker_cost_one_way_bps = offset + fee_bps;
        assert_eq!(taker_cost_one_way_bps, 26);
    }

    #[test]
    fn test_spec_6_1_market_buy_against_vault_ladder_10_lots() {
        // Spec §6.1: 10-lot market buy against same ladder clears at +14 bps
        let k = 101usize;
        let c = 50usize;
        let mut bid_qty = vec![0u64; k];
        let mut ask_qty = vec![0u64; k];

        ask_qty[c + 12] = 500;
        ask_qty[c + 18] = 1000;
        ask_qty[c + 25] = 2000;

        bid_qty[c + 50] = 10; // 10 lots market buy

        let res = clear(&bid_qty, &ask_qty).expect("must clear");
        assert_eq!(res.matched, 10);
        // Plateau 12 to 50, min imbalance 12 to 17, midpoint 14.5 -> rounds to 14 toward center
        assert_eq!(res.tick, 64);
        let offset = res.tick as i32 - c as i32;
        assert_eq!(offset, 14);

        let fee_bps = 5i32;
        assert_eq!(offset + fee_bps, 19);
    }

    #[test]
    fn test_spec_6_1_market_buy_against_vault_ladder_100_lots() {
        // 100-lot market buy (0.1 SOL) against same ladder also clears at +14 bps
        let k = 101usize;
        let c = 50usize;
        let mut bid_qty = vec![0u64; k];
        let mut ask_qty = vec![0u64; k];

        ask_qty[c + 12] = 500;
        ask_qty[c + 18] = 1000;
        ask_qty[c + 25] = 2000;

        bid_qty[c + 50] = 100; // 100 lots market buy (0.1 SOL)

        let res = clear(&bid_qty, &ask_qty).expect("must clear");
        assert_eq!(res.matched, 100);
        assert_eq!(res.tick, 64);
        let offset = res.tick as i32 - c as i32;
        assert_eq!(offset, 14);

        let fee_bps = 5i32;
        assert_eq!(offset + fee_bps, 19);
    }

    #[test]
    fn test_spec_6_1_ladder_vwap() {
        // Vault ladder total volume: 500 + 1000 + 2000 = 3500 lots
        // VWAP = (500*12 + 1000*18 + 2000*25) / 3500 = 74000 / 3500 = 21.142857... bps ~ 21.1 bps
        let total_lots: f64 = 500.0 + 1000.0 + 2000.0;
        let weighted_bps: f64 = 500.0 * 12.0 + 1000.0 * 18.0 + 2000.0 * 25.0;
        let vwap_bps: f64 = weighted_bps / total_lots;
        assert!((vwap_bps - 21.142857f64).abs() < 1e-4);
        let rounded_vwap = (vwap_bps * 10.0).round() / 10.0;
        assert_eq!(rounded_vwap, 21.1f64);
    }
}
