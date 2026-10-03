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
    let conf_bps = (params.oracle_conf as u128 * 10_000) / oracle_price as u128;
    if conf_bps > market.vault_params.max_conf_bps as u128 {
        emit!(VaultQuoteSkipped {
            target_batch,
            ring_index,
            reason: VaultSkipReason::CONFIDENCE_TOO_WIDE,
        });
        return Ok(());
    }

    // 6. Guards: Check max inventory
    let mut vault_user = ctx.accounts.vault_user.load_mut()?;
    let inventory = vault_user.base_position;
    let max_inventory = market.vault_params.max_inventory_lots;
    if inventory.unsigned_abs() >= max_inventory {
        emit!(VaultQuoteSkipped {
            target_batch,
            ring_index,
            reason: VaultSkipReason::MAX_INVENTORY_EXCEEDED,
        });
        return Ok(());
    }

    // 7. Batch ring account lifecycle & reuse
    let mut batch = ctx.accounts.batch.load_mut()?;
    if batch.batch_id != target_batch {
        if batch.status == BatchStatus::EMPTY
            || batch.status == BatchStatus::SETTLED
            || batch.status == BatchStatus::VOID
            || batch.num_orders == 0
        {
            batch.reset_for_batch(target_batch);
        } else {
            return err!(EpochError::RingSlotBusy);
        }
    } else {
        require!(batch.status == BatchStatus::OPEN, EpochError::BatchNotOpen);
    }

    // 8. Calculate inventory skew: shift_bps = (inventory * skew_bps) / max_inventory
    let skew_bps = market.vault_params.skew_bps as i64;
    let shift_bps = if max_inventory > 0 {
        ((inventory * skew_bps) / (max_inventory as i64)).clamp(-skew_bps, skew_bps)
    } else {
        0
    };

    // 9. Prepare 6 ladder quotes: 3 bids (slots 0..3) and 3 asks (slots 3..6)
    // Structure: (slot_id, side, tick, lots)
    let k_max = (market.params.k_ticks - 1) as i64;
    let mut quotes: [(u8, u8, u16, u64); 6] = [(0, 0, 0, 0); 6];

    for r in 0..3 {
        let base_offset = market.vault_params.quote_offset_bps[r] as i64;
        let lots = market.vault_params.quote_lots[r];

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

    let vault_user_pda = ctx.accounts.vault_user.key();
    let mut orders_placed: u8 = 0;

    for (slot_id, side, tick, lots) in quotes {
        // Upsert into batch: check if order already exists for (vault_user_pda, slot_id)
        let mut existing_idx = None;
        for i in 0..(batch.num_orders as usize) {
            let o = &batch.orders[i];
            if o.user_pda == vault_user_pda && o.slot_id == slot_id && o.status == OrderStatus::OPEN
            {
                existing_idx = Some(i);
                break;
            }
        }

        let target_idx = if let Some(idx) = existing_idx {
            // Subtract old order from aggregates and pending lots
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
