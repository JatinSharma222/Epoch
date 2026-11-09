use crate::errors::EpochError;
use crate::state::{Market, UserAccount};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        seeds = [b"market"],
        bump = market.load()?.bump
    )]
    pub market: AccountLoader<'info, Market>,

    #[account(
        mut,
        seeds = [b"user", owner.key().as_ref()],
        bump
    )]
    pub user: AccountLoader<'info, UserAccount>,

    #[account(
        mut,
        token::authority = owner,
        token::mint = collateral_vault.mint,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"collateral_vault"],
        bump,
        token::authority = market,
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, EpochError::ZeroAmount);
    let deposit_amount = i64::try_from(amount).map_err(|_| EpochError::MathOverflow)?;

    let mut user = ctx.accounts.user.load_mut()?;
    require_keys_eq!(
        user.owner,
        ctx.accounts.owner.key(),
        EpochError::Unauthorized
    );

    // Transfer mock USDC from user token account into the protocol's collateral vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.collateral_vault.to_account_info(),
        authority: ctx.accounts.owner.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    // Credit collateral in the user account ledger
    user.collateral = user
        .collateral
        .checked_add(deposit_amount)
        .ok_or(EpochError::MathOverflow)?;

    let market = ctx.accounts.market.load()?;
    if user.base_position == 0 {
        user.funding_snapshot = market.funding_index;
    }

    // Deposit curing (H-4 §5.6): If account was quarantined in LIQUIDATING state,
    // verify whether this deposit cures equity back above maintenance margin.
    apply_deposit_curing(&mut user, &market);

    msg!(
        "Deposit: user={}, amount={}, total_collateral={}",
        user.owner,
        amount,
        user.collateral
    );

    Ok(())
}

/// Applies deposit curing (spec H-4 §5.6):
/// If an account was quarantined under liquidation lock (LIQUIDATING / LIQUIDATION_LOCKED),
/// check if the new collateral balance restores equity >= MMR at current oracle price.
/// If so, clear the quarantine flags.
pub fn apply_deposit_curing(
    user: &mut UserAccount,
    market: &Market,
) {
    if (user.flags & crate::state::UserFlags::LIQUIDATING) != 0 {
        if user.base_position == 0 {
            user.flags &= !crate::state::UserFlags::LIQUIDATING;
        } else {
            let oracle_price = market.last_oracle_price;
            if oracle_price > 0 {
                let delta = market.funding_index.saturating_sub(user.funding_snapshot);
                let pending_funding = (user.base_position as i128 * delta) / crate::state::constants::F_SCALE;
                let pos_val = (user.base_position as i128 * oracle_price as i128) / 1000;
                let equity = user.collateral as i128 + user.quote_position + pos_val - pending_funding;
                let abs_base = user.base_position.unsigned_abs() as u128;
                let mmr_req = (market.params.mmr_bps as u128 * abs_base * oracle_price as u128) / 1000 / 10_000;
                if equity >= mmr_req as i128 {
                    user.flags &= !crate::state::UserFlags::LIQUIDATING;
                    msg!("Deposit cured account: LIQUIDATING quarantine cleared for user {}", user.owner);
                }
            }
        }
    }
}
