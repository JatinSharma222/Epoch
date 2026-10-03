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

pub fn handle_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, EpochError::ZeroAmount);
    require!(amount <= i64::MAX as u64, EpochError::MathOverflow);

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
        .checked_add(amount as i64)
        .ok_or(EpochError::MathOverflow)?;

    if user.base_position == 0 {
        user.funding_snapshot = ctx.accounts.market.load()?.funding_index;
    }

    msg!(
        "Deposit: user={}, amount={}, total_collateral={}",
        user.owner,
        amount,
        user.collateral
    );

    Ok(())
}
