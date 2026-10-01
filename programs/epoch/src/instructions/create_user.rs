use crate::state::{UserAccount, UserFlags};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CreateUser<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + std::mem::size_of::<UserAccount>(),
        seeds = [b"user", owner.key().as_ref()],
        bump
    )]
    pub user: AccountLoader<'info, UserAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_user(ctx: Context<CreateUser>) -> Result<()> {
    let mut user = ctx.accounts.user.load_init()?;

    user.owner = ctx.accounts.owner.key();
    user.collateral = 0;
    user.base_position = 0;
    user.quote_position = 0;
    user.funding_snapshot = 0;
    user.pending_buy_lots = 0;
    user.pending_sell_lots = 0;
    user.active_orders = 0;
    user.flags = UserFlags::NONE;

    msg!("Epoch UserAccount created for owner: {}", user.owner);
    Ok(())
}
