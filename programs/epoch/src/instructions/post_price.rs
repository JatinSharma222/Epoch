use anchor_lang::prelude::*;
use crate::errors::EpochError;
use crate::state::Market;

/// On-chain Authority oracle price update account layout.
#[account]
#[derive(Default)]
pub struct AuthorityPriceUpdate {
    pub market: Pubkey,
    pub price: u64,
    pub conf: u64,
    pub publish_time: i64,
    pub publish_slot: u64,
    pub posted_slot: u64,
    pub _reserved: [u8; 32],
}

impl AuthorityPriceUpdate {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 8 + 8 + 8 + 32;
    pub const SEED: &'static [u8] = b"oracle";
}

#[derive(Accounts)]
pub struct PostPrice<'info> {
    #[account(mut)]
    pub market: AccountLoader<'info, Market>,

    #[account(
        init_if_needed,
        payer = authority,
        space = AuthorityPriceUpdate::LEN,
        seeds = [AuthorityPriceUpdate::SEED, market.key().as_ref()],
        bump,
    )]
    pub price_update: Account<'info, AuthorityPriceUpdate>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_post_price(
    ctx: Context<PostPrice>,
    price: u64,
    conf: u64,
    publish_time: i64,
) -> Result<()> {
    let clock = Clock::get()?;
    let mut market = ctx.accounts.market.load_mut()?;

    // Authority check against market.admin
    require_keys_eq!(
        ctx.accounts.authority.key(),
        market.admin,
        EpochError::Unauthorized
    );

    let oracle = &mut ctx.accounts.price_update;

    // 1. Positive price
    require!(price > 0, EpochError::InvalidOraclePrice);

    // 2. Reject zero or negative confidence
    require!(conf > 0, EpochError::OracleConfidenceTooLow);

    // 3. Reject updates older than previous publish_slot or publish_time
    if oracle.publish_slot > 0 {
        require!(
            clock.slot > oracle.publish_slot,
            EpochError::OracleStale
        );
        require!(
            publish_time >= oracle.publish_time,
            EpochError::OracleStale
        );

        // 4. Per-update maximum move (100 bps = 1.00%),
        // UNLESS previous update is older than outage threshold (50 slots)
        let slots_elapsed = clock.slot.saturating_sub(oracle.publish_slot);
        let outage_threshold_slots = 50u64;
        if slots_elapsed <= outage_threshold_slots && oracle.price > 0 {
            let max_move_bps = 100u128; // 100 bps = 1.00%
            let delta = (price as i128 - oracle.price as i128).unsigned_abs();
            let move_bps = (delta * 10_000) / oracle.price as u128;
            require!(
                move_bps <= max_move_bps,
                EpochError::OraclePriceJumpTooLarge
            );
        }
    }

    // 5. Store update
    oracle.market = ctx.accounts.market.key();
    oracle.price = price;
    oracle.conf = conf;
    oracle.publish_time = publish_time;
    oracle.publish_slot = clock.slot;
    oracle.posted_slot = clock.slot;

    // 6. Update market cached oracle state
    market.last_oracle_price = price;
    market.last_oracle_slot = clock.slot;

    Ok(())
}
