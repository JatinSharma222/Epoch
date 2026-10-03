use crate::errors::EpochError;
use crate::state::{Market, UserAccount};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct FundVault<'info> {
    #[account(
        seeds = [b"market"],
        bump = market.load()?.bump,
    )]
    pub market: AccountLoader<'info, Market>,

    /// CHECK: PDA derived with seed [b"vault"].
    #[account(
        seeds = [b"vault"],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"user", vault_authority.key().as_ref()],
        bump
    )]
    pub vault_user: AccountLoader<'info, UserAccount>,

    #[account(
        mut,
        token::authority = funder,
    )]
    pub funder_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"collateral_vault"],
        bump
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    pub funder: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_fund_vault(ctx: Context<FundVault>, amount: u64) -> Result<()> {
    require!(amount > 0, EpochError::ZeroAmount);
    require!(amount <= i64::MAX as u64, EpochError::MathOverflow);

    let cpi_accounts = Transfer {
        from: ctx.accounts.funder_token_account.to_account_info(),
        to: ctx.accounts.collateral_vault.to_account_info(),
        authority: ctx.accounts.funder.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    let mut vault_user = ctx.accounts.vault_user.load_mut()?;
    vault_user.collateral = vault_user
        .collateral
        .checked_add(amount as i64)
        .ok_or(EpochError::MathOverflow)?;

    if vault_user.base_position == 0 {
        vault_user.funding_snapshot = ctx.accounts.market.load()?.funding_index;
    }

    msg!(
        "FundVault: amount={}, total_vault_collateral={}",
        amount,
        vault_user.collateral
    );
    Ok(())
}
