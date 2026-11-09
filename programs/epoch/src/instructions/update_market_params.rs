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
    let params: crate::state::MarketParams = new_params.into();
    params.validate()?;

    let mut market = ctx.accounts.market.load_mut()?;

    // C-2: Structural market parameters are immutable once initialized
    require_eq!(
        params.batch_slots,
        market.params.batch_slots,
        EpochError::InvalidMarketParameter
    );
    require_eq!(
        params.base_lot,
        market.params.base_lot,
        EpochError::InvalidMarketParameter
    );
    require_eq!(
        params.k_ticks,
        market.params.k_ticks,
        EpochError::InvalidMarketParameter
    );
    require_eq!(
        params.price_tick,
        market.params.price_tick,
        EpochError::InvalidMarketParameter
    );

    let old_params = market.params;
    market.params = params;

    emit!(crate::events::MarketParamsUpdated {
        market: ctx.accounts.market.key(),
        admin: ctx.accounts.admin.key(),
        slot: Clock::get()?.slot,
        old_params,
        new_params: params,
    });

    Ok(())
}
