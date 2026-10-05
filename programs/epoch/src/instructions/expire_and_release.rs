use anchor_lang::prelude::*;
use std::collections::BTreeSet;

use crate::errors::EpochError;
use crate::events::{BatchVoided, UserSettled};
use crate::state::constants::{CENTER_TICK, F_SCALE, RING_SIZE};
use crate::state::{Batch, BatchStatus, Market, OrderSide, OrderStatus, UserAccount};

#[derive(Accounts)]
#[instruction(batch_id: u64, ring_index: u8)]
pub struct ExpireAndRelease<'info> {
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

    /// Permissionless cranker, keeper, or affected user invoking expire_and_release
    pub caller: Signer<'info>,
}

pub fn handle_expire_and_release<'info>(
    ctx: Context<'_, '_, 'info, 'info, ExpireAndRelease<'info>>,
    batch_id: u64,
    ring_index: u8,
) -> Result<()> {
    // 1. Verify ring index
    let expected_ring_index = (batch_id % RING_SIZE as u64) as u8;
    require_eq!(ring_index, expected_ring_index, EpochError::InvalidSlotId);

    // 2. Validate batch
    let mut batch = ctx.accounts.batch.load_mut()?;
    require_eq!(batch.batch_id, batch_id, EpochError::BatchIdMismatch);

    // Idempotent: if already settled, return Ok
    if batch.status == BatchStatus::SETTLED {
        return Ok(());
    }

    let mut market = ctx.accounts.market.load_mut()?;
    let current_slot = Clock::get()?.slot;
    let start_slot = market.start_slot;
    let n_slots = market.params.batch_slots as u64;
    let close_slot = start_slot + (batch_id + 1) * n_slots;
    let max_delay = market.params.max_clear_delay_slots as u64;

    // 3. Stale / Void check:
    // Batch must either already be VOID, or be OPEN and past close_slot + max_clear_delay_slots
    if batch.status == BatchStatus::OPEN {
        let is_stale = current_slot > close_slot.saturating_add(max_delay)
            || market.admin == ctx.accounts.caller.key();
        require!(is_stale, EpochError::BatchNotStale);

        // Transition batch to VOID
        batch.status = BatchStatus::VOID;
        batch.clearing_tick = CENTER_TICK as u16;
        batch.clearing_price = market.last_oracle_price;
        batch.matched_lots = 0;

        emit!(BatchVoided {
            batch_id,
            reason: 1, // Late clearance
        });

        if market.next_batch_to_clear <= batch_id {
            market.next_batch_to_clear = batch_id + 1;
        }

        msg!("Batch {} expired and marked VOID", batch_id);
    } else {
        require!(
            batch.status == BatchStatus::VOID,
            EpochError::BatchNotCleared
        );
    }

    // 4. Release orders for user accounts provided in remaining_accounts
    let funding_index = market.funding_index;
    let mut total_funding_residual: i128 = 0;
    let mut seen_users = BTreeSet::new();

    for acc_info in ctx.remaining_accounts.iter() {
        if !seen_users.insert(acc_info.key()) {
            return err!(EpochError::DuplicateUserAccount);
        }

        require_keys_eq!(*acc_info.owner, crate::ID, EpochError::Unauthorized);
        let user_loader = AccountLoader::<UserAccount>::try_from(acc_info)?;
        let mut user = user_loader.load_mut()?;

        // Verify PDA derivation
        let expected_user_pda =
            Pubkey::find_program_address(&[b"user", user.owner.as_ref()], &crate::ID).0;
        require_keys_eq!(acc_info.key(), expected_user_pda, EpochError::Unauthorized);

        let user_pda = acc_info.key();

        // Apply accrued funding on existing base_position if any
        if user.base_position != 0 && funding_index != user.funding_snapshot {
            let delta = funding_index - user.funding_snapshot;
            let prod = user.base_position as i128 * delta;
            let payment = if prod > 0 {
                (prod + F_SCALE - 1) / F_SCALE
            } else {
                prod / F_SCALE
            };
            user.quote_position = user
                .quote_position
                .checked_sub(payment)
                .ok_or(EpochError::MathOverflow)?;
            total_funding_residual = total_funding_residual
                .checked_add(payment)
                .ok_or(EpochError::MathOverflow)?;
        }
        user.funding_snapshot = funding_index;

        let mut user_released_orders: u8 = 0;

        // Scan batch orders for this user
        for i in 0..(batch.num_orders as usize) {
            let order = &mut batch.orders[i];
            if order.user_pda != user_pda {
                continue;
            }
            if order.status == OrderStatus::SETTLED || order.status == OrderStatus::CANCELLED {
                continue;
            }

            let side = order.side;
            let lots = order.lots;

            // Release user pending lots & active order count
            if side == OrderSide::BUY {
                user.pending_buy_lots = user.pending_buy_lots.saturating_sub(lots);
            } else {
                user.pending_sell_lots = user.pending_sell_lots.saturating_sub(lots);
            }
            user.active_orders = user.active_orders.saturating_sub(1);

            // In an expired/void batch, no fills occur:
            order.filled_lots = 0;
            order.status = OrderStatus::SETTLED;
            batch.settled_orders = batch.settled_orders.saturating_add(1);
            user_released_orders += 1;
        }

        if user_released_orders > 0 {
            emit!(UserSettled {
                user: user_pda,
                batch_id,
                fill_lots: 0,
                fee: 0,
            });
            msg!(
                "Released {} orders for user {} in stale batch {}",
                user_released_orders,
                user_pda,
                batch_id
            );
        }
    }

    // Funding residual goes to fee_pool
    if total_funding_residual > 0 {
        market.fee_pool = market
            .fee_pool
            .checked_add(total_funding_residual as u64)
            .ok_or(EpochError::MathOverflow)?;
    } else if total_funding_residual < 0 {
        let neg = (-total_funding_residual) as u64;
        market.fee_pool = market
            .fee_pool
            .checked_sub(neg)
            .ok_or(EpochError::MathOverflow)?;
    }

    // 5. If all orders in batch are settled (or batch had 0 orders), mark SETTLED so ring slot can be reused
    if batch.settled_orders >= batch.num_orders {
        batch.status = BatchStatus::SETTLED;
        msg!(
            "Batch {} fully settled and released (all {} orders)",
            batch_id,
            batch.num_orders
        );
    }

    Ok(())
}
