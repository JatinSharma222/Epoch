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

/// Run the clearing algorithm on aggregate tick arrays.
///
/// Implements spec §14 exactly:
/// 1. Compute cumulative demand D (suffix sums of bids) and supply S (prefix sums of asks).
/// 2. V[t] = min(D[t], S[t]); find Vmax. If 0, return None (no trade).
/// 3. Plateau P = {t : V[t] == Vmax} — contiguous by unimodality.
/// 4. Min-imbalance set Q = argmin|D-S| within P — contiguous.
/// 5. Midpoint of Q, rounding toward center tick c.
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
    let sum = lo + hi;
    let mut i_star = sum / 2; // floor of midpoint
    if sum % 2 == 1 && c > i_star {
        // Midpoint is x.5: round toward center tick c
        i_star += 1;
    }

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
        // Both bid and ask at center tick (K=3, c=1)
        let bid_qty = vec![0u64, 50, 0];
        let ask_qty = vec![0u64, 30, 0];
        let result = clear(&bid_qty, &ask_qty).expect("should trade");
        assert_eq!(result.tick, 1); // center
        assert_eq!(result.matched, 30);
        // Buy marginal at tick 1: M_b = 30, T_b = 50
        assert_eq!(result.bid.tick, 1);
        assert_eq!(result.bid.alloc, 30);
        assert_eq!(result.bid.total, 50);
        // Sell marginal at tick 1: M_a = 30, T_a = 30
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
        // Offset +1 bp: oracle 150M × 10001/10000 = 150_015_000
        assert_eq!(clearing_price(150_000_000, 7, 13, 1, 1000), 150_015_000);
        // Offset 0: unchanged
        assert_eq!(clearing_price(150_000_000, 6, 13, 1, 1000), 150_000_000);
        // Offset -2 bp: 150M × 9998/10000 = 149_970_000
        assert_eq!(clearing_price(150_000_000, 4, 13, 1, 1000), 149_970_000);
        // K=101, center=50, tick at 51 → offset +1
        assert_eq!(clearing_price(150_000_000, 51, 101, 1, 1000), 150_015_000);
        // K=101, center=50, tick at 50 → offset 0
        assert_eq!(clearing_price(150_000_000, 50, 101, 1, 1000), 150_000_000);
    }

    #[test]
    fn test_midpoint_rounding() {
        // K=11, c=5. Q=[3,4]. sum=7 odd. floor=3. c=5>3 → i*=4 (closer to c).
        let mut bid_qty = vec![0u64; 11];
        let mut ask_qty = vec![0u64; 11];
        // Construct so plateau=[3,4] and Q=[3,4]
        // D[3]=10, D[4]=10, D[5]=0 → bids at ticks 3,4
        bid_qty[3] = 5;
        bid_qty[4] = 5;
        // S[3]=10, S[4]=10 → asks at ticks 0..4
        ask_qty[0] = 3;
        ask_qty[1] = 3;
        ask_qty[2] = 2;
        ask_qty[3] = 2;
        // D: d[5]=0, d[4]=5, d[3]=10, d[2]=10, d[1]=10, d[0]=10
        // S: s[0]=3, s[1]=6, s[2]=8, s[3]=10, s[4]=10
        // V[3]=min(10,10)=10, V[4]=min(5,10)=5 → Vmax=10, plateau=[3]
        // Actually let me reconsider... this gives plateau=[3] not [3,4].

        // Simpler: K=11, c=5.
        // Two ticks [4, 5] both at V=20. Q = [4, 5]. sum=9, odd. c=5>4 → i*=5.
        bid_qty = vec![0u64; 11];
        ask_qty = vec![0u64; 11];
        bid_qty[4] = 10;
        bid_qty[5] = 10;
        bid_qty[6] = 10;
        ask_qty[4] = 10;
        ask_qty[5] = 10;
        // D: d[7..]=0, d[6]=10, d[5]=20, d[4]=30
        // S: s[0..3]=0, s[4]=10, s[5]=20
        // V[4]=min(30,10)=10, V[5]=min(20,20)=20, V[6]=min(10,20)=10
        // Plateau = [5], single tick → i*=5.

        // Better test: make plateau span [4,6]
        bid_qty = vec![0u64; 11];
        ask_qty = vec![0u64; 11];
        bid_qty[4] = 5;
        bid_qty[5] = 5;
        bid_qty[6] = 5;
        bid_qty[7] = 5;
        // D: d[8..]=0, d[7]=5, d[6]=10, d[5]=15, d[4]=20
        ask_qty[2] = 5;
        ask_qty[3] = 5;
        ask_qty[4] = 5;
        ask_qty[5] = 5;
        ask_qty[6] = 5;
        // S: s[2]=5, s[3]=10, s[4]=15, s[5]=20, s[6]=25
        // V[4]=min(20,15)=15, V[5]=min(15,20)=15, V[6]=min(10,25)=10
        // Plateau = [4, 5]. |D-S|: at 4: |20-15|=5, at 5: |15-20|=5
        // Q = [4, 5]. sum=9, odd. c=5 > 4 → i*=5.
        let result = clear(&bid_qty, &ask_qty).expect("should trade");
        assert_eq!(result.tick, 5, "midpoint should round toward c=5");

        // Now test rounding the other way: Q = [6, 7], c=5. c < 6 → no rounding up.
        // sum=13, odd. floor=6. c=5 > 6? No. i*=6.
        bid_qty = vec![0u64; 11];
        ask_qty = vec![0u64; 11];
        bid_qty[6] = 5;
        bid_qty[7] = 5;
        bid_qty[8] = 5;
        // D: d[9..]=0, d[8]=5, d[7]=10, d[6]=15
        ask_qty[4] = 5;
        ask_qty[5] = 5;
        ask_qty[6] = 5;
        ask_qty[7] = 5;
        // S: s[4]=5, s[5]=10, s[6]=15, s[7]=20
        // V[6]=min(15,15)=15, V[7]=min(10,20)=10
        // Plateau=[6]. Single point → i*=6.
        let result = clear(&bid_qty, &ask_qty).expect("should trade");
        assert_eq!(result.tick, 6);
    }

    #[test]
    fn test_dust_no_overflow() {
        // Verify dust never exceeds original lots
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
}
