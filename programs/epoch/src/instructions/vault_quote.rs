use crate::errors::EpochError;
use crate::events::{VaultQuoteSkipped, VaultQuoted, VaultSkipReason};
use crate::instructions::place_order::check_margin_requirement;
use crate::state::constants::{CENTER_TICK, MAX_ORDERS, RING_SIZE};
use crate::state::{Batch, BatchStatus, Market, OrderSide, OrderStatus, UserAccount};
use anchor_lang::prelude::*;

/// Parameters for placing the Backstop Vault ladder into a target batch.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct VaultQuoteParams {
    pub target_batch: u64,
    pub ring_index: u8,
    pub oracle_price: u64,
    pub oracle_conf: u64,
    pub oracle_timestamp: i64,
}

#[derive(Accounts)]
#[instruction(params: VaultQuoteParams)]
pub struct VaultQuote<'info> {
    #[account(
        seeds = [b"market"],
        bump = market.load()?.bump,
    )]
    pub market: AccountLoader<'info, Market>,

    #[account(
        mut,
        seeds = [b"batch".as_ref(), &[params.ring_index]],
        bump,
    )]
    pub batch: AccountLoader<'info, Batch>,

    /// CHECK: PDA derived with seed [b"vault"].
    #[account(
        seeds = [b"vault"],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"user", vault_authority.key().as_ref()],
        bump,
    )]
    pub vault_user: AccountLoader<'info, UserAccount>,

    pub cranker: Signer<'info>,
}

pub fn handle_vault_quote(ctx: Context<VaultQuote>, params: VaultQuoteParams) -> Result<()> {
    let target_batch = params.target_batch;
    let ring_index = params.ring_index;

    // 1. Verify ring index matches target_batch % RING_SIZE
    let expected_ring_index = (target_batch % RING_SIZE as u64) as u8;
    require_eq!(ring_index, expected_ring_index, EpochError::InvalidSlotId);

    // 2. Validate timing and lookahead rules
    let market = ctx.accounts.market.load()?;
    let clock = Clock::get()?;
    let current_slot = clock.slot;
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

    // 3. Guards: Check active status
    if market.vault_params.is_active == 0 {
        emit!(VaultQuoteSkipped {
            target_batch,
            ring_index,
            reason: VaultSkipReason::NOT_ACTIVE,
        });
        return Ok(());
    }

    // 4. Guards: Check oracle freshness
    let age = clock.unix_timestamp.saturating_sub(params.oracle_timestamp);
    if age > market.params.max_oracle_age_secs as i64 {
        emit!(VaultQuoteSkipped {
            target_batch,
            ring_index,
            reason: VaultSkipReason::ORACLE_STALE,
        });
        return Ok(());
    }

    // 5. Guards: Check oracle confidence
    let oracle_price = if params.oracle_price > 0 {
        params.oracle_price
    } else {
        market.last_oracle_price
    };
    require!(oracle_price > 0, EpochError::OracleStale);
    if !is_oracle_confident(
        params.oracle_conf,
        oracle_price,
        market.vault_params.max_conf_bps,
    ) {
        emit!(VaultQuoteSkipped {
            target_batch,
            ring_index,
            reason: VaultSkipReason::CONFIDENCE_TOO_WIDE,
        });
        return Ok(());
    }

    // 6. Guards: Determine allowed quote sides based on inventory limits (Round 12)
    // When inventory is at or beyond the limit, quote only the inventory-reducing side:
    // - Short at or beyond limit (inventory <= -max_inventory): keep bids (reduces short), stop asks.
    // - Long at or beyond limit (inventory >= max_inventory): keep asks (reduces long), stop bids.
    // - Within limits (|inventory| < max_inventory): quote both sides.
    let mut vault_user = ctx.accounts.vault_user.load_mut()?;
    let inventory = vault_user.base_position;
    let max_inventory = market.vault_params.max_inventory_lots;
    let (allow_bids, allow_asks) = get_allowed_quote_sides(inventory, max_inventory);

    if !allow_bids && !allow_asks {
        emit!(VaultQuoteSkipped {
            target_batch,
            ring_index,
            reason: VaultSkipReason::MAX_INVENTORY_EXCEEDED,
        });
        return Ok(());
    }

    // 7. Batch ring account lifecycle & reuse
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

    // 8 & 9. Calculate inventory skew and prepare 6 ladder quotes: 3 bids and 3 asks
    let (shift_bps, quotes) = compute_vault_ladder(
        inventory,
        max_inventory,
        market.vault_params.skew_bps,
        market.params.k_ticks,
        market.vault_params.quote_offset_bps,
        market.vault_params.quote_lots,
    );

    let vault_user_pda = ctx.accounts.vault_user.key();
    let mut orders_placed: u8 = 0;

    // Cancel any existing orders on the disallowed side (if updating an open batch)
    for i in 0..(batch.num_orders as usize) {
        let (is_match, side, tick, lots) = {
            let o = &batch.orders[i];
            if o.user_pda == vault_user_pda && o.status == OrderStatus::OPEN {
                (true, o.side, o.tick as usize, o.lots)
            } else {
                (false, 0, 0, 0)
            }
        };

        if is_match {
            if side == OrderSide::BUY && !allow_bids {
                batch.bid_qty[tick] = batch.bid_qty[tick].saturating_sub(lots);
                vault_user.pending_buy_lots = vault_user.pending_buy_lots.saturating_sub(lots);
                batch.orders[i].status = OrderStatus::CANCELLED;
            } else if side == OrderSide::SELL && !allow_asks {
                batch.ask_qty[tick] = batch.ask_qty[tick].saturating_sub(lots);
                vault_user.pending_sell_lots = vault_user.pending_sell_lots.saturating_sub(lots);
                batch.orders[i].status = OrderStatus::CANCELLED;
            }
        }
    }

    for (slot_id, side, tick, lots) in quotes {
        // Skip quoting on the disallowed side (Round 12)
        if (side == OrderSide::BUY && !allow_bids) || (side == OrderSide::SELL && !allow_asks) {
            continue;
        }

        // Upsert into batch: check if order already exists for (vault_user_pda, slot_id)
        let mut existing_idx = None;
        for i in 0..(batch.num_orders as usize) {
            let o = &batch.orders[i];
            if o.user_pda == vault_user_pda && o.slot_id == slot_id {
                existing_idx = Some(i);
                break;
            }
        }

        let target_idx = if let Some(idx) = existing_idx {
            // Subtract old order from aggregates and pending lots if OPEN
            if batch.orders[idx].status == OrderStatus::OPEN {
                let old_side = batch.orders[idx].side;
                let old_tick = batch.orders[idx].tick as usize;
                let old_lots = batch.orders[idx].lots;
                if old_side == OrderSide::BUY {
                    batch.bid_qty[old_tick] = batch.bid_qty[old_tick].saturating_sub(old_lots);
                    vault_user.pending_buy_lots = vault_user.pending_buy_lots.saturating_sub(old_lots);
                } else {
                    batch.ask_qty[old_tick] = batch.ask_qty[old_tick].saturating_sub(old_lots);
                    vault_user.pending_sell_lots =
                        vault_user.pending_sell_lots.saturating_sub(old_lots);
                }
            }
            idx
        } else {
            // Allocate new slot
            if (batch.num_orders as usize) >= MAX_ORDERS {
                emit!(VaultQuoteSkipped {
                    target_batch,
                    ring_index,
                    reason: VaultSkipReason::BATCH_FULL,
                });
                break;
            }
            let idx = batch.num_orders as usize;
            batch.num_orders += 1;
            vault_user.active_orders = vault_user.active_orders.saturating_add(1);
            idx
        };

        // Write order data
        let order = &mut batch.orders[target_idx];
        order.user_pda = vault_user_pda;
        order.lots = lots;
        order.filled_lots = 0;
        order.tick = tick;
        order.side = side;
        order.slot_id = slot_id;
        order.status = OrderStatus::OPEN;
        order.flags = 0;

        // Add to aggregates
        if side == OrderSide::BUY {
            batch.bid_qty[tick as usize] = batch.bid_qty[tick as usize].saturating_add(lots);
            vault_user.pending_buy_lots = vault_user.pending_buy_lots.saturating_add(lots);
        } else {
            batch.ask_qty[tick as usize] = batch.ask_qty[tick as usize].saturating_add(lots);
            vault_user.pending_sell_lots = vault_user.pending_sell_lots.saturating_add(lots);
        }

        orders_placed += 1;
    }

    // 10. Check margin for the backstop vault user
    let band_bps = ((market.params.k_ticks - 1) / 2) * market.params.tick_bps;
    check_margin_requirement(
        vault_user.collateral,
        vault_user.quote_position,
        vault_user.base_position,
        vault_user.funding_snapshot,
        vault_user.pending_buy_lots,
        vault_user.pending_sell_lots,
        0,
        0,
        market.funding_index,
        oracle_price,
        market.params.imr_bps,
        band_bps,
    )?;

    emit!(VaultQuoted {
        target_batch,
        ring_index,
        inventory,
        shift_bps,
        orders_placed,
    });

    Ok(())
}

/// Oracle confidence guard: returns true if confidence ratio (in bps) <= max_conf_bps.
pub fn is_oracle_confident(oracle_conf: u64, oracle_price: u64, max_conf_bps: u16) -> bool {
    if oracle_price == 0 {
        return false;
    }
    let conf_bps = (oracle_conf as u128 * 10_000) / oracle_price as u128;
    conf_bps <= max_conf_bps as u128
}

/// Inventory guard: returns true if |inventory| < max_inventory.
pub fn is_inventory_within_limit(inventory: i64, max_inventory: u64) -> bool {
    inventory.unsigned_abs() < max_inventory
}

/// Returns (allow_bids, allow_asks) for a given inventory level and max_inventory (Round 12).
/// When inventory is at or beyond the limit, only the inventory-reducing side is quoted:
/// - Short at or beyond limit (inventory <= -max_inventory): keep bids, stop asks.
/// - Long at or beyond limit (inventory >= max_inventory): keep asks, stop bids.
/// - Within limits (|inventory| < max_inventory): quote both sides.
pub fn get_allowed_quote_sides(inventory: i64, max_inventory: u64) -> (bool, bool) {
    if max_inventory == 0 {
        (false, false)
    } else if inventory <= -(max_inventory as i64) {
        (true, false)
    } else if inventory >= max_inventory as i64 {
        (false, true)
    } else {
        (true, true)
    }
}

/// Computes inventory skew and the 6-rung ladder quotes (3 bids, 3 asks).
/// Returns (shift_bps, [(slot_id, side, tick, lots); 6]).
pub fn compute_vault_ladder(
    inventory: i64,
    max_inventory: u64,
    skew_bps: u16,
    k_ticks: u16,
    quote_offset_bps: [u16; 3],
    quote_lots: [u64; 3],
) -> (i64, [(u8, u8, u16, u64); 6]) {
    let skew_bps = skew_bps as i64;
    let shift_bps = if max_inventory > 0 {
        ((inventory * skew_bps) / (max_inventory as i64)).clamp(-skew_bps, skew_bps)
    } else {
        0
    };

    let k_max = (k_ticks.saturating_sub(1)) as i64;
    let mut quotes: [(u8, u8, u16, u64); 6] = [(0, 0, 0, 0); 6];

    for r in 0..3 {
        let base_offset = quote_offset_bps[r] as i64;
        let lots = quote_lots[r];

        // Bid offset = -base_offset - shift_bps
        let bid_offset = -base_offset - shift_bps;
        let bid_tick = (CENTER_TICK as i64 + bid_offset).clamp(0, k_max) as u16;
        let bid_slot = r as u8;
        quotes[r] = (bid_slot, OrderSide::BUY, bid_tick, lots);

        // Ask offset = +base_offset - shift_bps
        let ask_offset = base_offset - shift_bps;
        let ask_tick = (CENTER_TICK as i64 + ask_offset).clamp(0, k_max) as u16;
        let ask_slot = (3 + r) as u8;
        quotes[3 + r] = (ask_slot, OrderSide::SELL, ask_tick, lots);
    }

    (shift_bps, quotes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_symmetric_quotes_at_zero_inventory() {
        let quote_offset_bps = [3, 6, 10];
        let quote_lots = [10, 20, 30];
        let (shift_bps, quotes) =
            compute_vault_ladder(0, 1000, 10, 101, quote_offset_bps, quote_lots);

        assert_eq!(shift_bps, 0);
        // Bids: center (50) - offset
        assert_eq!(quotes[0], (0, OrderSide::BUY, 47, 10)); // -3 bps
        assert_eq!(quotes[1], (1, OrderSide::BUY, 44, 20)); // -6 bps
        assert_eq!(quotes[2], (2, OrderSide::BUY, 40, 30)); // -10 bps

        // Asks: center (50) + offset
        assert_eq!(quotes[3], (3, OrderSide::SELL, 53, 10)); // +3 bps
        assert_eq!(quotes[4], (4, OrderSide::SELL, 56, 20)); // +6 bps
        assert_eq!(quotes[5], (5, OrderSide::SELL, 60, 30)); // +10 bps
    }

    #[test]
    fn test_positive_inventory_downward_skew() {
        // Vault is LONG (+500 of 1000 max inventory).
        // Skew should shift ticks downward to discourage buying and encourage selling.
        let quote_offset_bps = [3, 6, 10];
        let quote_lots = [10, 20, 30];
        let (shift_bps, quotes) =
            compute_vault_ladder(500, 1000, 10, 101, quote_offset_bps, quote_lots);

        // shift = (500 * 10) / 1000 = +5 bps
        assert_eq!(shift_bps, 5);
        // Bids: 50 - 3 - 5 = 42, 50 - 6 - 5 = 39, 50 - 10 - 5 = 35
        assert_eq!(quotes[0].2, 42);
        assert_eq!(quotes[1].2, 39);
        assert_eq!(quotes[2].2, 35);

        // Asks: 50 + 3 - 5 = 48, 50 + 6 - 5 = 51, 50 + 10 - 5 = 55
        assert_eq!(quotes[3].2, 48);
        assert_eq!(quotes[4].2, 51);
        assert_eq!(quotes[5].2, 55);
    }

    #[test]
    fn test_negative_inventory_upward_skew() {
        // Vault is SHORT (-500 of 1000 max inventory).
        // Skew should shift ticks upward to encourage buying and discourage selling.
        let quote_offset_bps = [3, 6, 10];
        let quote_lots = [10, 20, 30];
        let (shift_bps, quotes) =
            compute_vault_ladder(-500, 1000, 10, 101, quote_offset_bps, quote_lots);

        // shift = (-500 * 10) / 1000 = -5 bps
        assert_eq!(shift_bps, -5);
        // Bids: 50 - 3 - (-5) = 52, 50 - 6 - (-5) = 49, 50 - 10 - (-5) = 45
        assert_eq!(quotes[0].2, 52);
        assert_eq!(quotes[1].2, 49);
        assert_eq!(quotes[2].2, 45);

        // Asks: 50 + 3 - (-5) = 58, 50 + 6 - (-5) = 61, 50 + 10 - (-5) = 65
        assert_eq!(quotes[3].2, 58);
        assert_eq!(quotes[4].2, 61);
        assert_eq!(quotes[5].2, 65);
    }

    #[test]
    fn test_extreme_inventory_skew_clamping() {
        // Inventory far exceeds max_inventory (+5000 lots when max is 1000)
        let (shift_bps, _) = compute_vault_ladder(5000, 1000, 10, 101, [3, 6, 10], [10, 20, 30]);
        assert_eq!(shift_bps, 10); // Clamped to skew_bps

        let (shift_bps_neg, _) =
            compute_vault_ladder(-5000, 1000, 10, 101, [3, 6, 10], [10, 20, 30]);
        assert_eq!(shift_bps_neg, -10); // Clamped to -skew_bps
    }

    #[test]
    fn test_tick_clamping_at_boundaries() {
        // Extreme offsets should never produce tick < 0 or tick > K-1 (100)
        let (shift, quotes) = compute_vault_ladder(1000, 1000, 60, 101, [45, 50, 55], [10, 20, 30]);
        assert_eq!(shift, 60);
        for q in quotes {
            assert!(q.2 <= 100);
        }
    }

    #[test]
    fn test_oracle_confidence_guard() {
        // Price $150.00 = 150_000_000
        let price = 150_000_000u64;
        let max_conf_bps = 20u16;

        // 10 bps conf: 150_000 -> (150_000 * 10_000) / 150_000_000 = 10 bps <= 20 bps -> OK
        assert!(is_oracle_confident(150_000, price, max_conf_bps));

        // Exactly 20 bps conf: 300_000 -> 20 bps <= 20 bps -> OK
        assert!(is_oracle_confident(300_000, price, max_conf_bps));

        // 25 bps conf: 375_000 -> 25 bps > 20 bps -> REJECTED
        assert!(!is_oracle_confident(375_000, price, max_conf_bps));

        // Zero price -> REJECTED
        assert!(!is_oracle_confident(100, 0, max_conf_bps));
    }

    #[test]
    fn test_inventory_guard() {
        let max_inv = 500u64;
        assert!(is_inventory_within_limit(0, max_inv));
        assert!(is_inventory_within_limit(499, max_inv));
        assert!(is_inventory_within_limit(-499, max_inv));
        assert!(!is_inventory_within_limit(500, max_inv));
        assert!(!is_inventory_within_limit(-500, max_inv));
        assert!(!is_inventory_within_limit(1000, max_inv));
    }

    #[test]
    fn test_allowed_quote_sides_at_limits() {
        let max_inv = 1000u64;

        // Zero inventory: both sides allowed
        assert_eq!(get_allowed_quote_sides(0, max_inv), (true, true));

        // Within limits: both sides allowed
        assert_eq!(get_allowed_quote_sides(500, max_inv), (true, true));
        assert_eq!(get_allowed_quote_sides(-500, max_inv), (true, true));
        assert_eq!(get_allowed_quote_sides(999, max_inv), (true, true));
        assert_eq!(get_allowed_quote_sides(-999, max_inv), (true, true));

        // Long at or beyond limit: stop bids, keep asks (reduce long)
        assert_eq!(get_allowed_quote_sides(1000, max_inv), (false, true));
        assert_eq!(get_allowed_quote_sides(1500, max_inv), (false, true));

        // Short at or beyond limit: keep bids (reduce short), stop asks
        assert_eq!(get_allowed_quote_sides(-1000, max_inv), (true, false));
        assert_eq!(get_allowed_quote_sides(-1500, max_inv), (true, false));

        // Zero max inventory: neither allowed
        assert_eq!(get_allowed_quote_sides(0, 0), (false, false));
    }
}
