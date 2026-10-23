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
    pub anchor_price: u64,
    pub anchor_slot: u64,
    pub _reserved: [u8; 16],
}

impl AuthorityPriceUpdate {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 16;
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

    // Authority check against market.oracle_authority (strictly distinct from market.admin)
    require_keys_eq!(
        ctx.accounts.authority.key(),
        market.oracle_authority,
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

        // 4. Dual-layer price movement bounds:
        // Layer A: Tighter per-update limit (typical 2-slot move is ~2 bps)
        // - Base move: 15 bps (0.15%) for normal 2-slot cadence
        // - Pause allowance: +1 bps per elapsed slot beyond 2 slots
        // - Single-update hard cap: 100 bps (1.00%)
        let slots_elapsed = clock.slot.saturating_sub(oracle.publish_slot);
        if oracle.price > 0 {
            let base_move_bps = 15u128;
            let per_slot_allowance_bps = 1u128;
            let single_update_cap_bps = 100u128;

            let additional_allowance = (slots_elapsed.saturating_sub(2) as u128) * per_slot_allowance_bps;
            let allowed_single_move_bps = (base_move_bps + additional_allowance).min(single_update_cap_bps);

            let delta = (price as i128 - oracle.price as i128).unsigned_abs();
            let move_bps = (delta * 10_000) / oracle.price as u128;
            require!(
                move_bps <= allowed_single_move_bps,
                EpochError::OraclePriceJumpTooLarge
            );

            // Layer B: Cumulative Anchor Bound (slower reference price updated at 75-slot / ~30s cadence)
            // - Maximum deviation from anchor: 30 bps (0.30%) per window
            // - Enforces a maximum cumulative drift rate of 60 bps per minute (300 bps / 5 min)
            if oracle.anchor_price == 0 {
                oracle.anchor_price = oracle.price;
                oracle.anchor_slot = clock.slot;
            } else if clock.slot.saturating_sub(oracle.anchor_slot) >= 75 {
                // Window expired: anchor advances to previous window's closing price
                oracle.anchor_price = oracle.price;
                oracle.anchor_slot = clock.slot;
            }

            let anchor_delta = (price as i128 - oracle.anchor_price as i128).unsigned_abs();
            let anchor_move_bps = (anchor_delta * 10_000) / oracle.anchor_price as u128;
            require!(
                anchor_move_bps <= 30u128,
                EpochError::OraclePriceJumpTooLarge
            );
        }
    } else {
        // Initial price bootstrap
        oracle.anchor_price = price;
        oracle.anchor_slot = clock.slot;
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
