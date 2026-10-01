use crate::errors::EpochError;
use crate::state::constants::RING_SIZE;
use crate::state::{Batch, BatchStatus, Market, OrderSide, OrderStatus, UserAccount};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(target_batch: u64, ring_index: u8, slot_id: u8)]
pub struct CancelOrder<'info> {
    #[account(
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

    #[account(
        mut,
        seeds = [b"user", owner.key().as_ref()],
        bump,
    )]
    pub user: AccountLoader<'info, UserAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,
}

pub fn handle_cancel_order(
    ctx: Context<CancelOrder>,
    target_batch: u64,
    ring_index: u8,
    slot_id: u8,
) -> Result<()> {
    // 1. Verify ring index
    let expected_ring_index = (target_batch % RING_SIZE as u64) as u8;
    require_eq!(ring_index, expected_ring_index, EpochError::InvalidSlotId);

    // 2. Validate timing (must be before batch close slot)
    let market = ctx.accounts.market.load()?;
    let current_slot = Clock::get()?.slot;
    let start_slot = market.start_slot;
    let n_slots = market.params.batch_slots as u64;
    let close_slot = start_slot + (target_batch + 1) * n_slots;

    require!(current_slot < close_slot, EpochError::BatchClosed);

    // 3. Batch state check
    let mut batch = ctx.accounts.batch.load_mut()?;
    require_eq!(batch.batch_id, target_batch, EpochError::OrderNotFound);
    require!(batch.status == BatchStatus::OPEN, EpochError::BatchNotOpen);

    // 4. Find open order in batch buffer
    let user_pda = ctx.accounts.user.key();
    let mut order_idx = None;

    for i in 0..(batch.num_orders as usize) {
        let order = &batch.orders[i];
        if order.user_pda == user_pda
            && order.slot_id == slot_id
            && order.status == OrderStatus::OPEN
        {
            order_idx = Some(i);
            break;
        }
    }

    let idx = order_idx.ok_or(EpochError::OrderNotFound)?;
    let old_side = batch.orders[idx].side;
    let old_tick = batch.orders[idx].tick as usize;
    let old_lots = batch.orders[idx].lots;

    // 5. Subtract from aggregates and user pending lots
    let mut user = ctx.accounts.user.load_mut()?;

    if old_side == OrderSide::BUY {
        batch.bid_qty[old_tick] = batch.bid_qty[old_tick].saturating_sub(old_lots);
        user.pending_buy_lots = user.pending_buy_lots.saturating_sub(old_lots);
    } else {
        batch.ask_qty[old_tick] = batch.ask_qty[old_tick].saturating_sub(old_lots);
        user.pending_sell_lots = user.pending_sell_lots.saturating_sub(old_lots);
    }

    user.active_orders = user.active_orders.saturating_sub(1);

    // 6. Mark order as cancelled and zero lots
    batch.orders[idx].status = OrderStatus::CANCELLED;
    batch.orders[idx].lots = 0;

    msg!(
        "Order cancelled: batch={}, slot={}, old_lots={}",
        target_batch,
        slot_id,
        old_lots
    );

    Ok(())
}
