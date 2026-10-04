use crate::errors::EpochError;
use crate::events::{BatchCleared, BatchVoided};
use crate::state::constants::{CENTER_TICK, F_SCALE, K_TICKS, PRICE_TICK, RING_SIZE};
use crate::state::{Batch, BatchStatus, Market, OrderSide, OrderStatus};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(batch_id: u64, ring_index: u8)]
pub struct ClearBatch<'info> {
    #[account(
        mut,
        seeds = [b"market"],
        bump = market.load()?.bump,
    )]
    pub market: AccountLoader<'info, Market>,

    #[account(
        mut,
        seeds = [b"batch".as_ref(), &[ring_index]],
        bump,
    )]
    pub batch: AccountLoader<'info, Batch>,

    /// Permissionless cranker invoking clear_batch
    pub cranker: Signer<'info>,
}

/// Midpoint rounding with tie-breaking toward center tick c.
pub fn midpoint_c(lo: usize, hi: usize, c: usize) -> usize {
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

/// Clearing price rounding to nearest multiple of price_tick, ties toward oracle.
pub fn compute_clearing_price(
    oracle_price: u64,
    tick: u16,
    k: u16,
    tick_bps: u16,
    price_tick: u64,
) -> u64 {
    let c = ((k as i32) - 1) / 2;
    let offset = (tick as i32 - c) * tick_bps as i32;

    let raw = if offset >= 0 {
        oracle_price as u128 * (10000 + offset as u128) / 10000
    } else {
        let abs_offset = (-offset) as u128;
        oracle_price as u128 * (10000 - abs_offset) / 10000
    };

    let pt = price_tick as u128;
    let rem = raw % pt;
    let half = pt / 2;

    let rounded = if rem > half {
        raw - rem + pt
    } else if rem < half {
        raw - rem
    } else {
        let down = raw - rem;
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default)]
pub struct ClearBatchParams {
    pub oracle_price: u64,
    pub oracle_conf: u64,
    pub oracle_posted_slot: u64,
    pub oracle_timestamp: i64,
}

#[allow(clippy::needless_range_loop)]
pub fn handle_clear_batch(
    ctx: Context<ClearBatch>,
    batch_id: u64,
    ring_index: u8,
    params: ClearBatchParams,
) -> Result<()> {
    // 1. Verify ring index
    let expected_ring_index = (batch_id % RING_SIZE as u64) as u8;
    require_eq!(ring_index, expected_ring_index, EpochError::InvalidSlotId);

    // 2. Validate timing (current slot >= close_slot)
    let mut market = ctx.accounts.market.load_mut()?;
    let current_slot = Clock::get()?.slot;
    let current_ts = Clock::get()?.unix_timestamp;
    let start_slot = market.start_slot;
    let n_slots = market.params.batch_slots as u64;
    let close_slot = start_slot + (batch_id + 1) * n_slots;

    require!(
        current_slot >= close_slot || market.admin == ctx.accounts.cranker.key(),
        EpochError::BatchNotOpen
    );

    // 3. Batch state check
    let mut batch = ctx.accounts.batch.load_mut()?;
    require_eq!(batch.batch_id, batch_id, EpochError::OrderNotFound);
    require!(batch.status == BatchStatus::OPEN, EpochError::BatchNotOpen);

    // Oracle price resolution
    let oracle_price = if params.oracle_price > 0 {
        params.oracle_price
    } else {
        market.last_oracle_price
    };
    require!(oracle_price > 0, EpochError::OracleStale);
    market.last_oracle_price = oracle_price;

    let c = CENTER_TICK;

    // 4. Oracle & Timing VOID validation (spec §12)
    // a. Late clearance: current_slot > close_slot + max_clear_delay_slots
    let max_delay = market.params.max_clear_delay_slots as u64;
    let is_late = max_delay > 0 && current_slot > close_slot.saturating_add(max_delay);

    // b. Oracle confidence too wide: (conf * 10,000) / price > max_conf_bps
    let is_wide_conf = if oracle_price > 0 && params.oracle_conf > 0 {
        let max_conf_bps = market.params.max_conf_bps as u128;
        let conf_bps = (params.oracle_conf as u128 * 10_000) / oracle_price as u128;
        conf_bps > max_conf_bps
    } else {
        false
    };

    // c. Oracle stale: (current_time - oracle_timestamp) > max_oracle_age_secs
    let is_stale = if params.oracle_timestamp > 0 {
        let max_age = market.params.max_oracle_age_secs as i64;
        current_ts > params.oracle_timestamp && (current_ts - params.oracle_timestamp) > max_age
    } else {
        false
    };

    // d. Oracle posted slot invalid (spec 01 §7): require posted_slot >= close_slot and posted_slot <= close_slot + max_clear_delay_slots
    let is_invalid_slot = if params.oracle_posted_slot > 0 {
        params.oracle_posted_slot < close_slot
            || (max_delay > 0 && params.oracle_posted_slot > close_slot.saturating_add(max_delay))
            || params.oracle_posted_slot > current_slot
    } else {
        false
    };

    if is_late || is_wide_conf || is_stale || is_invalid_slot {
        batch.status = BatchStatus::VOID;
        batch.clearing_tick = c as u16;
        batch.clearing_price = oracle_price;
        batch.matched_lots = 0;
        batch.oracle_price = oracle_price;
        batch.oracle_conf = params.oracle_conf;
        batch.oracle_posted_slot = params.oracle_posted_slot;

        for i in 0..(batch.num_orders as usize) {
            if batch.orders[i].status == OrderStatus::OPEN {
                batch.orders[i].status = OrderStatus::EXPIRED;
                batch.orders[i].filled_lots = 0;
            }
        }

        let reason = if is_late {
            1
        } else if is_wide_conf {
            2
        } else if is_stale {
            3
        } else {
            4
        };

        emit!(BatchVoided { batch_id, reason });

        market.next_batch_to_clear = batch_id + 1;
        msg!(
            "Batch {} marked VOID: late={}, wide_conf={}, stale={}, invalid_slot={}",
            batch_id,
            is_late,
            is_wide_conf,
            is_stale,
            is_invalid_slot
        );
        return Ok(());
    }

    let (i_star, cl_price, q_star) =
        execute_batch_auction(&mut batch, oracle_price, market.params.tick_bps);

    batch.oracle_conf = params.oracle_conf;
    batch.oracle_posted_slot = params.oracle_posted_slot;

    // 12. Update funding index (spec §8)
    let offset_star = (i_star as i32 - c as i32) * market.params.tick_bps as i32;
    if q_star > 0 {
        let rate = offset_star.clamp(
            -(market.params.funding_cap_bps as i32),
            market.params.funding_cap_bps as i32,
        );
        let funding_period_slots = market.params.funding_period_slots as i128;
        if funding_period_slots > 0 {
            let accrual =
                (rate as i128 * oracle_price as i128 * n_slots as i128 * (F_SCALE / 1000))
                    / (10_000 * funding_period_slots);
            market.funding_index = market.funding_index.saturating_add(accrual);
        }
    }
    market.next_batch_to_clear = batch_id + 1;

    emit!(BatchCleared {
        batch_id,
        clearing_price: cl_price,
        offset_bps: offset_star,
        matched_lots: q_star,
        oracle_price,
        oracle_conf: params.oracle_conf,
    });

    msg!(
        "Batch {} cleared: tick={}, price={}, matched={}",
        batch_id,
        i_star,
        cl_price,
        q_star
    );

    Ok(())
}

/// Core auction execution algorithm on an in-memory or zero-copy `Batch`.
///
/// Implements spec §4, §5, §6, §14:
/// 1. Cumulative demand D[t] and supply S[t]
/// 2. Vmax scan
/// 3. Plateau detection [p_lo, p_hi]
/// 4. Min-imbalance interval [q_lo, q_hi]
/// 5. Midpoint tie-breaking i* toward center tick c
/// 6. Marginal tick & allocation calculations (t_b, M_b, T_b; t_a, M_a, T_a)
/// 7. Clearing price calculation via compute_clearing_price
/// 8. Two-pass pro-rata fill allocation with deterministic remainder dust rule
/// 9. Order status updates (FILLED, PARTIAL, EXPIRED)
///
/// Returns (i_star, cl_price, q_star) if crossing volume exists, or (c, oracle_price, 0) if no trade.
#[allow(clippy::needless_range_loop)]
pub fn execute_batch_auction(
    batch: &mut Batch,
    oracle_price: u64,
    tick_bps: u16,
) -> (u16, u64, u64) {
    let k = K_TICKS;
    let c = CENTER_TICK;

    // 1. Compute cumulative demand D[t] and supply S[t]
    let mut d = [0u64; K_TICKS + 1];
    for t in (0..k).rev() {
        d[t] = d[t + 1].saturating_add(batch.bid_qty[t]);
    }

    let mut s = [0u64; K_TICKS];
    let mut acc = 0u64;
    for t in 0..k {
        acc = acc.saturating_add(batch.ask_qty[t]);
        s[t] = acc;
    }

    // 2. Find maximum executable volume Vmax
    let mut vmax = 0u64;
    for t in 0..k {
        let v = d[t].min(s[t]);
        if v > vmax {
            vmax = v;
        }
    }

    if vmax == 0 {
        // No crossing trades: clear with 0 volume
        batch.clearing_tick = c as u16;
        batch.clearing_price = oracle_price;
        batch.matched_lots = 0;
        batch.status = BatchStatus::CLEARED;

        for i in 0..(batch.num_orders as usize) {
            if batch.orders[i].status == OrderStatus::OPEN {
                batch.orders[i].status = OrderStatus::EXPIRED;
                batch.orders[i].filled_lots = 0;
            }
        }

        return (c as u16, oracle_price, 0);
    }

    // 3. Find plateau interval [p_lo, p_hi]
    let mut p_lo = usize::MAX;
    let mut p_hi = 0usize;
    for t in 0..k {
        let v = d[t].min(s[t]);
        if v == vmax {
            if p_lo == usize::MAX {
                p_lo = t;
            }
            p_hi = t;
        }
    }

    // 4. Find minimum imbalance interval [q_lo, q_hi] within plateau
    let mut min_imb = u64::MAX;
    for t in p_lo..=p_hi {
        let imb = d[t].abs_diff(s[t]);
        if imb < min_imb {
            min_imb = imb;
        }
    }

    let mut q_lo = usize::MAX;
    let mut q_hi = 0usize;
    for t in p_lo..=p_hi {
        let imb = d[t].abs_diff(s[t]);
        if imb == min_imb {
            if q_lo == usize::MAX {
                q_lo = t;
            }
            q_hi = t;
        }
    }

    // 5. Midpoint rounding toward center tick c
    let i_star = midpoint_c(q_lo, q_hi, c);
    let q_star = vmax;

    // 6. Marginal tick and allocations (spec §5)
    // Buy marginal: highest tick with D[t] >= Q*
    let mut t_b = 0usize;
    for t in (0..k).rev() {
        if d[t] >= q_star {
            t_b = t;
            break;
        }
    }
    let m_b = q_star - d[t_b + 1];
    let total_b = batch.bid_qty[t_b];

    // Sell marginal: lowest tick with S[t] >= Q*
    let mut t_a = 0usize;
    for t in 0..k {
        if s[t] >= q_star {
            t_a = t;
            break;
        }
    }
    let m_a = q_star - if t_a == 0 { 0 } else { s[t_a - 1] };
    let total_a = batch.ask_qty[t_a];

    // 7. Uniform clearing price
    let cl_price =
        compute_clearing_price(oracle_price, i_star as u16, k as u16, tick_bps, PRICE_TICK);

    batch.clearing_tick = i_star as u16;
    batch.clearing_price = cl_price;
    batch.matched_lots = q_star;
    batch.oracle_price = oracle_price;
    batch.bid_marginal_tick = t_b as u16;
    batch.bid_marginal_alloc = m_b;
    batch.bid_marginal_total = total_b;
    batch.ask_marginal_tick = t_a as u16;
    batch.ask_marginal_alloc = m_a;
    batch.ask_marginal_total = total_a;
    batch.status = BatchStatus::CLEARED;

    // 8. Allocate fills across order buffer (spec §5)
    // Pass 1: compute base fills (full fill for strictly better, floor pro-rata for marginal)
    let num_orders = batch.num_orders as usize;
    let mut marginal_buy_sum = 0u64;
    let mut marginal_sell_sum = 0u64;

    for i in 0..num_orders {
        let order = &mut batch.orders[i];
        if order.status != OrderStatus::OPEN {
            continue;
        }

        if order.side == OrderSide::BUY {
            if (order.tick as usize) > t_b {
                order.filled_lots = order.lots;
            } else if (order.tick as usize) == t_b {
                let fill = if total_b > 0 {
                    ((order.lots as u128 * m_b as u128) / total_b as u128) as u64
                } else {
                    0
                };
                order.filled_lots = fill;
                marginal_buy_sum = marginal_buy_sum.saturating_add(fill);
            } else {
                order.filled_lots = 0;
            }
        } else if (order.tick as usize) < t_a {
            order.filled_lots = order.lots;
        } else if (order.tick as usize) == t_a {
            let fill = if total_a > 0 {
                ((order.lots as u128 * m_a as u128) / total_a as u128) as u64
            } else {
                0
            };
            order.filled_lots = fill;
            marginal_sell_sum = marginal_sell_sum.saturating_add(fill);
        } else {
            order.filled_lots = 0;
        }
    }

    // Pass 2: apply dust rule for marginal buys (+1 lot to first orders with remainder > 0)
    let mut dust_buy = m_b.saturating_sub(marginal_buy_sum);
    if dust_buy > 0 && total_b > 0 {
        for i in 0..num_orders {
            if dust_buy == 0 {
                break;
            }
            let order = &mut batch.orders[i];
            if order.status == OrderStatus::OPEN
                && order.side == OrderSide::BUY
                && (order.tick as usize) == t_b
            {
                let rem = (order.lots as u128 * m_b as u128) % total_b as u128;
                if rem > 0 && order.filled_lots < order.lots {
                    order.filled_lots += 1;
                    dust_buy -= 1;
                }
            }
        }
    }

    // Pass 3: apply dust rule for marginal asks
    let mut dust_sell = m_a.saturating_sub(marginal_sell_sum);
    if dust_sell > 0 && total_a > 0 {
        for i in 0..num_orders {
            if dust_sell == 0 {
                break;
            }
            let order = &mut batch.orders[i];
            if order.status == OrderStatus::OPEN
                && order.side == OrderSide::SELL
                && (order.tick as usize) == t_a
            {
                let rem = (order.lots as u128 * m_a as u128) % total_a as u128;
                if rem > 0 && order.filled_lots < order.lots {
                    order.filled_lots += 1;
                    dust_sell -= 1;
                }
            }
        }
    }

    // Pass 4: update order statuses
    for i in 0..num_orders {
        let order = &mut batch.orders[i];
        if order.status == OrderStatus::OPEN {
            if order.filled_lots == order.lots {
                order.status = OrderStatus::FILLED;
            } else if order.filled_lots > 0 {
                order.status = OrderStatus::PARTIAL;
            } else {
                order.status = OrderStatus::EXPIRED;
            }
        }
    }

    (i_star as u16, cl_price, q_star)
}
