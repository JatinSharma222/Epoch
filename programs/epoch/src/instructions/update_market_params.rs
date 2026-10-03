use crate::errors::EpochError;
use crate::instructions::initialize_market::InitializeMarketArgs;
use crate::state::Market;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateMarketParams<'info> {
    #[account(
        mut,
        seeds = [b"market"],
        bump = market.load()?.bump,
        has_one = admin @ EpochError::Unauthorized,
    )]
    pub market: AccountLoader<'info, Market>,

    pub admin: Signer<'info>,
}

pub fn handle_update_market_params(
    ctx: Context<UpdateMarketParams>,
    new_params: InitializeMarketArgs,
) -> Result<()> {
    require!(new_params.batch_slots > 0, EpochError::MathOverflow);
    require!(
        new_params.k_ticks > 0 && new_params.k_ticks % 2 == 1,
        EpochError::InvalidTick
    );

    let mut market = ctx.accounts.market.load_mut()?;
    market.params = new_params.into();
    Ok(())
}
