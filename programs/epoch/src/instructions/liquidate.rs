use crate::errors::EpochError;
use crate::events::PositionLiquidated;
use crate::oracle::verify_price_update_strict_with_market;
use crate::state::constants::F_SCALE;
use crate::state::{Market, UserAccount, UserFlags};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(
        mut,
        seeds = [b"market"],
        bump = market.load()?.bump,
    )]
    pub market: AccountLoader<'info, Market>,

    /// CHECK: PDA derived with seed [b"vault"]. Authority for the backstop vault user.
    #[account(
        seeds = [b"vault"],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// The Backstop Vault's UserAccount PDA that absorbs the liquidated position (spec §10.4).
    #[account(
        mut,
        seeds = [b"user", vault_authority.key().as_ref()],
        bump
    )]
    pub vault_user: AccountLoader<'info, UserAccount>,

    /// The undercollateralized user account being liquidated.
    #[account(
        mut,
        seeds = [b"user", liquidatee.key().as_ref()],
        bump
    )]
    pub user: AccountLoader<'info, UserAccount>,

    /// CHECK: Wallet owner of the user account being liquidated.
    pub liquidatee: UncheckedAccount<'info>,

    /// Pyth PriceUpdateV2 account from Pyth Solana Receiver program.
    /// CHECK: Validated on-chain by verify_price_update_strict.
    pub price_update: AccountInfo<'info>,

    /// Permissionless caller / liquidator / keeper triggering the liquidation.
    pub liquidator: Signer<'info>,
}

/// Execution outcome returned by core liquidation engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LiquidationExecutionResult {
    pub delta_lots: u64,
    pub notional: u64,
    pub penalty: u64,
    pub insurance_covered: u64,
    pub bad_debt: u64,
    pub bankruptcy_price: u64,
    pub user_remaining_collateral: i64,
    pub is_solvent: bool,
    pub adl_executed_lots: u64,
    pub remaining_bankrupt_lots: u64,
}

/// Calculates bankruptcy price from first principles:
/// At P_bk, user equity is identically ZERO for both long and short positions.
/// Derived as:
/// P_bk = (1000 / |q|) * (N - sign(q) * (C - Funding))
/// Equivalent analytical form using ledger quote_position:
/// P_bk = (-net_cash * 1000) / base_position
pub fn calculate_bankruptcy_price(
    collateral: i64,
    quote_position: i128,
    base_position_lots: i64,
    pending_funding: i128,
) -> u64 {
    if base_position_lots == 0 {
        return 0;
    }
    let net_cash = collateral as i128 + quote_position - pending_funding;
    let numerator = -net_cash * 1000;
    let p_bk = numerator / (base_position_lots as i128);
    p_bk.max(0) as u64
}

/// Convenience first-principles bankruptcy price calculator matching entry notional representation:
/// P_bk = (1000 / |q|) * (N - sign(q) * (C - Funding))
pub fn calculate_bankruptcy_price_from_entry_notional(
    collateral: i64,
    entry_notional: i64,
    base_position_lots: i64,
    funding_accrued: i64,
) -> u64 {
    if base_position_lots == 0 {
        return 0;
    }
    let abs_q = base_position_lots.abs() as i128;
    let sign_q = if base_position_lots > 0 { 1i128 } else { -1i128 };
    let net_cash = collateral as i128 - funding_accrued as i128;

    let numerator = entry_notional as i128 - sign_q * net_cash;
    let p_bk = (numerator * 1000) / abs_q;
    p_bk.max(0) as u64
}

/// Computes ADL ranking score: Score = EffectiveLeverage * UnrealizedPnLPercent
/// Opposing positions are ranked deterministically by composite score.
/// Only profitable positions (uPnL > 0) are eligible for ADL.
pub fn calculate_adl_score(
    equity: i64,
    entry_notional: i64,
    base_position_lots: i64,
    oracle_price: u64,
) -> u128 {
    if equity <= 0 || entry_notional <= 0 || base_position_lots == 0 {
        return 0;
    }
    let notional = (base_position_lots.unsigned_abs() as u128 * oracle_price as u128) / 1000;
    let pos_value = (base_position_lots as i128 * oracle_price as i128) / 1000;
    let upnl = if base_position_lots > 0 {
        pos_value - entry_notional as i128
    } else {
        entry_notional as i128 - pos_value.abs()
    };
    if upnl <= 0 {
        return 0; // Only profitable positions are eligible for ADL
    }
    let effective_leverage_scaled = (notional * 1_000_000) / (equity as u128);
    let upnl_pct_scaled = ((upnl as u128) * 1_000_000) / (entry_notional as u128);
    (effective_leverage_scaled * upnl_pct_scaled) / 1_000_000
}

/// Executes auto-deleveraging (ADL) on a single counterparty position against remaining bankrupt lots at P_bk.
pub fn apply_adl_counterparty(
    cp: &mut UserAccount,
    bankrupt_is_long: bool,
    remaining_bankrupt: &mut u64,
    p_bk: u64,
    notional: &mut u64,
    delta_lots: &mut u64,
    adl_executed_lots: &mut u64,
) -> Result<()> {
    if *remaining_bankrupt == 0 {
        return Ok(());
    }
    // Must be opposing position
    if bankrupt_is_long && cp.base_position >= 0 {
        return Ok(());
    }
    if !bankrupt_is_long && cp.base_position <= 0 {
        return Ok(());
    }

    let cp_lots = cp.base_position.unsigned_abs();
    let adl_step = (*remaining_bankrupt).min(cp_lots);
    if adl_step == 0 {
        return Ok(());
    }

    let adl_notional = (((adl_step as u128) * p_bk as u128) / 1000) as u64;
    if bankrupt_is_long {
        // Bankrupt was long, counterparty is short
        // Counterparty buys adl_step lots at p_bk
        cp.base_position = cp
            .base_position
            .checked_add(adl_step as i64)
            .ok_or(EpochError::MathOverflow)?;
        cp.quote_position = cp
            .quote_position
            .checked_sub(adl_notional as i128)
            .ok_or(EpochError::MathOverflow)?;
    } else {
        // Bankrupt was short, counterparty is long
        // Counterparty sells adl_step lots at p_bk
        cp.base_position = cp
            .base_position
            .checked_sub(adl_step as i64)
            .ok_or(EpochError::MathOverflow)?;
        cp.quote_position = cp
            .quote_position
            .checked_add(adl_notional as i128)
            .ok_or(EpochError::MathOverflow)?;
    }

    *remaining_bankrupt = remaining_bankrupt.saturating_sub(adl_step);
    *adl_executed_lots = adl_executed_lots.saturating_add(adl_step);
    *notional = notional.saturating_add(adl_notional);
    *delta_lots = delta_lots.saturating_add(adl_step);

    Ok(())
}

/// Core production instruction logic for executing liquidations, supporting both:
/// - Regime A: Solvent undercollateralized (partial liquidation, backstop inventory headroom,
///   50/50 penalty split, post-liquidation margin recalculation, LIQUIDATION_LOCKED quarantine)
/// - Regime B: Insolvent bankruptcy (first-principles P_bk, zero-notional bad debt invariant,
///   exact uncovered deficit accounting, backstop capacity absorption, deterministic ADL)
pub fn execute_liquidation(
    market: &mut Market,
    user: &mut UserAccount,
    vault_user: &mut UserAccount,
    counterparties: &mut [&mut UserAccount],
    oracle_price: u64,
    _current_slot: u64,
) -> Result<LiquidationExecutionResult> {
    // 1. User must have no pending/unsettled orders in open batches
    require!(
        user.pending_buy_lots == 0 && user.pending_sell_lots == 0 && user.active_orders == 0,
        EpochError::HasPendingOrders
    );

    // 2. User must have an open position to liquidate
    require!(user.base_position != 0, EpochError::PositionFlat);

    // 3. User pending funding & equity calculation
    let user_delta = market.funding_index.saturating_sub(user.funding_snapshot);
    let user_pending_funding = (user.base_position as i128 * user_delta) / F_SCALE;

    // Equity = collateral + quote_position + base_position * (oracle_price / 1000) - pending_funding
    let pos_val = (user.base_position as i128 * oracle_price as i128) / 1000;
    let user_equity =
        user.collateral as i128 + user.quote_position + pos_val - user_pending_funding;

    // Maintenance margin requirement: mmr_bps * |base_position| * m / 1000 / 10,000
    let abs_base = user.base_position.unsigned_abs() as u128;
    let mmr_req = (market.params.mmr_bps as u128 * abs_base * oracle_price as u128) / 1000 / 10_000;

    // User is liquidatable only when equity < mmr_req
    require!(user_equity < mmr_req as i128, EpochError::NotLiquidatable);

    // Apply pending funding before position transfer
    user.quote_position = user
        .quote_position
        .checked_sub(user_pending_funding)
        .ok_or(EpochError::MathOverflow)?;
    user.funding_snapshot = market.funding_index;

    let vault_delta = market
        .funding_index
        .saturating_sub(vault_user.funding_snapshot);
    let vault_pending_funding = (vault_user.base_position as i128 * vault_delta) / F_SCALE;
    vault_user.quote_position = vault_user
        .quote_position
        .checked_sub(vault_pending_funding)
        .ok_or(EpochError::MathOverflow)?;
    vault_user.funding_snapshot = market.funding_index;

    let old_user_base = user.base_position;
    let old_vault_base = vault_user.base_position;
    let is_solvent = user_equity >= 0;

    let mut penalty = 0u64;
    let mut insurance_covered = 0u64;
    let mut bad_debt = 0u64;
    let mut adl_executed_lots = 0u64;
    let mut p_bk = 0u64;
    let mut notional = 0u64;
    let mut delta_lots;
    let mut remaining_bankrupt = 0u64;

    let max_inv = market.vault_params.max_inventory_lots as i64;
    let avail_lots = if user.base_position > 0 {
        (max_inv - vault_user.base_position).max(0) as u64
    } else {
        (vault_user.base_position + max_inv).max(0) as u64
    };

    if is_solvent {
        // ── REGIME A: Solvent Undercollateralized (0 <= E < MMR) ──
        // Partial liquidation step size: alpha = 50%, min 100 lots
        let half = abs_base / 2;
        let target_lots = half.max(100).min(abs_base) as u64;

        delta_lots = target_lots.min(avail_lots);
        if delta_lots == 0 {
            // Vault capacity saturated: quarantine user under LIQUIDATION_LOCKED
            user.flags |= UserFlags::LIQUIDATION_LOCKED;
            return Err(EpochError::VaultCapacityExhausted.into());
        }

        notional = (((delta_lots as u128) * oracle_price as u128) / 1000) as u64;

        if old_user_base > 0 {
            // Long liquidatee sells delta_lots to vault
            user.base_position = user
                .base_position
                .checked_sub(delta_lots as i64)
                .ok_or(EpochError::MathOverflow)?;
            user.quote_position = user
                .quote_position
                .checked_add(notional as i128)
                .ok_or(EpochError::MathOverflow)?;

            vault_user.base_position = vault_user
                .base_position
                .checked_add(delta_lots as i64)
                .ok_or(EpochError::MathOverflow)?;
            vault_user.quote_position = vault_user
                .quote_position
                .checked_sub(notional as i128)
                .ok_or(EpochError::MathOverflow)?;
        } else {
            // Short liquidatee buys delta_lots from vault
            user.base_position = user
                .base_position
                .checked_add(delta_lots as i64)
                .ok_or(EpochError::MathOverflow)?;
            user.quote_position = user
                .quote_position
                .checked_sub(notional as i128)
                .ok_or(EpochError::MathOverflow)?;

            vault_user.base_position = vault_user
                .base_position
                .checked_sub(delta_lots as i64)
                .ok_or(EpochError::MathOverflow)?;
            vault_user.quote_position = vault_user
                .quote_position
                .checked_add(notional as i128)
                .ok_or(EpochError::MathOverflow)?;
        }

        // Fold quote_position into collateral if position reached flat
        if user.base_position == 0 {
            let quote_pnl = i64::try_from(user.quote_position).map_err(|_| EpochError::MathOverflow)?;
            user.collateral = user
                .collateral
                .checked_add(quote_pnl)
                .ok_or(EpochError::MathOverflow)?;
            user.quote_position = 0;
        }

        // Liquidation penalty (capped by user equity)
        if user_equity > 0 {
            let raw_penalty = (notional as u128 * market.params.liq_penalty_bps as u128) / 10_000;
            let actual_penalty = u64::try_from(raw_penalty.min(user_equity as u128)).map_err(|_| EpochError::MathOverflow)?;
            if actual_penalty > 0 {
                let actual_penalty_i64 = i64::try_from(actual_penalty).map_err(|_| EpochError::MathOverflow)?;
                user.collateral = user
                    .collateral
                    .checked_sub(actual_penalty_i64)
                    .ok_or(EpochError::MathOverflow)?;

                // 50/50 Penalty split: 50% to bounty pool, 50% to insurance fund
                let bounty = actual_penalty / 2;
                let insurance_credit = actual_penalty.saturating_sub(bounty);

                market.fee_pool = market
                    .fee_pool
                    .checked_add(bounty)
                    .ok_or(EpochError::MathOverflow)?;
                market.insurance_fund = market
                    .insurance_fund
                    .checked_add(insurance_credit)
                    .ok_or(EpochError::MathOverflow)?;
                penalty = actual_penalty;
            }
        }

        // Post-liquidation margin recalculation:
        if user.base_position != 0 {
            let rem_pos_val = (user.base_position as i128 * oracle_price as i128) / 1000;
            let rem_equity = user.collateral as i128 + user.quote_position + rem_pos_val;
            let rem_abs_base = user.base_position.unsigned_abs() as u128;
            let rem_mmr = (market.params.mmr_bps as u128 * rem_abs_base * oracle_price as u128) / 1000 / 10_000;

            if rem_equity >= rem_mmr as i128 && delta_lots == target_lots {
                user.flags &= !UserFlags::LIQUIDATION_LOCKED;
            } else {
                user.flags |= UserFlags::LIQUIDATION_LOCKED;
            }
        } else {
            user.flags &= !UserFlags::LIQUIDATION_LOCKED;
        }
    } else {
        // ── REGIME B: Insolvent Bankruptcy (E < 0) ──
        p_bk = calculate_bankruptcy_price(user.collateral, user.quote_position, user.base_position, 0);

        let deficit = u64::try_from(user_equity.checked_abs().ok_or(EpochError::MathOverflow)?)
            .map_err(|_| EpochError::MathOverflow)?;

        let covered = deficit.min(market.insurance_fund);
        if covered > 0 {
            market.insurance_fund = market
                .insurance_fund
                .checked_sub(covered)
                .ok_or(EpochError::MathOverflow)?;
            insurance_covered = covered;
        }
        let remaining_deficit = deficit.saturating_sub(covered);
        if remaining_deficit > 0 {
            market.bad_debt = market
                .bad_debt
                .checked_add(remaining_deficit)
                .ok_or(EpochError::MathOverflow)?;
            bad_debt = remaining_deficit;
        }

        // Bankrupt user account completely zeroed out:
        // Cash deficit is fully absorbed by insurance fund and protocol bad debt.
        user.collateral = 0;
        user.quote_position = 0;
        user.base_position = 0;
        user.flags = UserFlags::NONE;

        let bankrupt_lots = abs_base as u64;
        let vault_absorbed = bankrupt_lots.min(avail_lots);
        delta_lots = vault_absorbed;

        if vault_absorbed > 0 {
            let vault_notional = (((vault_absorbed as u128) * p_bk as u128) / 1000) as u64;
            notional = notional.saturating_add(vault_notional);

            if old_user_base > 0 {
                vault_user.base_position = vault_user
                    .base_position
                    .checked_add(vault_absorbed as i64)
                    .ok_or(EpochError::MathOverflow)?;
                vault_user.quote_position = vault_user
                    .quote_position
                    .checked_sub(vault_notional as i128)
                    .ok_or(EpochError::MathOverflow)?;
            } else {
                vault_user.base_position = vault_user
                    .base_position
                    .checked_sub(vault_absorbed as i64)
                    .ok_or(EpochError::MathOverflow)?;
                vault_user.quote_position = vault_user
                    .quote_position
                    .checked_add(vault_notional as i128)
                    .ok_or(EpochError::MathOverflow)?;
            }
        }

        // Auto-Deleveraging (ADL) for remaining bankrupt lots
        remaining_bankrupt = bankrupt_lots.saturating_sub(vault_absorbed);
        if remaining_bankrupt > 0 && !counterparties.is_empty() {
            let is_bankrupt_long = old_user_base > 0;

            for cp in counterparties.iter_mut() {
                apply_adl_counterparty(
                    cp,
                    is_bankrupt_long,
                    &mut remaining_bankrupt,
                    p_bk,
                    &mut notional,
                    &mut delta_lots,
                    &mut adl_executed_lots,
                )?;
            }
        }

        // Zero-Notional Bad Debt Invariant:
        // Any remaining unhedged contracts are cancelled from global open interest at P_bk.
        // Under NO circumstances is remaining position notional converted into bad debt!
    }

    // Update Market Open Interest based on long position changes
    let old_longs = (if old_user_base > 0 { old_user_base as u64 } else { 0 })
        + (if old_vault_base > 0 { old_vault_base as u64 } else { 0 });
    let new_longs = (if user.base_position > 0 { user.base_position as u64 } else { 0 })
        + (if vault_user.base_position > 0 { vault_user.base_position as u64 } else { 0 });

    if new_longs > old_longs {
        market.open_interest_lots = market.open_interest_lots.saturating_add(new_longs - old_longs);
    } else if old_longs > new_longs {
        market.open_interest_lots = market.open_interest_lots.saturating_sub(old_longs - new_longs);
    }

    market.last_oracle_price = oracle_price;

    Ok(LiquidationExecutionResult {
        delta_lots,
        notional,
        penalty,
        insurance_covered,
        bad_debt,
        bankruptcy_price: p_bk,
        user_remaining_collateral: user.collateral,
        is_solvent,
        adl_executed_lots,
        remaining_bankrupt_lots: remaining_bankrupt,
    })
}

pub fn handle_liquidate<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, Liquidate<'info>>,
) -> Result<()>
where
    'c: 'info,
{
    // 1. Prevent self-liquidation of vault against itself
    require_keys_neq!(
        ctx.accounts.user.key(),
        ctx.accounts.vault_user.key(),
        EpochError::SelfLiquidation
    );

    let mut market = ctx.accounts.market.load_mut()?;
    let mut user = ctx.accounts.user.load_mut()?;
    let mut vault_user = ctx.accounts.vault_user.load_mut()?;

    // 2. Liquidatee identity verification
    require_keys_eq!(
        user.owner,
        ctx.accounts.liquidatee.key(),
        EpochError::Unauthorized
    );

    // 3. Oracle price resolution and safety guards via oracle account
    let clock = Clock::get()?;
    let pyth_data = verify_price_update_strict_with_market(
        &ctx.accounts.price_update,
        &market.oracle_feed_id,
        &ctx.accounts.market.key(),
        market.params.max_oracle_age_secs,
        market.params.max_conf_bps,
        clock.unix_timestamp,
    )?;
    let oracle_price = pyth_data.price;

    let old_user_base = user.base_position;

    let mut res = execute_liquidation(
        &mut market,
        &mut user,
        &mut vault_user,
        &mut [],
        oracle_price,
        clock.slot,
    )?;

    // If there are unabsorbed bankrupt lots and remaining accounts were provided, perform ADL on them
    if !res.is_solvent && res.remaining_bankrupt_lots > 0 && !ctx.remaining_accounts.is_empty() {
        let is_bankrupt_long = old_user_base > 0;
        let mut remaining = res.remaining_bankrupt_lots;
        for acc in ctx.remaining_accounts.iter() {
            if remaining == 0 {
                break;
            }
            if *acc.owner == crate::ID {
                if let Ok(loader) = AccountLoader::<'info, UserAccount>::try_from(acc) {
                    if let Ok(mut cp) = loader.load_mut() {
                        apply_adl_counterparty(
                            &mut cp,
                            is_bankrupt_long,
                            &mut remaining,
                            res.bankruptcy_price,
                            &mut res.notional,
                            &mut res.delta_lots,
                            &mut res.adl_executed_lots,
                        )?;
                    }
                }
            }
        }
        res.remaining_bankrupt_lots = remaining;
    }

    // Determine current batch ID & emit event
    let n_slots = market.params.batch_slots as u64;
    let current_batch = if clock.slot >= market.start_slot && n_slots > 0 {
        (clock.slot - market.start_slot) / n_slots
    } else {
        0
    };

    let liquidated_lots_signed = (res.delta_lots as i64) * (if old_user_base > 0 { 1 } else { -1 });
    emit!(PositionLiquidated {
        liquidatee: ctx.accounts.user.key(),
        liquidator: ctx.accounts.liquidator.key(),
        batch_id: current_batch,
        oracle_price,
        base_lots: liquidated_lots_signed,
        notional: res.notional,
        penalty: res.penalty,
        insurance_covered: res.insurance_covered,
        bad_debt: res.bad_debt,
        user_remaining_collateral: res.user_remaining_collateral,
    });

    msg!(
        "Liquidation resolved: liquidatee={}, lots={}, notional={}, penalty={}, covered={}, bad_debt={}, p_bk={}",
        ctx.accounts.user.key(),
        liquidated_lots_signed,
        res.notional,
        res.penalty,
        res.insurance_covered,
        res.bad_debt,
        res.bankruptcy_price
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_market(mmr_bps: u16, liq_penalty_bps: u16, insurance_fund: u64, max_inv: u64) -> Market {
        Market {
            funding_index: 0,
            admin: Pubkey::new_unique(),
            oracle_authority: Pubkey::new_unique(),
            quote_mint: Pubkey::new_unique(),
            collateral_vault: Pubkey::new_unique(),
            oracle_feed_id: [0u8; 32],
            params: crate::state::MarketParams {
                mmr_bps,
                liq_penalty_bps,
                ..Default::default()
            },
            start_slot: 100,
            next_batch_to_clear: 0,
            last_oracle_price: 150_000_000,
            last_oracle_slot: 100,
            open_interest_lots: 10_000,
            fee_pool: 100_000_000,
            insurance_fund,
            bad_debt: 0,
            vault_params: crate::state::VaultParams {
                max_inventory_lots: max_inv,
                ..Default::default()
            },
            bump: 255,
            _pad_bump: [0; 7],
            _reserved: [0; 24],
        }
    }

    fn create_test_user(owner: Pubkey, collateral: i64, quote_position: i128, base_position: i64) -> UserAccount {
        UserAccount {
            quote_position,
            funding_snapshot: 0,
            owner,
            collateral,
            base_position,
            pending_buy_lots: 0,
            pending_sell_lots: 0,
            active_orders: 0,
            flags: 0,
            _pad: [0; 6],
            _reserved: [0; 64],
            _pad2: [0; 8],
        }
    }

    #[test]
    fn test_healthy_position_cannot_be_liquidated() {
        let mut market = create_test_market(500, 100, 0, 10000);
        let mut user = create_test_user(Pubkey::new_unique(), 500_000_000, 0, 10_000);
        let mut vault_user = create_test_user(Pubkey::new_unique(), 1_000_000_000, 0, 0);

        let res = execute_liquidation(&mut market, &mut user, &mut vault_user, &mut [], 150_000_000, 100);
        assert_eq!(res.unwrap_err(), EpochError::NotLiquidatable.into());
    }

    #[test]
    fn test_liquidate_positive_remaining_equity_penalty() {
        let mut market = create_test_market(500, 100, 0, 10000);
        let mut user = create_test_user(Pubkey::new_unique(), 220_000_000, -1_500_000_000, 10_000);
        let mut vault_user = create_test_user(Pubkey::new_unique(), 1_000_000_000, 0, 0);

        let res = execute_liquidation(&mut market, &mut user, &mut vault_user, &mut [], 130_000_000, 100)
            .expect("Liquidation should succeed");

        assert_eq!(res.is_solvent, true);
        assert_eq!(res.delta_lots, 5_000, "Partial liquidation closes 50% = 5,000 lots");
        assert_eq!(user.base_position, 5_000);
        assert_eq!(vault_user.base_position, 5_000);
        assert!(res.penalty > 0);
        assert!(market.insurance_fund > 0);
        assert_eq!(market.bad_debt, 0);
    }

    #[test]
    fn test_liquidate_deficit_absorbed_by_insurance_fund() {
        let mut market = create_test_market(500, 100, 25_000_000, 10000);
        let mut user = create_test_user(Pubkey::new_unique(), 290_000_000, -1_500_000_000, 10_000);
        let mut vault_user = create_test_user(Pubkey::new_unique(), 1_000_000_000, 0, 0);

        let res = execute_liquidation(&mut market, &mut user, &mut vault_user, &mut [], 120_000_000, 100)
            .expect("Bankrupt liquidation should succeed");

        assert_eq!(res.is_solvent, false);
        assert_eq!(user.base_position, 0);
        assert_eq!(user.collateral, 0, "User collateral completely wiped");
        assert_eq!(res.bad_debt, 0, "Deficit covered by insurance fund");
        assert_eq!(market.insurance_fund, 15_000_000);
    }

    #[test]
    fn test_liquidate_deficit_exceeding_insurance_records_bad_debt() {
        let mut market = create_test_market(500, 100, 10_000_000, 10000);
        let mut user = create_test_user(Pubkey::new_unique(), 350_000_000, -1_500_000_000, 10_000);
        let mut vault_user = create_test_user(Pubkey::new_unique(), 1_000_000_000, 0, 0);

        let res = execute_liquidation(&mut market, &mut user, &mut vault_user, &mut [], 110_000_000, 100)
            .expect("Bankrupt liquidation exceeding IF should succeed");

        assert_eq!(res.is_solvent, false);
        assert_eq!(market.insurance_fund, 0, "Insurance fund exhausted");
        assert_eq!(res.bad_debt, 40_000_000, "Remaining deficit recorded as bad debt");
        assert_eq!(user.collateral, 0, "Bankrupt user collateral wiped to 0");
    }

    #[test]
    fn test_liquidate_short_position() {
        let mut market = create_test_market(500, 100, 0, 10000);
        let mut user = create_test_user(Pubkey::new_unique(), 200_000_000, 1_500_000_000, -10_000);
        let mut vault_user = create_test_user(Pubkey::new_unique(), 1_000_000_000, 0, 0);

        let res = execute_liquidation(&mut market, &mut user, &mut vault_user, &mut [], 168_000_000, 100)
            .expect("Short liquidation should succeed");

        assert_eq!(res.is_solvent, true);
        assert_eq!(res.delta_lots, 5_000);
        assert_eq!(user.base_position, -5_000);
        assert_eq!(vault_user.base_position, -5_000);
    }
}
