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
    pub last_anchor_update_slot: u64,
    pub posted_slot: u64,
    pub anchor_price: u64,
    pub velocity_accumulator_bps: u64,
    pub velocity_window_start_slot: u64,
    pub velocity_window_start_time: i64,
    pub _reserved: [u8; 16],
}

impl AuthorityPriceUpdate {
    pub const LEN: usize = 8 + 32 + 8 * 10 + 16;
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

/// Continuous EMA update using 64-bit integer fixed-point math with scale factor 10,000.
/// Deterministic fixed-point arithmetic with zero integer truncation bias (+ 5,000 for rounding to nearest).
pub fn compute_continuous_ema(raw_price: u64, prev_ema: u64, slots_elapsed: u64) -> u64 {
    if prev_ema == 0 {
        return raw_price;
    }
    // Smoothing factor alpha calibrated to an effective window of 75 slots (~30 seconds)
    let alpha_bps = if slots_elapsed >= 75 {
        10_000u128
    } else {
        (slots_elapsed as u128 * 10_000) / 75
    };
    let raw = raw_price as u128;
    let prev = prev_ema as u128;
    let one_minus_alpha = 10_000u128 - alpha_bps;

    let updated = (alpha_bps * raw + one_minus_alpha * prev + 5_000) / 10_000;
    updated as u64
}

/// Core production instruction logic for processing an oracle price update with
/// continuous EMA smoothing, three-tier rate limiting, velocity governor, and price clamping.
pub fn process_price_update(
    oracle: &mut AuthorityPriceUpdate,
    price: u64,
    conf: u64,
    publish_time: i64,
    current_slot: u64,
) -> Result<u64> {
    // 1. Positive price
    require!(price > 0, EpochError::InvalidOraclePrice);

    // 2. Reject zero or negative confidence
    require!(conf > 0, EpochError::OracleConfidenceTooLow);

    // 3. Monotonic slot and timestamp validation
    if oracle.publish_slot > 0 {
        require!(
            current_slot > oracle.publish_slot,
            EpochError::OracleStale
        );
        require!(
            publish_time >= oracle.publish_time,
            EpochError::OracleStale
        );
    }

    let final_price = if oracle.publish_slot > 0 {
        let slots_elapsed = current_slot.saturating_sub(oracle.publish_slot);
        let time_elapsed = publish_time.saturating_sub(oracle.velocity_window_start_time);
        let window_slots = current_slot.saturating_sub(oracle.velocity_window_start_slot);

        // Bootstrap baselines if necessary
        if oracle.anchor_price == 0 {
            oracle.anchor_price = oracle.price;
            oracle.last_anchor_update_slot = oracle.publish_slot;
        }
        if oracle.velocity_window_start_slot == 0 {
            oracle.velocity_window_start_slot = oracle.publish_slot;
            oracle.velocity_window_start_time = oracle.publish_time;
        }

        // Rolling velocity window expiration:
        // Precise definition: 60 seconds wall-clock OR 150 slots (does not assume 400ms per slot!)
        if window_slots >= 150 || time_elapsed >= 60 {
            oracle.velocity_accumulator_bps = 0;
            oracle.velocity_window_start_slot = current_slot;
            oracle.velocity_window_start_time = publish_time;
        }

        let anchor_slots = current_slot.saturating_sub(oracle.last_anchor_update_slot);

        // Tier 1: Per-update bound: 15 bps base + 1 bps per slot beyond 2 slots (capped at 100 bps)
        let base_move_bps = 15u64;
        let per_slot_allowance = slots_elapsed.saturating_sub(2);
        let allowed_single_move_bps = (base_move_bps + per_slot_allowance).min(100);

        // Tier 2: Slow continuous EMA anchor deviation: <= 30 bps from anchor
        let max_anchor_dev_bps = 30u64;

        // Tier 3: Velocity accumulator: <= 60 bps cumulative movement per rolling window
        let remaining_velocity_bps = 60u64.saturating_sub(oracle.velocity_accumulator_bps);

        // Allowed single-step move is constrained by Tier 1 single-update limit and remaining Tier 3 budget
        let allowed_move_bps = allowed_single_move_bps.min(remaining_velocity_bps);

        let max_from_last = oracle.price + (oracle.price * allowed_move_bps) / 10_000;
        let min_from_last = oracle.price.saturating_sub((oracle.price * allowed_move_bps) / 10_000);

        let max_from_anchor = oracle.anchor_price + (oracle.anchor_price * max_anchor_dev_bps) / 10_000;
        let min_from_anchor = oracle.anchor_price.saturating_sub((oracle.anchor_price * max_anchor_dev_bps) / 10_000);

        let max_allowable_price = max_from_last.min(max_from_anchor);
        let min_allowable_price = min_from_last.max(min_from_anchor);

        // Clamping Rule: Clamps raw price rather than rejecting, preventing oracle stalls during legitimate jumps
        let clamped = price.min(max_allowable_price).max(min_allowable_price);

        // Calculate actual move bps
        let actual_delta = (clamped as i64 - oracle.price as i64).unsigned_abs();
        let actual_move_bps = if oracle.price > 0 {
            (actual_delta * 10_000) / oracle.price
        } else {
            0
        };

        // Update velocity accumulator
        oracle.velocity_accumulator_bps = oracle.velocity_accumulator_bps.saturating_add(actual_move_bps);

        // Update continuous EMA anchor
        oracle.anchor_price = compute_continuous_ema(clamped, oracle.anchor_price, anchor_slots);
        oracle.last_anchor_update_slot = current_slot;

        clamped
    } else {
        // Initial price bootstrap
        oracle.anchor_price = price;
        oracle.last_anchor_update_slot = current_slot;
        oracle.velocity_accumulator_bps = 0;
        oracle.velocity_window_start_slot = current_slot;
        oracle.velocity_window_start_time = publish_time;
        price
    };

    oracle.price = final_price;
    oracle.conf = conf;
    oracle.publish_time = publish_time;
    oracle.publish_slot = current_slot;
    oracle.posted_slot = current_slot;

    Ok(final_price)
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

    let final_price = process_price_update(
        &mut ctx.accounts.price_update,
        price,
        conf,
        publish_time,
        clock.slot,
    )?;

    ctx.accounts.price_update.market = ctx.accounts.market.key();

    // Update market cached oracle state
    market.last_oracle_price = final_price;
    market.last_oracle_slot = clock.slot;

    Ok(())
}
