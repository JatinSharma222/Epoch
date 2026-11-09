use anchor_lang::prelude::*;
use std::collections::BTreeSet;

use crate::errors::EpochError;
use crate::events::UserSettled;
use crate::state::constants::{F_SCALE, RING_SIZE};
use crate::state::{Batch, BatchStatus, Market, OrderSide, OrderStatus, UserAccount};

#[derive(Accounts)]
#[instruction(batch_id: u64, ring_index: u8)]
pub struct SettleUsers<'info> {
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
}

pub fn handle_settle_users<'info>(
    ctx: Context<'_, '_, 'info, 'info, SettleUsers<'info>>,
    batch_id: u64,
    ring_index: u8,
) -> Result<()> {
    // 1. Validate ring index matches target_batch % RING_SIZE
    let expected_ring_index = (batch_id % RING_SIZE as u64) as u8;
    require_eq!(ring_index, expected_ring_index, EpochError::InvalidSlotId);

    // 2. Validate batch
    let mut batch = ctx.accounts.batch.load_mut()?;
    require_eq!(batch.batch_id, batch_id, EpochError::BatchIdMismatch);

    // Idempotent: if already settled, return Ok
    if batch.status == BatchStatus::SETTLED {
        return Ok(());
    }

    require!(
        batch.status == BatchStatus::CLEARED || batch.status == BatchStatus::VOID,
        EpochError::BatchNotCleared
    );

    let mut market = ctx.accounts.market.load_mut()?;
    let clearing_price = batch.clearing_price;
    let fee_bps = market.params.fee_bps as u128;
    let funding_index = market.funding_index;

    // Track page-level gross funding transfers, net page funding, and genuine rounding residuals
    let mut page_gross_funding_payments: u64 = 0;
    let mut page_gross_funding_receipts: u64 = 0;
    let mut page_funding_rounding_residuals: u64 = 0;

    // 3. Duplicate check across remaining_accounts
    let mut seen_users = BTreeSet::new();

    // 4. Process each user account in remaining_accounts
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
        let old_base_position = user.base_position;

        // Apply accrued funding on existing base_position BEFORE changing position (spec §8)
        if user.base_position != 0 && funding_index != user.funding_snapshot {
            let delta = funding_index - user.funding_snapshot;
            let prod = user.base_position as i128 * delta;
            let (payment, user_residual) = if prod > 0 {
                // Round up for amount owed by user
                let floor_pay = prod / F_SCALE;
                let rem = prod % F_SCALE;
                let pay = if rem != 0 { floor_pay + 1 } else { floor_pay };
                let res: u64 = if rem != 0 { 1 } else { 0 };
                (pay, res)
            } else {
                // Round down (towards zero) for amount owed to user
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

        let mut user_fill_lots: u64 = 0;
        let mut user_fees: u64 = 0;

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
            let filled_lots = order.filled_lots;

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

            // Apply fill if any
            if filled_lots > 0 {
                // notional = filled_lots * (clearing_price / 1000)
                let notional = (filled_lots as u128)
                    .checked_mul(clearing_price as u128)
                    .ok_or(EpochError::MathOverflow)?
                    / 1000;

                if side == OrderSide::BUY {
                    user.base_position = user
                        .base_position
                        .checked_add(filled_lots as i64)
                        .ok_or(EpochError::MathOverflow)?;
                    user.quote_position = user
                        .quote_position
                        .checked_sub(notional as i128)
                        .ok_or(EpochError::MathOverflow)?;
                } else {
                    user.base_position = user
                        .base_position
                        .checked_sub(filled_lots as i64)
                        .ok_or(EpochError::MathOverflow)?;
                    user.quote_position = user
                        .quote_position
                        .checked_add(notional as i128)
                        .ok_or(EpochError::MathOverflow)?;
                }

                let fee = if fee_bps > 0 {
                    (notional * fee_bps).div_ceil(10_000)
                } else {
                    0
                };

                user.collateral = user
                    .collateral
                    .checked_sub(fee as i64)
                    .ok_or(EpochError::MathOverflow)?;
                user_fees = user_fees
                    .checked_add(fee as u64)
                    .ok_or(EpochError::MathOverflow)?;
                user_fill_lots = user_fill_lots
                    .checked_add(filled_lots)
                    .ok_or(EpochError::MathOverflow)?;
            }

            // Mark order settled and increment settled count using checked arithmetic
            order.status = OrderStatus::SETTLED;
            batch.settled_orders = batch.settled_orders
                .checked_add(1)
                .ok_or(EpochError::MathOverflow)?;
        }

        if user_fees > 0 {
            market.fee_pool = market
                .fee_pool
                .checked_add(user_fees)
                .ok_or(EpochError::MathOverflow)?;
        }

        // If user position became flat through auction settlement, clear liquidation quarantine flags (H4-2)
        // and fold realized PnL into collateral
        if user.base_position == 0 {
            user.flags &= !(crate::state::UserFlags::LIQUIDATING | crate::state::UserFlags::LIQUIDATION_LOCKED);
            if user.quote_position != 0 {
                let quote_pnl = i64::try_from(user.quote_position).map_err(|_| EpochError::MathOverflow)?;
                user.collateral = user
                    .collateral
                    .checked_add(quote_pnl)
                    .ok_or(EpochError::MathOverflow)?;
                user.quote_position = 0;
            }
        }

        // Update open interest based on net long position change
        let old_long = if old_base_position > 0 {
            old_base_position as u64
        } else {
            0
        };
        let new_long = if user.base_position > 0 {
            user.base_position as u64
        } else {
            0
        };
        if new_long > old_long {
            market.open_interest_lots = market
                .open_interest_lots
                .saturating_add(new_long - old_long);
        } else if old_long > new_long {
            market.open_interest_lots = market
                .open_interest_lots
                .saturating_sub(old_long - new_long);
        }

        emit!(UserSettled {
            user: user_pda,
            batch_id,
            fill_lots: user_fill_lots,
            fee: user_fees,
        });
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

    // 5. Check if all orders in batch are settled
    if batch.settled_orders >= batch.num_orders {
        batch.status = BatchStatus::SETTLED;
        msg!(
            "Batch {} fully settled (all {} orders)",
            batch_id,
            batch.num_orders
        );
    }

    Ok(())
}
