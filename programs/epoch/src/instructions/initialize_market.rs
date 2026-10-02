use crate::state::{Market, MarketParams};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

/// Instruction arguments for initializing market parameters.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct InitializeMarketArgs {
    pub base_lot: u64,
    pub price_tick: u64,
    pub min_order_lots: u64,
    pub min_order_notional: u64,
    pub funding_period_slots: u32,
    pub batch_slots: u16,
    pub lookahead: u16,
    pub k_ticks: u16,
    pub tick_bps: u16,
    pub imr_bps: u16,
    pub mmr_bps: u16,
    pub fee_bps: u16,
    pub liq_penalty_bps: u16,
    pub max_oracle_age_secs: u16,
    pub max_conf_bps: u16,
    pub max_clear_delay_slots: u16,
    pub max_orders_per_batch: u16,
    pub funding_cap_bps: u16,
}

impl From<InitializeMarketArgs> for MarketParams {
    fn from(args: InitializeMarketArgs) -> Self {
        Self {
            base_lot: args.base_lot,
            price_tick: args.price_tick,
            min_order_lots: args.min_order_lots,
            min_order_notional: args.min_order_notional,
            funding_period_slots: args.funding_period_slots,
            batch_slots: args.batch_slots,
            lookahead: args.lookahead,
            k_ticks: args.k_ticks,
            tick_bps: args.tick_bps,
            imr_bps: args.imr_bps,
            mmr_bps: args.mmr_bps,
            fee_bps: args.fee_bps,
            liq_penalty_bps: args.liq_penalty_bps,
            max_oracle_age_secs: args.max_oracle_age_secs,
            max_conf_bps: args.max_conf_bps,
            max_clear_delay_slots: args.max_clear_delay_slots,
            max_orders_per_batch: args.max_orders_per_batch,
            funding_cap_bps: args.funding_cap_bps,
            _pad0: [0; 2],
        }
    }
}

#[derive(Accounts)]
pub struct InitializeMarket<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + std::mem::size_of::<Market>(),
        seeds = [b"market"],
        bump
    )]
    pub market: AccountLoader<'info, Market>,

    /// PDA that serves as the mint authority for the mock USDC token.
    /// CHECK: PDA derived with seed [b"mint_authority"].
    #[account(
        seeds = [b"mint_authority"],
        bump
    )]
    pub mint_authority: UncheckedAccount<'info>,

    /// Mock USDC mint with 6 decimals (1 USDC = 1,000,000 micro-USDC).
    #[account(
        init,
        payer = admin,
        mint::decimals = 6,
        mint::authority = mint_authority,
        seeds = [b"quote_mint"],
        bump
    )]
    pub quote_mint: Account<'info, Mint>,

    /// PDA SPL token account holding all user collateral. Authority is the market PDA.
    #[account(
        init,
        payer = admin,
        token::mint = quote_mint,
        token::authority = market,
        seeds = [b"collateral_vault"],
        bump
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_initialize_market(
    ctx: Context<InitializeMarket>,
    args: InitializeMarketArgs,
    oracle_feed_id: [u8; 32],
) -> Result<()> {
    let mut market = ctx.accounts.market.load_init()?;
    let clock = Clock::get()?;

    market.admin = ctx.accounts.admin.key();
    market.quote_mint = ctx.accounts.quote_mint.key();
    market.collateral_vault = ctx.accounts.collateral_vault.key();
    market.oracle_feed_id = oracle_feed_id;
    market.start_slot = clock.slot;
    market.params = args.into();
    market.next_batch_to_clear = 0;
    market.funding_index = 0;
    market.last_oracle_price = 0;
    market.open_interest_lots = 0;
    market.fee_pool = 0;
    market.insurance_fund = 0;
    market.vault_params = crate::state::VaultParams::default();
    market.bump = ctx.bumps.market;

    msg!(
        "Epoch Market initialized: admin={}, start_slot={}",
        market.admin,
        market.start_slot
    );

    Ok(())
}
