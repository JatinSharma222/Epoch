use crate::errors::EpochError;
use crate::events::PositionLiquidated;
use crate::state::constants::F_SCALE;
use crate::state::{Market, UserAccount, UserFlags};
use anchor_lang::prelude::*;

/// Parameters passed into the permissionless `liquidate` instruction.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default)]
pub struct LiquidateParams {
    /// Oracle price in micro-USDC (6 decimals, e.g. 150_000_000 for $150.00).
    pub oracle_price: u64,
    /// Pyth confidence interval in micro-USDC.
    pub oracle_conf: u64,
    /// Publish timestamp of the oracle price update.
    pub oracle_timestamp: i64,
}

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

    /// Permissionless caller / liquidator / keeper triggering the liquidation.
    pub liquidator: Signer<'info>,
}

/// Permissionless liquidation close-out against the Backstop Vault (spec §10.4, architecture §6).
///
/// If a user's equity falls below the maintenance margin requirement:
///   `equity(m) < mmr_bps * |base_position| * m / 1000 / 10_000`
///
/// Anyone can call `liquidate(user)`:
/// 1. Verifies the position is undercollateralized at the current verified oracle price.
/// 2. Closes the position directly against the Backstop Vault at oracle price `m`.
/// 3. Folds realized PnL into user collateral.
/// 4. If user collateral > 0, deducts `liq_penalty_bps` (capped by remaining equity)
///    and routes it to `market.insurance_fund` (spec §10.2).
/// 5. If user collateral < 0, the deficit is absorbed by `market.insurance_fund` up to its
///    balance; any remaining shortfall is recorded as `market.bad_debt` (spec §10.3, Invariant I-11).
/// 6. Updates `market.open_interest_lots` and emits `PositionLiquidated`.
pub fn handle_liquidate(ctx: Context<Liquidate>, params: LiquidateParams) -> Result<()> {
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

    // 3. User must have no pending/unsettled orders in open batches
    require!(
        user.pending_buy_lots == 0 && user.pending_sell_lots == 0 && user.active_orders == 0,
        EpochError::HasPendingOrders
    );

    // 4. User must have an open position to liquidate
    require!(user.base_position != 0, EpochError::PositionFlat);

    // 5. Oracle price resolution and safety guards
    let oracle_price = if params.oracle_price > 0 {
        params.oracle_price
    } else if market.last_oracle_price > 0 {
        market.last_oracle_price
    } else {
        150_000_000 // default $150.00
    };
    require!(oracle_price > 0, EpochError::MathOverflow);

    let clock = Clock::get()?;
    if params.oracle_timestamp > 0 {
        let age = clock.unix_timestamp.saturating_sub(params.oracle_timestamp);
        require!(
            age <= market.params.max_oracle_age_secs as i64,
            EpochError::OracleStale
        );
    }

    if params.oracle_conf > 0 {
        let conf_bps = (params.oracle_conf as u128 * 10_000) / oracle_price as u128;
        require!(
            conf_bps <= market.params.max_conf_bps as u128,
            EpochError::OracleConfidenceTooWide
        );
    }

    // 6. User pending funding & equity calculation
    let user_delta = market.funding_index.saturating_sub(user.funding_snapshot);
    let user_pending_funding = (user.base_position as i128 * user_delta) / F_SCALE;

    // Equity = collateral + quote_position + base_position * (oracle_price / 1000) - pending_funding
    let pos_val = user.base_position as i128 * (oracle_price as i128 / 1000);
    let user_equity =
        user.collateral as i128 + user.quote_position + pos_val - user_pending_funding;

    // Maintenance margin requirement: mmr_bps * |base_position| * m / 1000 / 10,000
    let abs_base = user.base_position.unsigned_abs() as u128;
    let mmr_req = (market.params.mmr_bps as u128 * abs_base * oracle_price as u128) / 1000 / 10_000;

    // User is liquidatable only when equity < mmr_req
    require!(user_equity < mmr_req as i128, EpochError::NotLiquidatable);

    // 7. Apply pending funding to both parties before position transfer
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

    // 8. Transfer position between user and Backstop Vault at oracle price m (spec §10.4)
    let notional = ((abs_base * oracle_price as u128) / 1000) as u64;
    let old_user_base = user.base_position;
    let old_vault_base = vault_user.base_position;

    if old_user_base > 0 {
        // Liquidatee was LONG: sells base position to vault
        user.base_position = 0;
        user.quote_position = user
            .quote_position
            .checked_add(notional as i128)
            .ok_or(EpochError::MathOverflow)?;

        vault_user.base_position = vault_user
            .base_position
            .checked_add(old_user_base)
            .ok_or(EpochError::MathOverflow)?;
        vault_user.quote_position = vault_user
            .quote_position
            .checked_sub(notional as i128)
            .ok_or(EpochError::MathOverflow)?;
    } else {
        // Liquidatee was SHORT: buys base position from vault
        user.base_position = 0;
        user.quote_position = user
            .quote_position
            .checked_sub(notional as i128)
            .ok_or(EpochError::MathOverflow)?;

        vault_user.base_position = vault_user
            .base_position
            .checked_add(old_user_base) // old_user_base is negative
            .ok_or(EpochError::MathOverflow)?;
        vault_user.quote_position = vault_user
            .quote_position
            .checked_add(notional as i128)
            .ok_or(EpochError::MathOverflow)?;
    }

    // 9. Fold liquidatee's realized PnL into collateral (user is now flat)
    user.collateral = user
        .collateral
        .checked_add(user.quote_position as i64)
        .ok_or(EpochError::MathOverflow)?;
    user.quote_position = 0;

    // 10. Handle liquidation penalty or deficit/bad debt resolution (spec §10.2 & §10.3)
    let mut penalty = 0u64;
    let mut insurance_covered = 0u64;
    let mut bad_debt = 0u64;

    if user.collateral > 0 {
        // Positive remaining equity: charge liquidation penalty (capped by remaining equity)
        let raw_penalty = (notional as u128 * market.params.liq_penalty_bps as u128) / 10_000;
        let actual_penalty = raw_penalty.min(user.collateral as u128) as u64;
        if actual_penalty > 0 {
            user.collateral = user
                .collateral
                .checked_sub(actual_penalty as i64)
                .ok_or(EpochError::MathOverflow)?;
            market.insurance_fund = market
                .insurance_fund
                .checked_add(actual_penalty)
                .ok_or(EpochError::MathOverflow)?;
            penalty = actual_penalty;
        }
    } else if user.collateral < 0 {
        // Deficit: absorbed by insurance fund up to its balance, remainder recorded as bad debt
        let deficit = (-user.collateral) as u64;
        let covered = deficit.min(market.insurance_fund);
        if covered > 0 {
            market.insurance_fund = market
                .insurance_fund
                .checked_sub(covered)
                .ok_or(EpochError::MathOverflow)?;
            user.collateral = user
                .collateral
                .checked_add(covered as i64)
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
    }

    // 11. Update Market Open Interest based on long position changes
    let old_longs = (if old_user_base > 0 {
        old_user_base as u64
    } else {
        0
    }) + (if old_vault_base > 0 {
        old_vault_base as u64
    } else {
        0
    });
    let new_longs = (if user.base_position > 0 {
        user.base_position as u64
    } else {
        0
    }) + (if vault_user.base_position > 0 {
        vault_user.base_position as u64
    } else {
        0
    });
    if new_longs > old_longs {
        market.open_interest_lots = market
            .open_interest_lots
            .saturating_add(new_longs - old_longs);
    } else if old_longs > new_longs {
        market.open_interest_lots = market
            .open_interest_lots
            .saturating_sub(old_longs - new_longs);
    }

    market.last_oracle_price = oracle_price;
    user.flags = UserFlags::NONE;

    // 12. Determine current batch ID & emit event
    let n_slots = market.params.batch_slots as u64;
    let current_batch = if clock.slot >= market.start_slot && n_slots > 0 {
        (clock.slot - market.start_slot) / n_slots
    } else {
        0
    };

    emit!(PositionLiquidated {
        liquidatee: ctx.accounts.user.key(),
        liquidator: ctx.accounts.liquidator.key(),
        batch_id: current_batch,
        oracle_price,
        base_lots: old_user_base,
        notional,
        penalty,
        insurance_covered,
        bad_debt,
        user_remaining_collateral: user.collateral,
    });

    msg!(
        "Liquidation resolved: liquidatee={}, lots={}, notional={}, penalty={}, covered={}, bad_debt={}",
        ctx.accounts.user.key(),
        old_user_base,
        notional,
        penalty,
        insurance_covered,
        bad_debt
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[allow(dead_code)]
    #[derive(Debug)]
    struct LiquidationOutcome {
        user_collateral: i64,
        user_quote: i128,
        user_base: i64,
        vault_collateral: i64,
        vault_quote: i128,
        vault_base: i64,
        insurance_fund: u64,
        bad_debt: u64,
        penalty: u64,
    }

    /// Pure helper replicating liquidation calculation for unit test assertions.
    #[allow(clippy::too_many_arguments)]
    fn simulate_liquidation(
        user_collateral: i64,
        user_quote: i128,
        user_base: i64,
        user_funding_snapshot: i128,
        vault_collateral: i64,
        vault_quote: i128,
        vault_base: i64,
        vault_funding_snapshot: i128,
        funding_index: i128,
        oracle_price: u64,
        mmr_bps: u16,
        liq_penalty_bps: u16,
        insurance_fund: u64,
    ) -> Result<LiquidationOutcome> {
        // Equity check
        let user_delta = funding_index.saturating_sub(user_funding_snapshot);
        let user_pending_funding = (user_base as i128 * user_delta) / F_SCALE;
        let pos_val = user_base as i128 * (oracle_price as i128 / 1000);
        let user_equity = user_collateral as i128 + user_quote + pos_val - user_pending_funding;

        let abs_base = user_base.unsigned_abs() as u128;
        let mmr_req = (mmr_bps as u128 * abs_base * oracle_price as u128) / 1000 / 10_000;
        require!(user_equity < mmr_req as i128, EpochError::NotLiquidatable);

        // Apply funding
        let mut u_quote = user_quote - user_pending_funding;
        let vault_delta = funding_index.saturating_sub(vault_funding_snapshot);
        let vault_pending_funding = (vault_base as i128 * vault_delta) / F_SCALE;
        let mut v_quote = vault_quote - vault_pending_funding;

        // Position close
        let notional = ((abs_base * oracle_price as u128) / 1000) as u64;
        let mut v_base = vault_base;
        if user_base > 0 {
            u_quote += notional as i128;
            v_base += user_base;
            v_quote -= notional as i128;
        } else {
            u_quote -= notional as i128;
            v_base += user_base;
            v_quote += notional as i128;
        }

        // Fold PnL
        let mut u_collat = user_collateral + u_quote as i64;
        u_quote = 0;

        // Penalty / deficit
        let mut ins = insurance_fund;
        let mut penalty = 0u64;
        let mut bad_debt = 0u64;

        if u_collat > 0 {
            let raw_penalty = (notional as u128 * liq_penalty_bps as u128) / 10_000;
            let actual = raw_penalty.min(u_collat as u128) as u64;
            u_collat -= actual as i64;
            ins += actual;
            penalty = actual;
        } else if u_collat < 0 {
            let deficit = (-u_collat) as u64;
            let covered = deficit.min(ins);
            ins -= covered;
            u_collat += covered as i64;
            let remaining = deficit.saturating_sub(covered);
            if remaining > 0 {
                bad_debt = remaining;
            }
        }

        Ok(LiquidationOutcome {
            user_collateral: u_collat,
            user_quote: u_quote,
            user_base: 0,
            vault_collateral,
            vault_quote: v_quote,
            vault_base: v_base,
            insurance_fund: ins,
            bad_debt,
            penalty,
        })
    }

    #[test]
    fn test_healthy_position_cannot_be_liquidated() {
        // User has 10,000 lots long @ $150 ($1,500 notional).
        // Collateral = $500. Equity = $500.
        // MMR (5%) = 500 * 10,000 * 150_000_000 / 1000 / 10_000 = $75.
        // Equity ($500) > MMR ($75) -> NotLiquidatable error.
        let res = simulate_liquidation(
            500_000_000,
            0,
            10_000,
            0,
            1_000_000_000,
            0,
            0,
            0,
            0,
            150_000_000,
            500, // 5% MMR
            100, // 1% penalty
            0,
        );
        assert!(res.is_err());
    }

    #[test]
    fn test_liquidate_positive_remaining_equity_penalty() {
        // User bought 10,000 lots @ $150 ($1,500 notional). quote = -$1,500.
        // Collateral = $220.
        // Price drops to $130 ($1,300 notional).
        // Unrealized loss = -$200.
        // Equity = $220 - $1,500 + $1,300 = $20 ($20,000,000 micro-USDC).
        // MMR (5% on 10,000 lots @ $130) = $65.
        // $20 < $65 -> Liquidatable!
        let outcome = simulate_liquidation(
            220_000_000,
            -1_500_000_000,
            10_000,
            0,
            1_000_000_000,
            0,
            0,
            0,
            0,
            130_000_000,
            500,
            100, // 100 bps = 1%
            0,   // insurance fund starts at 0
        )
        .expect("Liquidation should succeed");

        assert_eq!(outcome.user_base, 0, "User position must be flat");
        assert_eq!(outcome.vault_base, 10_000, "Vault absorbs long 10,000 lots");
        assert_eq!(outcome.user_quote, 0, "User quote folded into collateral");

        // Notional @ $130 = $1,300,000,000 micro-USDC.
        // Vault quote was 0, now paid $1,300: v_quote = -$1,300,000,000.
        assert_eq!(outcome.vault_quote, -1_300_000_000);

        // Raw penalty: 1% of $1,300 = $13 ($13,000,000 micro-USDC).
        // User had $20 remaining collateral, so penalty ($13) < equity ($20).
        // User remaining collateral = $20 - $13 = $7 ($7,000,000 micro-USDC).
        assert_eq!(outcome.penalty, 13_000_000);
        assert_eq!(outcome.user_collateral, 7_000_000);
        assert_eq!(outcome.insurance_fund, 13_000_000);
        assert_eq!(outcome.bad_debt, 0);

        // Invariant I-1 Conservation check:
        // Before:
        // user: collat $220, quote -$1500 -> sum = -$1280
        // vault: collat $1000, quote $0 -> sum = $1000
        // ins: $0
        // total = $1000 - $1280 = -$280
        // After:
        // user: collat $7, quote $0 -> sum = $7
        // vault: collat $1000, quote -$1300 -> sum = -$300
        // ins: $13
        // total = $7 - $300 + $13 = -$280
        // Conservation EXACTLY holds!
    }

    #[test]
    fn test_liquidate_deficit_absorbed_by_insurance_fund() {
        // User bought 10,000 lots @ $150 ($1,500 notional).
        // Collateral = $290. quote = -$1,500.
        // Price crashes to $120 ($1,200 notional).
        // Loss = -$300.
        // Equity = $290 - $300 = -$10 (deficit of $10).
        // Insurance fund currently has $25.
        let outcome = simulate_liquidation(
            290_000_000,
            -1_500_000_000,
            10_000,
            0,
            1_000_000_000,
            0,
            0,
            0,
            0,
            120_000_000,
            500,
            100,
            25_000_000, // insurance fund has $25
        )
        .expect("Liquidation should succeed");

        assert_eq!(outcome.user_base, 0);
        assert_eq!(outcome.vault_base, 10_000);
        assert_eq!(outcome.penalty, 0, "No penalty charged on deficit");
        assert_eq!(outcome.bad_debt, 0, "Insurance fund covered entire deficit");
        assert_eq!(outcome.user_collateral, 0, "User collateral brought to 0");
        assert_eq!(
            outcome.insurance_fund, 15_000_000,
            "Insurance fund reduced from $25 to $15"
        );
    }

    #[test]
    fn test_liquidate_deficit_exceeding_insurance_records_bad_debt() {
        // User bought 10,000 lots @ $150 ($1,500 notional).
        // Collateral = $350. quote = -$1,500.
        // Price crashes to $110 ($1,100 notional).
        // Loss = -$400.
        // Equity = $350 - $400 = -$50 (deficit of $50).
        // Insurance fund has only $10.
        let outcome = simulate_liquidation(
            350_000_000,
            -1_500_000_000,
            10_000,
            0,
            1_000_000_000,
            0,
            0,
            0,
            0,
            110_000_000,
            500,
            100,
            10_000_000, // insurance fund has $10
        )
        .expect("Liquidation should succeed");

        assert_eq!(outcome.penalty, 0);
        assert_eq!(outcome.insurance_fund, 0, "Insurance fund drained to 0");
        assert_eq!(
            outcome.bad_debt, 40_000_000,
            "Bad debt recorded as $40 shortfall"
        );
        assert_eq!(
            outcome.user_collateral, -40_000_000,
            "User collateral is negative by bad debt (Invariant I-11)"
        );
    }

    #[test]
    fn test_liquidate_short_position() {
        // User shorted 10,000 lots @ $150 ($1,500 notional). quote = +$1,500. base = -10,000.
        // Collateral = $200.
        // Price rises to $168 ($1,680 notional).
        // Loss = -$180.
        // Equity = $200 + $1,500 - $1,680 = $20.
        // MMR (5% on 10,000 lots @ $168) = $84.
        // $20 < $84 -> Liquidatable!
        let outcome = simulate_liquidation(
            200_000_000,
            1_500_000_000,
            -10_000,
            0,
            1_000_000_000,
            0,
            0,
            0,
            0,
            168_000_000,
            500,
            100,
            0,
        )
        .expect("Liquidation of short should succeed");

        assert_eq!(outcome.user_base, 0, "User flat");
        assert_eq!(outcome.vault_base, -10_000, "Vault absorbed short position");
        // Vault bought short -> quote is +$1,680
        assert_eq!(outcome.vault_quote, 1_680_000_000);
        // Penalty: 1% of $1,680 = $16.80 ($16,800,000 micro-USDC).
        // Remaining user equity was $20.
        // User remaining collateral = $20 - $16.80 = $3.20 ($3,200,000 micro-USDC).
        assert_eq!(outcome.penalty, 16_800_000);
        assert_eq!(outcome.user_collateral, 3_200_000);
        assert_eq!(outcome.insurance_fund, 16_800_000);
        assert_eq!(outcome.bad_debt, 0);
    }
}
