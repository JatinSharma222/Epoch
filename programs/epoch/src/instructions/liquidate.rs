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
    let net_cash = (collateral as i128)
        .checked_add(quote_position)
        .and_then(|c| c.checked_sub(pending_funding));
    let Some(net_cash) = net_cash else {
        return 0;
    };
    let Some(numerator) = net_cash.checked_neg().and_then(|n| n.checked_mul(1000)) else {
        return 0;
    };
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
    let abs_q = base_position_lots.unsigned_abs() as i128;
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
        entry_notional as i128 - (pos_value.unsigned_abs() as i128)
    };
    if upnl <= 0 {
        return 0; // Only profitable positions are eligible for ADL
    }
    let effective_leverage_scaled = (notional * 1_000_000) / (equity as u128);
    let upnl_pct_scaled = ((upnl as u128) * 1_000_000) / (entry_notional as u128);
    (effective_leverage_scaled * upnl_pct_scaled) / 1_000_000
}

/// Executes auto-deleveraging (ADL) on a single counterparty position against remaining bankrupt lots at P_bk.
///
/// Direction Validation (Spec H-4 §10.5):
/// - Rejects same-direction positions (bankrupt long vs cp long, bankrupt short vs cp short)
/// - Rejects flat positions (cp.base_position == 0)
/// - Rejects invalid bankruptcy price (p_bk == 0)
#[allow(clippy::too_many_arguments)]
pub fn apply_adl_counterparty(
    cp: &mut UserAccount,
    bankrupt_is_long: bool,
    remaining_bankrupt: &mut u64,
    p_bk: u64,
    notional: &mut u64,
    delta_lots: &mut u64,
    adl_executed_lots: &mut u64,
    funding_index: i128,
) -> Result<()> {
    if *remaining_bankrupt == 0 {
        return Ok(());
    }
    require!(p_bk > 0, EpochError::InvalidOraclePrice);

    // Strict direction check: opposing position required
    if bankrupt_is_long {
        require!(cp.base_position < 0, EpochError::InvalidAdlCounterparty);
    } else {
        require!(cp.base_position > 0, EpochError::InvalidAdlCounterparty);
    }

    // Settle accrued funding for counterparty BEFORE modifying position (H4-4)
    let delta = funding_index.saturating_sub(cp.funding_snapshot);
    if delta > 0 && cp.base_position != 0 {
        let cp_pending_funding = (cp.base_position as i128 * delta) / F_SCALE;
        cp.quote_position = cp
            .quote_position
            .checked_sub(cp_pending_funding)
            .ok_or(EpochError::MathOverflow)?;
        cp.funding_snapshot = funding_index;
    }

    let cp_lots = cp.base_position.unsigned_abs();
    let adl_step = (*remaining_bankrupt).min(cp_lots);
    if adl_step == 0 {
        return Ok(());
    }

    let adl_notional = (((adl_step as u128) * p_bk as u128) / 1000) as u64;
    if bankrupt_is_long {
        // Bankrupt user was long (+q), counterparty was short (-q).
        // Counterparty buys adl_step lots at p_bk: base increases towards 0, quote decreases.
        cp.base_position = cp
            .base_position
            .checked_add(adl_step as i64)
            .ok_or(EpochError::MathOverflow)?;
        cp.quote_position = cp
            .quote_position
            .checked_sub(adl_notional as i128)
            .ok_or(EpochError::MathOverflow)?;
    } else {
        // Bankrupt user was short (-q), counterparty was long (+q).
        // Counterparty sells adl_step lots at p_bk: base decreases towards 0, quote increases.
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

        let bankrupt_lots = abs_base as u64;
        let vault_absorbed = bankrupt_lots.min(avail_lots);
        delta_lots = vault_absorbed;

        if vault_absorbed > 0 {
            let vault_notional = (((vault_absorbed as u128) * oracle_price as u128) / 1000) as u64;
            let bk_notional = (((vault_absorbed as u128) * p_bk as u128) / 1000) as u64;
            notional = notional.saturating_add(vault_notional);

            // Immediately recognize and absorb vault execution deficit (H4-1):
            // Prevents vault execution deficit from distorting P_bk or shifting onto ADL counterparties!
            let vault_deficit = if old_user_base > 0 {
                bk_notional.saturating_sub(vault_notional)
            } else {
                vault_notional.saturating_sub(bk_notional)
            };

            if vault_deficit > 0 {
                let covered = vault_deficit.min(market.insurance_fund);
                if covered > 0 {
                    market.insurance_fund = market
                        .insurance_fund
                        .checked_sub(covered)
                        .ok_or(EpochError::MathOverflow)?;
                    insurance_covered = insurance_covered.saturating_add(covered);
                }
                let rem_deficit = vault_deficit.saturating_sub(covered);
                if rem_deficit > 0 {
                    market.bad_debt = market
                        .bad_debt
                        .checked_add(rem_deficit)
                        .ok_or(EpochError::MathOverflow)?;
                    bad_debt = bad_debt.saturating_add(rem_deficit);
                }

                // Credit liquidatee collateral with the covered deficit to preserve Invariant I-1 and undistorted P_bk
                let deficit_i64 = i64::try_from(vault_deficit).map_err(|_| EpochError::MathOverflow)?;
                user.collateral = user
                    .collateral
                    .checked_add(deficit_i64)
                    .ok_or(EpochError::MathOverflow)?;
            }

            let vault_step_i64 = i64::try_from(vault_absorbed).map_err(|_| EpochError::MathOverflow)?;
            if old_user_base > 0 {
                user.base_position = user
                    .base_position
                    .checked_sub(vault_step_i64)
                    .ok_or(EpochError::MathOverflow)?;
                user.quote_position = user
                    .quote_position
                    .checked_add(vault_notional as i128)
                    .ok_or(EpochError::MathOverflow)?;

                vault_user.base_position = vault_user
                    .base_position
                    .checked_add(vault_step_i64)
                    .ok_or(EpochError::MathOverflow)?;
                vault_user.quote_position = vault_user
                    .quote_position
                    .checked_sub(vault_notional as i128)
                    .ok_or(EpochError::MathOverflow)?;
            } else {
                user.base_position = user
                    .base_position
                    .checked_add(vault_step_i64)
                    .ok_or(EpochError::MathOverflow)?;
                user.quote_position = user
                    .quote_position
                    .checked_sub(vault_notional as i128)
                    .ok_or(EpochError::MathOverflow)?;

                vault_user.base_position = vault_user
                    .base_position
                    .checked_sub(vault_step_i64)
                    .ok_or(EpochError::MathOverflow)?;
                vault_user.quote_position = vault_user
                    .quote_position
                    .checked_add(vault_notional as i128)
                    .ok_or(EpochError::MathOverflow)?;
            }
        }

        // Auto-Deleveraging (ADL) for remaining bankrupt lots against candidate counterparties
        remaining_bankrupt = bankrupt_lots.saturating_sub(vault_absorbed);
        if remaining_bankrupt > 0 && !counterparties.is_empty() {
            let is_bankrupt_long = old_user_base > 0;

            for cp in counterparties.iter_mut() {
                if remaining_bankrupt == 0 {
                    break;
                }
                let cp_lots = cp.base_position.unsigned_abs();
                let adl_step = remaining_bankrupt.min(cp_lots);
                if adl_step == 0 {
                    continue;
                }
                let adl_notional = (((adl_step as u128) * p_bk as u128) / 1000) as u64;

                apply_adl_counterparty(
                    cp,
                    is_bankrupt_long,
                    &mut remaining_bankrupt,
                    p_bk,
                    &mut notional,
                    &mut delta_lots,
                    &mut adl_executed_lots,
                    market.funding_index,
                )?;

                // Update bankrupt user symmetrically at p_bk
                if is_bankrupt_long {
                    user.base_position = user
                        .base_position
                        .checked_sub(adl_step as i64)
                        .ok_or(EpochError::MathOverflow)?;
                    user.quote_position = user
                        .quote_position
                        .checked_add(adl_notional as i128)
                        .ok_or(EpochError::MathOverflow)?;
                } else {
                    user.base_position = user
                        .base_position
                        .checked_add(adl_step as i64)
                        .ok_or(EpochError::MathOverflow)?;
                    user.quote_position = user
                        .quote_position
                        .checked_sub(adl_notional as i128)
                        .ok_or(EpochError::MathOverflow)?;
                }
            }
        }

        // If vault capacity was saturated (0 headroom) and no lots were closed via ADL,
        // quarantine account under LIQUIDATING and abort
        if delta_lots == 0 {
            user.flags |= UserFlags::LIQUIDATING;
            return Err(EpochError::VaultCapacityExhausted.into());
        }

        // Unhedged residual position handling (H-4 Finding 1):
        // If remaining_bankrupt > 0, the position could NOT be fully closed due to capacity or ADL limits.
        // We MUST NEVER silently erase residual exposure (user.base_position = 0)!
        // The user retains their unhedged residual lots, preserving global base-position conservation.
        // The account remains quarantined under UserFlags::LIQUIDATING until cured by deposit or liquidated.
        if remaining_bankrupt > 0 {
            user.flags |= UserFlags::LIQUIDATING;
            msg!(
                "Partial bankruptcy liquidation: {} lots closed, {} residual lots retained under quarantine",
                delta_lots,
                remaining_bankrupt
            );
        } else {
            // Position is fully closed (user.base_position == 0).
            // Reconcile actual cash obligation:
            let net_cash = (user.collateral as i128) + user.quote_position;
            if net_cash < 0 {
                let actual_deficit = u64::try_from(net_cash.unsigned_abs()).map_err(|_| EpochError::MathOverflow)?;
                let covered = actual_deficit.min(market.insurance_fund);
                if covered > 0 {
                    market.insurance_fund = market
                        .insurance_fund
                        .checked_sub(covered)
                        .ok_or(EpochError::MathOverflow)?;
                    insurance_covered = insurance_covered.saturating_add(covered);
                }
                let rem_deficit = actual_deficit.saturating_sub(covered);
                if rem_deficit > 0 {
                    market.bad_debt = market
                        .bad_debt
                        .checked_add(rem_deficit)
                        .ok_or(EpochError::MathOverflow)?;
                    bad_debt = bad_debt.saturating_add(rem_deficit);
                }
                user.collateral = 0;
                user.quote_position = 0;
            } else {
                user.collateral = net_cash as i64;
                user.quote_position = 0;
            }
            user.flags = UserFlags::NONE;
        }
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

pub fn process_liquidate_with_accounts<'a, 'info>(
    market_loader: &AccountLoader<'info, Market>,
    vault_user_loader: &AccountLoader<'info, UserAccount>,
    user_loader: &AccountLoader<'info, UserAccount>,
    liquidatee_key: &Pubkey,
    oracle_price: u64,
    current_slot: u64,
    remaining_accounts: &'a [AccountInfo<'info>],
) -> Result<LiquidationExecutionResult>
where
    'a: 'info,
{
    // 1. Prevent self-liquidation of vault against itself
    require_keys_neq!(
        user_loader.key(),
        vault_user_loader.key(),
        EpochError::SelfLiquidation
    );

    let mut market = market_loader.load_mut()?;
    let mut user = user_loader.load_mut()?;
    let mut vault_user = vault_user_loader.load_mut()?;

    // 2. Liquidatee identity verification
    require_keys_eq!(
        user.owner,
        *liquidatee_key,
        EpochError::Unauthorized
    );

    let old_user_base = user.base_position;
    let is_bankrupt_long = old_user_base > 0;

    // Remaining-account validation & deterministic ranking (Spec H-4 §10.5):
    let mut seen_accounts = std::collections::BTreeSet::new();

    struct RankedCandidate<'a, 'info> {
        info: &'a AccountInfo<'info>,
        score: u128,
        key: Pubkey,
    }
    let mut candidates: Vec<RankedCandidate> = Vec::with_capacity(remaining_accounts.len());

    for acc_info in remaining_accounts.iter() {
        // 1. Reject duplicate accounts
        if !seen_accounts.insert(acc_info.key()) {
            return err!(EpochError::DuplicateUserAccount);
        }

        // 2. Reject self or vault as counterparty
        require_keys_neq!(acc_info.key(), user_loader.key(), EpochError::InvalidUserAccount);
        require_keys_neq!(acc_info.key(), vault_user_loader.key(), EpochError::InvalidUserAccount);

        // 3. Ownership and writable validation
        require_keys_eq!(*acc_info.owner, crate::ID, EpochError::Unauthorized);
        require!(acc_info.is_writable, EpochError::Unauthorized);

        // 4. Account initialization and discriminator validation
        require!(
            acc_info.data_len() >= 8 + std::mem::size_of::<UserAccount>(),
            EpochError::AccountNotInitialized
        );
        {
            let data = acc_info.try_borrow_data()?;
            require!(
                &data[..8] == UserAccount::DISCRIMINATOR,
                EpochError::AccountNotInitialized
            );
        }
        let cp_loader = AccountLoader::<UserAccount>::try_from(acc_info)?;
        let cp = cp_loader.load()?;
        require!(cp.owner != Pubkey::default(), EpochError::AccountNotInitialized);

        // 5. Market / PDA derivation verification
        let expected_pda = Pubkey::find_program_address(&[b"user", cp.owner.as_ref()], &crate::ID).0;
        require_keys_eq!(acc_info.key(), expected_pda, EpochError::Unauthorized);

        // 6. Direction check: must be opposing
        if is_bankrupt_long {
            require!(cp.base_position < 0, EpochError::InvalidAdlCounterparty);
        } else {
            require!(cp.base_position > 0, EpochError::InvalidAdlCounterparty);
        }

        // 7. Calculate ADL score for deterministic protocol ranking
        let cp_delta = market.funding_index.saturating_sub(cp.funding_snapshot);
        let cp_pending_funding = (cp.base_position as i128 * cp_delta) / F_SCALE;
        let cp_pos_val = (cp.base_position as i128 * oracle_price as i128) / 1000;
        let cp_equity = cp.collateral as i128 + cp.quote_position + cp_pos_val - cp_pending_funding;
        let cp_upnl = cp.quote_position + cp_pos_val;

        // Only profitable positions with positive equity are eligible for ADL
        require!(cp_equity > 0 && cp_upnl > 0, EpochError::InvalidAdlCounterparty);

        let score = ((cp_upnl as u128) * 1_000_000) / (cp_equity as u128);
        candidates.push(RankedCandidate {
            info: acc_info,
            score,
            key: acc_info.key(),
        });
    }

    // Deterministic protocol ranking: sort candidates descending by score (tie-breaker: pubkey)
    // Completely independent of caller-supplied order!
    candidates.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| b.key.cmp(&a.key)));

    // Load candidate accounts in ranked order
    let mut loaders = Vec::with_capacity(candidates.len());
    for c in candidates.iter() {
        let loader = AccountLoader::<'info, UserAccount>::try_from(c.info)?;
        loaders.push(loader);
    }
    let mut loaded_cps = Vec::with_capacity(loaders.len());
    for l in loaders.iter() {
        loaded_cps.push(l.load_mut()?);
    }
    let mut cp_refs: Vec<&mut UserAccount> = loaded_cps.iter_mut().map(|g| &mut **g).collect();

    execute_liquidation(
        &mut market,
        &mut user,
        &mut vault_user,
        &mut cp_refs[..],
        oracle_price,
        current_slot,
    )
}

pub fn handle_liquidate<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, Liquidate<'info>>,
) -> Result<()>
where
    'c: 'info,
{
    // Oracle price resolution and safety guards via oracle account
    let clock = Clock::get()?;
    let pyth_data = {
        let market = ctx.accounts.market.load()?;
        verify_price_update_strict_with_market(
            &ctx.accounts.price_update,
            &market.oracle_feed_id,
            &ctx.accounts.market.key(),
            market.params.max_oracle_age_secs,
            market.params.max_conf_bps,
            clock.unix_timestamp,
        )?
    };
    let oracle_price = pyth_data.price;
    let old_user_base = ctx.accounts.user.load()?.base_position;

    let res = process_liquidate_with_accounts(
        &ctx.accounts.market,
        &ctx.accounts.vault_user,
        &ctx.accounts.user,
        ctx.accounts.liquidatee.key,
        oracle_price,
        clock.slot,
        ctx.remaining_accounts,
    )?;

    // Determine current batch ID & emit event
    let market = ctx.accounts.market.load()?;
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
            last_oracle_timestamp: 1_000_000,
            _reserved: [0; 16],
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

        assert!(res.is_solvent);
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

        assert!(!res.is_solvent);
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

        assert!(!res.is_solvent);
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

        assert!(res.is_solvent);
        assert_eq!(res.delta_lots, 5_000);
        assert_eq!(user.base_position, -5_000);
        assert_eq!(vault_user.base_position, -5_000);
    }
}
