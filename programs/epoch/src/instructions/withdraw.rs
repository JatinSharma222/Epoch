use crate::errors::EpochError;
use crate::state::{Market, UserAccount};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct Withdraw<'info> {
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
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"collateral_vault"],
        bump
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, EpochError::ZeroAmount);

    let market_bump = ctx.accounts.market.load()?.bump;
    let mut user = ctx.accounts.user.load_mut()?;
    require_keys_eq!(
        user.owner,
        ctx.accounts.owner.key(),
        EpochError::Unauthorized
    );

    // Withdraw rule 1: No pending/unsettled orders
    require!(
        user.pending_buy_lots == 0 && user.pending_sell_lots == 0 && user.active_orders == 0,
        EpochError::HasPendingOrders
    );

    // Withdraw rule 2 (T-05 flat position rule): Position must be flat (base_position == 0)
    require!(user.base_position == 0, EpochError::PositionNotFlat);

    // Fold realized PnL from quote_position into collateral when flat (spec §7)
    if user.quote_position != 0 {
        user.collateral = user
            .collateral
            .checked_add(user.quote_position as i64)
            .ok_or(EpochError::MathOverflow)?;
        user.quote_position = 0;
    }

    // Check available collateral
    require!(
        user.collateral >= amount as i64,
        EpochError::InsufficientCollateral
    );

    // Deduct collateral
    user.collateral = user
        .collateral
        .checked_sub(amount as i64)
        .ok_or(EpochError::MathOverflow)?;

    // Transfer mock USDC from collateral vault to user's token account
    // Collateral vault authority is the market PDA
    let seeds = &[b"market".as_ref(), &[market_bump]];
    let signer = &[&seeds[..]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.collateral_vault.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.market.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer,
    );
    token::transfer(cpi_ctx, amount)?;

    msg!(
        "Withdraw: user={}, amount={}, remaining_collateral={}",
        user.owner,
        amount,
        user.collateral
    );

    Ok(())
}
