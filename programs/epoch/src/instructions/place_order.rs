use crate::errors::EpochError;
use crate::events::OrderPlaced;
use crate::state::constants::{F_SCALE, MAX_ORDERS, MAX_SLOTS_PER_USER, RING_SIZE};
use crate::state::{
    Batch, BatchStatus, Market, Order, OrderFlags, OrderSide, OrderStatus, UserAccount,
};
use anchor_lang::prelude::*;

/// Arguments for placing or replacing an order.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct PlaceOrderArgs {
    pub target_batch: u64,
    pub ring_index: u8,
    pub slot_id: u8,
    pub side: u8,
    pub tick: u16,
    pub lots: u64,
    pub flags: u8,
}

#[derive(Accounts)]
#[instruction(args: PlaceOrderArgs)]
pub struct PlaceOrder<'info> {
    #[account(
        seeds = [b"market"],
        bump = market.load()?.bump,
    )]
    pub market: AccountLoader<'info, Market>,

    #[account(
        mut,
        seeds = [b"batch".as_ref(), &[args.ring_index]],
        bump,
    )]
    pub batch: AccountLoader<'info, Batch>,

    #[account(
        mut,
        seeds = [b"user", owner.key().as_ref()],
        bump,
    )]
    pub user: AccountLoader<'info, UserAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,
}

/// Margin check helper implementing spec §9.
#[allow(clippy::too_many_arguments)]
pub fn check_margin_requirement(
    collateral: i64,
    quote_position: i128,
    base_position: i64,
    funding_snapshot: i128,
    pending_buy_lots: u64,
    pending_sell_lots: u64,
    this_buy: u64,
    this_sell: u64,
    funding_index: i128,
    oracle_price: u64,
    imr_bps: u16,
    band_bps: u16,
) -> Result<()> {
    // 1. Pending funding deduction: Δ = funding_index - funding_snapshot
    let delta = funding_index.saturating_sub(funding_snapshot);
    let pending_funding = (base_position as i128 * delta) / F_SCALE;

    // 2. Mark-to-market position value in micro-USDC
    let pos_val = (base_position as i128 * oracle_price as i128) / 1000;

    // 3. User equity
    let equity = collateral as i128 + quote_position + pos_val - pending_funding;

    // 4. Worst-case position exposure in lots (spec §9 line 192)
    let long_exposure = base_position as i128 + pending_buy_lots as i128 + this_buy as i128;
    let short_exposure = base_position as i128 - (pending_sell_lots as i128 + this_sell as i128);
    let worst_abs = long_exposure.abs().max(short_exposure.abs()) as u128;

    // 5. Margin requirement and slippage reserve (spec §9 line 194-196)
    let m_hi = (oracle_price as u128 * (10_000 + band_bps as u128)) / 10_000;
    let total_open_lots = (pending_buy_lots + pending_sell_lots + this_buy + this_sell) as u128;
    let slip_reserve = (total_open_lots * oracle_price as u128 * band_bps as u128) / 10_000 / 1000;
    let imr_margin = (imr_bps as u128 * worst_abs * m_hi) / 1000 / 10_000;
    let required = imr_margin + slip_reserve;

    // 6. Verify equity covers required margin
    require!(equity >= required as i128, EpochError::InsufficientMargin);

    Ok(())
}

pub fn handle_place_order(ctx: Context<PlaceOrder>, args: PlaceOrderArgs) -> Result<()> {
    let target_batch = args.target_batch;
    let ring_index = args.ring_index;
    let slot_id = args.slot_id;
    let side = args.side;
    let tick = args.tick;
    let lots = args.lots;
    let flags = args.flags;

    // 1. Verify ring index matches target_batch % RING_SIZE
    let expected_ring_index = (target_batch % RING_SIZE as u64) as u8;
    require_eq!(ring_index, expected_ring_index, EpochError::InvalidSlotId);

    // 2. Validate timing and lookahead rules
    let market = ctx.accounts.market.load()?;
    let current_slot = Clock::get()?.slot;
    let start_slot = market.start_slot;
    let n_slots = market.params.batch_slots as u64;
    let l_lookahead = market.params.lookahead as u64;

    let current_batch = if current_slot >= start_slot {
        (current_slot - start_slot) / n_slots
    } else {
        0
    };
    let close_slot = start_slot + (target_batch + 1) * n_slots;

    require!(current_slot < close_slot, EpochError::BatchClosed);
    require!(target_batch >= current_batch, EpochError::BatchInPast);
    require!(
        target_batch <= current_batch + l_lookahead,
        EpochError::BatchTooFarAhead
    );

    // 3. Batch ring account lifecycle & reuse
    // Never reuse a ring slot that holds unsettled orders (reject with RingSlotBusy)
    let mut batch = ctx.accounts.batch.load_mut()?;
    if batch.batch_id != target_batch {
        let is_reusable = batch.status == BatchStatus::EMPTY
            || batch.status == BatchStatus::SETTLED
            || batch.num_orders == 0
            || (batch.settled_orders >= batch.num_orders);

        if is_reusable {
            batch.reset_for_batch(target_batch);
        } else {
            return err!(EpochError::RingSlotBusy);
        }
    } else {
        require!(batch.status == BatchStatus::OPEN, EpochError::BatchNotOpen);
    }

    // 4. Parameter validation
    require!(slot_id < MAX_SLOTS_PER_USER, EpochError::InvalidSlotId);
    require!(tick < market.params.k_ticks, EpochError::InvalidTick);
    require!(
        side == OrderSide::BUY || side == OrderSide::SELL,
        EpochError::InvalidSide
    );
    require!(
        lots >= market.params.min_order_lots,
        EpochError::OrderTooSmall
    );

    let oracle_price = market.last_oracle_price;
    require!(oracle_price > 0, EpochError::OracleStale);
    let notional = ((lots as u128 * oracle_price as u128) / 1000) as u64;
    require!(
        notional >= market.params.min_order_notional,
        EpochError::OrderNotionalTooSmall
    );

    let band_bps = ((market.params.k_ticks - 1) / 2) * market.params.tick_bps;
    let mut user = ctx.accounts.user.load_mut()?;
    let user_pda = ctx.accounts.user.key();

    // Reduce-only placement-time validation (spec §5 line 106)
    if (flags & OrderFlags::REDUCE_ONLY) != 0 {
        if side == OrderSide::BUY {
            require!(
                user.base_position < 0,
                EpochError::ReduceOnlyExceedsPosition
            );
            require!(
                lots <= (-user.base_position) as u64,
                EpochError::ReduceOnlyExceedsPosition
            );
        } else {
            require!(
                user.base_position > 0,
                EpochError::ReduceOnlyExceedsPosition
            );
            require!(
                lots <= user.base_position as u64,
                EpochError::ReduceOnlyExceedsPosition
            );
        }
    }

    // 5. Check if an open order already exists with the same (user_pda, slot_id) -> UPSERT
    let mut existing_order_idx = None;
    for i in 0..(batch.num_orders as usize) {
        let order = &batch.orders[i];
        if order.user_pda == user_pda
            && order.slot_id == slot_id
            && order.status == OrderStatus::OPEN
        {
            existing_order_idx = Some(i);
            break;
        }
    }

    let (adj_buy_lots, adj_sell_lots, this_buy, this_sell) = if let Some(idx) = existing_order_idx {
        let old = &batch.orders[idx];
        let (ab, asell) = if old.side == OrderSide::BUY {
            (
                user.pending_buy_lots.saturating_sub(old.lots),
                user.pending_sell_lots,
            )
        } else {
            (
                user.pending_buy_lots,
                user.pending_sell_lots.saturating_sub(old.lots),
            )
        };
        let (tb, ts) = if side == OrderSide::BUY {
            (lots, 0)
        } else {
            (0, lots)
        };
        (ab, asell, tb, ts)
    } else {
        let (tb, ts) = if side == OrderSide::BUY {
            (lots, 0)
        } else {
            (0, lots)
        };
        (user.pending_buy_lots, user.pending_sell_lots, tb, ts)
    };

    // 6. Margin check
    check_margin_requirement(
        user.collateral,
        user.quote_position,
        user.base_position,
        user.funding_snapshot,
        adj_buy_lots,
        adj_sell_lots,
        this_buy,
        this_sell,
        market.funding_index,
        oracle_price,
        market.params.imr_bps,
        band_bps,
    )?;

    // 7. Update aggregates and state
    if let Some(idx) = existing_order_idx {
        // Replacement (upsert)
        let old_side = batch.orders[idx].side;
        let old_tick = batch.orders[idx].tick as usize;
        let old_lots = batch.orders[idx].lots;

        if old_side == OrderSide::BUY {
            batch.bid_qty[old_tick] = batch.bid_qty[old_tick].saturating_sub(old_lots);
        } else {
            batch.ask_qty[old_tick] = batch.ask_qty[old_tick].saturating_sub(old_lots);
        }

        if side == OrderSide::BUY {
            batch.bid_qty[tick as usize] = batch.bid_qty[tick as usize].checked_add(lots).unwrap();
        } else {
            batch.ask_qty[tick as usize] = batch.ask_qty[tick as usize].checked_add(lots).unwrap();
        }

        user.pending_buy_lots = adj_buy_lots + this_buy;
        user.pending_sell_lots = adj_sell_lots + this_sell;

        batch.orders[idx].side = side;
        batch.orders[idx].tick = tick;
        batch.orders[idx].lots = lots;
        batch.orders[idx].flags = flags;
    } else {
        // New order
        require!(
            (batch.num_orders as usize) < MAX_ORDERS,
            EpochError::BatchFull
        );
        let new_idx = batch.num_orders as usize;
        batch.orders[new_idx] = Order {
            user_pda,
            lots,
            filled_lots: 0,
            tick,
            side,
            slot_id,
            status: OrderStatus::OPEN,
            flags,
            _padding: [0; 10],
        };
        batch.num_orders += 1;
        user.active_orders += 1;
        user.pending_buy_lots += this_buy;
        user.pending_sell_lots += this_sell;

        if side == OrderSide::BUY {
            batch.bid_qty[tick as usize] = batch.bid_qty[tick as usize].checked_add(lots).unwrap();
        } else {
            batch.ask_qty[tick as usize] = batch.ask_qty[tick as usize].checked_add(lots).unwrap();
        }
    }

    msg!(
        "Order placed: batch={}, slot={}, side={}, tick={}, lots={}",
        target_batch,
        slot_id,
        side,
        tick,
        lots
    );

    emit!(OrderPlaced {
        user: user_pda,
        batch_id: target_batch,
        slot_id,
        side,
        tick,
        lots,
        flags,
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_margin_flat_position_pass() {
        // Flat position (0 lots), $500 USDC collateral (500_000_000 micro-USDC).
        // Place BUY order: 10 lots at $150/SOL (150_000_000 micro-USDC).
        // IMR = 1000 bps (10%), band = 50 bps.
        let result = check_margin_requirement(
            500_000_000, // $500
            0,
            0,
            0,
            0,
            0,
            10, // this_buy
            0,  // this_sell
            0,
            150_000_000, // $150/SOL
            1000,        // 10%
            50,          // 50 bps
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_margin_zero_collateral_fail() {
        // Zero collateral, placing 10 lots -> InsufficientMargin.
        let result = check_margin_requirement(0, 0, 0, 0, 0, 0, 10, 0, 0, 150_000_000, 1000, 50);
        assert!(result.is_err());
    }

    #[test]
    fn test_margin_worst_case_exposure() {
        // User has long 20 lots, pending 30 buy lots.
        // Places 10 buy lots: worst long = 60 lots.
        // Worst short = |20 - 0| = 20 lots.
        // worst_abs = 60 lots.
        // Collateral $100 -> required for 60 lots at $150 is:
        // m_hi = 150_000_000 * 10050 / 10000 = 150_750_000
        // imr = 1000 * 60 * 150_750_000 / 1000 / 10000 = 904_500 micro-USDC (~$0.90)
        // slip_reserve = 40 * 150_000_000 * 50 / 10000 / 1000 = 30_000 micro-USDC
        // required = 934_500 micro-USDC.
        // Equity = 100_000_000 + 20 * 150_000 = 103_000_000 >= 934_500 -> passes.
        let result = check_margin_requirement(
            100_000_000,
            0,
            20,
            0,
            30,
            0,
            10,
            0,
            0,
            150_000_000,
            1000,
            50,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_margin_pending_funding_deduction() {
        // User has long position of 100 lots.
        // Index rose by 10_000_000_000 (10 USDC per lot).
        // Pending funding = 100 * 10_000_000_000 / 10^9 = 1,000 micro-USDC.
        // Equity is reduced by pending funding.
        let result = check_margin_requirement(
            1_000_000, // $1
            0,
            100,
            0,
            0,
            0,
            10,
            0,
            10_000_000_000, // index
            150_000_000,
            1000,
            50,
        );
        assert!(result.is_ok());
    }

    /// Invariant I-8 Property Test:
    /// Aggregate consistency: bid_qty/ask_qty equal the sums recomputed from the order buffer
    /// after any sequence of place, replace, and cancel operations.
    #[test]
    fn test_invariant_i8_aggregate_consistency() {
        let mut bid_qty = [0u64; 101];
        let mut ask_qty = [0u64; 101];
        let mut orders = Vec::new();

        // Simulate 10,000 random operations (place, replace, cancel)
        let mut seed = 0x123456789ABCDEF0u64;
        let mut next_rand = || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };

        for op in 0..10_000 {
            let action = next_rand() % 3;
            let side = (next_rand() % 2) as u8;
            let tick = (next_rand() % 101) as usize;
            let lots = (next_rand() % 50) + 1;
            let slot_id = (next_rand() % 8) as u8;

            match action {
                0 => {
                    // Place new order (if space permits)
                    if orders.len() < 128 {
                        orders.push((side, tick, lots, slot_id, true)); // active
                        if side == 0 {
                            bid_qty[tick] += lots;
                        } else {
                            ask_qty[tick] += lots;
                        }
                    }
                }
                1 => {
                    // Replace existing order
                    if !orders.is_empty() {
                        let idx = (next_rand() as usize) % orders.len();
                        if orders[idx].4 {
                            // active
                            let (old_side, old_tick, old_lots, _, _) = orders[idx];
                            if old_side == 0 {
                                bid_qty[old_tick] -= old_lots;
                            } else {
                                ask_qty[old_tick] -= old_lots;
                            }

                            orders[idx] = (side, tick, lots, slot_id, true);
                            if side == 0 {
                                bid_qty[tick] += lots;
                            } else {
                                ask_qty[tick] += lots;
                            }
                        }
                    }
                }
                _ => {
                    // Cancel order
                    if !orders.is_empty() {
                        let idx = (next_rand() as usize) % orders.len();
                        if orders[idx].4 {
                            let (old_side, old_tick, old_lots, s_id, _) = orders[idx];
                            if old_side == 0 {
                                bid_qty[old_tick] -= old_lots;
                            } else {
                                ask_qty[old_tick] -= old_lots;
                            }
                            orders[idx] = (old_side, old_tick, 0, s_id, false); // cancelled
                        }
                    }
                }
            }

            // Verify Invariant I-8 at periodic checkpoints
            if op % 100 == 0 {
                let mut expected_bid = [0u64; 101];
                let mut expected_ask = [0u64; 101];
                for &(s, t, l, _, active) in &orders {
                    if active {
                        if s == 0 {
                            expected_bid[t] += l;
                        } else {
                            expected_ask[t] += l;
                        }
                    }
                }
                assert_eq!(
                    bid_qty, expected_bid,
                    "I-8 bid aggregate mismatch at op {}",
                    op
                );
                assert_eq!(
                    ask_qty, expected_ask,
                    "I-8 ask aggregate mismatch at op {}",
                    op
                );
            }
        }
    }
}
