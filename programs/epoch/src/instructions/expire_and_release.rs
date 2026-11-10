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

    // Security Requirement A.1: Never expire or void a CLEARED batch.
    // CLEARED batches contain executed trades and MUST be settled via settle_users.
    require!(
        batch.status != BatchStatus::CLEARED,
        EpochError::CannotExpireClearedBatch
    );

    // 3. Stale / Void check:
    // Batch must either already be VOID, or be OPEN and past close_slot + max_clear_delay_slots
    if batch.status == BatchStatus::OPEN {
        let is_stale = current_slot > close_slot.saturating_add(max_delay);
        require!(is_stale, EpochError::BatchNotStale);

        require!(
            batch_id >= market.next_batch_to_clear,
            EpochError::BatchNotNextInSequence
        );

        // Transition batch to VOID
        batch.status = BatchStatus::VOID;
        batch.clearing_tick = CENTER_TICK as u16;
        batch.clearing_price = market.last_oracle_price;
        batch.matched_lots = 0;

        emit!(BatchVoided {
            batch_id,
            reason: 1, // Late clearance
        });

        market.next_batch_to_clear = market
            .next_batch_to_clear
            .max(batch_id.checked_add(1).ok_or(EpochError::MathOverflow)?);

        msg!("Batch {} expired and marked VOID", batch_id);
    } else {
        require!(
            batch.status == BatchStatus::VOID,
            EpochError::BatchNotCleared
        );
    }

    // 4. Release orders for user accounts provided in remaining_accounts
    let funding_index = market.funding_index;
    let mut page_gross_funding_payments: u64 = 0;
    let mut page_gross_funding_receipts: u64 = 0;
    let mut page_funding_rounding_residuals: u64 = 0;
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
            let (payment, user_residual) = if prod > 0 {
                let floor_pay = prod / F_SCALE;
                let rem = prod % F_SCALE;
                let pay = if rem != 0 { floor_pay + 1 } else { floor_pay };
                let res: u64 = if rem != 0 { 1 } else { 0 };
                (pay, res)
            } else {
                (prod / F_SCALE, 0u64)
            };
            user.quote_position = user
                .quote_position
                .checked_sub(payment)
                .ok_or(EpochError::MathOverflow)?;

            if payment > 0 {
                page_gross_funding_payments = page_gross_funding_payments
                    .checked_add(payment as u64)
                    .ok_or(EpochError::MathOverflow)?;
                page_funding_rounding_residuals = page_funding_rounding_residuals
                    .checked_add(user_residual)
                    .ok_or(EpochError::MathOverflow)?;
            } else if payment < 0 {
                let receipt = u64::try_from(payment.checked_abs().ok_or(EpochError::MathOverflow)?)
                    .map_err(|_| EpochError::MathOverflow)?;
                page_gross_funding_receipts = page_gross_funding_receipts
                    .checked_add(receipt)
                    .ok_or(EpochError::MathOverflow)?;
            }
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

            // Defensive guard: Voided batches must never have filled or partially filled orders
            require!(
                order.status != OrderStatus::FILLED && order.status != OrderStatus::PARTIAL,
                EpochError::BatchAlreadySettled
            );

            // Release user pending lots & active order count using checked arithmetic
            if side == OrderSide::BUY {
                user.pending_buy_lots = user.pending_buy_lots
                    .checked_sub(lots)
                    .ok_or(EpochError::MathOverflow)?;
            } else {
                user.pending_sell_lots = user.pending_sell_lots
                    .checked_sub(lots)
                    .ok_or(EpochError::MathOverflow)?;
            }
            user.active_orders = user.active_orders
                .checked_sub(1)
                .ok_or(EpochError::MathOverflow)?;

            // In an expired/void batch, no fills occur:
            order.filled_lots = 0;
            order.status = OrderStatus::SETTLED;
            batch.settled_orders = batch.settled_orders
                .checked_add(1)
                .ok_or(EpochError::MathOverflow)?;
            user_released_orders += 1;
        }

        // A.3: Reject accounts that do not match any unsettled order in this batch
        require!(user_released_orders > 0, EpochError::InvalidUserAccount);

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

    // Spec §8: Only genuine non-negative rounding residuals (payers' round-ups)
    // are credited to fee_pool. Never debit fee_pool for negative page-level net funding
    // in partial settlement pages.
    let _net_page_funding = (page_gross_funding_payments as i128)
        .checked_sub(page_gross_funding_receipts as i128)
        .ok_or(EpochError::MathOverflow)?;

    if page_funding_rounding_residuals > 0 {
        market.fee_pool = market
            .fee_pool
            .checked_add(page_funding_rounding_residuals)
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
