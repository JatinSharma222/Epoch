use crate::state::{Market, UserAccount, UserFlags};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitializeVaultUser<'info> {
    #[account(
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

    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<UserAccount>(),
        seeds = [b"user", vault_authority.key().as_ref()],
        bump
    )]
    pub vault_user: AccountLoader<'info, UserAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_vault_user(ctx: Context<InitializeVaultUser>) -> Result<()> {
    let mut user = ctx.accounts.vault_user.load_init()?;

    user.owner = ctx.accounts.vault_authority.key();
    user.collateral = 0;
    user.base_position = 0;
    user.quote_position = 0;
    user.funding_snapshot = ctx.accounts.market.load()?.funding_index;
    user.pending_buy_lots = 0;
    user.pending_sell_lots = 0;
    user.active_orders = 0;
    user.flags = UserFlags::NONE;

    msg!("Epoch Vault UserAccount initialized: owner={}", user.owner);
    Ok(())
}
