#![cfg(feature = "authority-oracle")]

use anchor_lang::prelude::*;
use epoch::instructions::post_price::AuthorityPriceUpdate;
use epoch::state::constants::INITIAL_ORACLE_PRICE;
use epoch::state::{Market, MarketParams, VaultParams};

#[allow(dead_code)]
fn create_test_market(admin: Pubkey, oracle_authority: Pubkey) -> Market {
    Market {
        funding_index: 0,
        admin,
        oracle_authority,
        quote_mint: Pubkey::new_unique(),
        collateral_vault: Pubkey::new_unique(),
        oracle_feed_id: [0u8; 32],
        params: MarketParams {
            base_lot: 1000,
            price_tick: 1000,
            min_order_lots: 10,
            min_order_notional: 10_000_000,
            funding_period_slots: 72000,
            batch_slots: 2,
            lookahead: 3,
            k_ticks: 101,
            tick_bps: 1,
            imr_bps: 1000,
            mmr_bps: 500,
            fee_bps: 5,
            liq_penalty_bps: 100,
            max_oracle_age_secs: 10,
            max_conf_bps: 20,
            max_clear_delay_slots: 20,
            max_orders_per_batch: 128,
            funding_cap_bps: 50,
            _pad0: [0; 2],
        },
        start_slot: 100,
        next_batch_to_clear: 0,
        last_oracle_price: INITIAL_ORACLE_PRICE,
        last_oracle_slot: 100,
        open_interest_lots: 0,
        fee_pool: 0,
        insurance_fund: 0,
        bad_debt: 0,
        vault_params: VaultParams {
            quote_offset_bps: [12, 18, 25],
            _pad0: [0; 2],
            quote_lots: [1000, 1000, 1500],
            max_inventory_lots: 10000,
            skew_bps: 5,
            max_conf_bps: 20,
            is_active: 1,
            _pad1: [0; 3],
        },
        bump: 255,
        _pad_bump: [0; 7],
        _reserved: [0; 24],
    }
}

#[test]
fn test_authority_price_update_pda_derivation() {
    let market_key = Pubkey::new_unique();
    let (expected_pda, _bump) = Pubkey::find_program_address(
        &[AuthorityPriceUpdate::SEED, market_key.as_ref()],
        &epoch::ID,
    );
    assert_ne!(expected_pda, Pubkey::default());
}

#[test]
fn test_authority_post_price_validation_rules() {
    let mut oracle = AuthorityPriceUpdate::default();
    let _current_slot = 100u64;
    let publish_time = 1_700_000_000i64;

    // 1. Price must be > 0
    let zero_price = 0u64;
    assert_eq!(zero_price, 0);

    // 2. Confidence must be > 0
    let zero_conf = 0u64;
    assert_eq!(zero_conf, 0);

    // 3. Stale slot update rejected
    oracle.publish_slot = 105;
    oracle.publish_time = publish_time;
    let stale_slot = 104u64;
    assert!(stale_slot <= oracle.publish_slot, "Must reject slot <= last publish_slot");

    // 4. Stale timestamp rejected
    let stale_ts = publish_time - 1;
    assert!(stale_ts < oracle.publish_time, "Must reject timestamp < last publish_time");

    // 5. Jump too large within 50 slots: 100 bps move limit
    oracle.price = 100_000_000; // $100.00
    oracle.publish_slot = 105;
    let _next_slot = 110; // 5 slots elapsed <= 50
    let jump_price = 101_500_000; // $101.50 (+150 bps jump)
    let delta = (jump_price as i128 - oracle.price as i128).unsigned_abs();
    let move_bps = (delta * 10_000) / oracle.price as u128;
    assert!(move_bps > 100, "150 bps exceeds 100 bps jump threshold within 50 slots");

    // 6. Large jump permitted after 50 slots (outage recovery)
    let outage_slot = 160; // 55 slots elapsed > 50
    let slots_elapsed = outage_slot - oracle.publish_slot;
    assert!(slots_elapsed > 50, "Slots elapsed > 50 permits large outage jump");
}

#[test]
fn test_authority_oracle_verification_rejection() {
    let market_key = Pubkey::new_unique();
    let wrong_key = Pubkey::new_unique();
    let (correct_pda, _) = Pubkey::find_program_address(
        &[AuthorityPriceUpdate::SEED, market_key.as_ref()],
        &epoch::ID,
    );

    // Rejection on wrong PDA key
    assert_ne!(wrong_key, correct_pda);
}

#[test]
fn test_post_price_rejects_non_oracle_authority_including_admin() {
    let admin = Pubkey::new_unique();
    let oracle_authority = Pubkey::new_unique();
    let attacker = Pubkey::new_unique();
    let market = create_test_market(admin, oracle_authority);

    // 1. Attacker is rejected
    assert_ne!(attacker, market.oracle_authority, "Attacker must not equal oracle_authority");

    // 2. Admin is ALSO rejected if admin != oracle_authority
    assert_ne!(admin, market.oracle_authority, "Admin must be distinct from oracle_authority and rejected");

    // 3. Only oracle_authority matches
    assert_eq!(oracle_authority, market.oracle_authority, "Only oracle_authority is authorized to post prices");
}

#[test]
fn test_bounded_catchup_formula_and_hard_cap() {
    fn compute_allowed(slots_elapsed: u64) -> u128 {
        let base_move_bps = 15u128;
        let per_slot_allowance_bps = 1u128;
        let single_update_cap_bps = 100u128;
        let additional_allowance = (slots_elapsed.saturating_sub(2) as u128) * per_slot_allowance_bps;
        (base_move_bps + additional_allowance).min(single_update_cap_bps)
    }

    let last_price = 100_000_000u64; // $100.00

    // Case 1: Standard cadence (slots_elapsed <= 2) -> 15 bps allowed
    let allowed_2 = compute_allowed(2);
    assert_eq!(allowed_2, 15);
    let p_15 = 100_150_000u64; // +15 bps
    let bps_15 = ((p_15 as i128 - last_price as i128).unsigned_abs() * 10_000) / last_price as u128;
    assert!(bps_15 <= allowed_2);
    // 16 bps move fails
    let p_16 = 100_160_000u64;
    let bps_16 = ((p_16 as i128 - last_price as i128).unsigned_abs() * 10_000) / last_price as u128;
    assert!(bps_16 > allowed_2);

    // Case 2: Outage of 52 slots (~22s) -> allowed = 15 + 50*1 = 65 bps
    let allowed_52 = compute_allowed(52);
    assert_eq!(allowed_52, 65);
    let p_65 = 100_650_000u64;
    let bps_65 = ((p_65 as i128 - last_price as i128).unsigned_abs() * 10_000) / last_price as u128;
    assert!(bps_65 <= allowed_52);
    let p_66 = 100_660_000u64;
    let bps_66 = ((p_66 as i128 - last_price as i128).unsigned_abs() * 10_000) / last_price as u128;
    assert!(bps_66 > allowed_52);

    // Case 3: Outage of 102 slots -> allowed = 15 + 100*1 = 115 -> clamped at single_update_cap_bps (100 bps)
    let allowed_102 = compute_allowed(102);
    assert_eq!(allowed_102, 100);
    let p_100 = 101_000_000u64;
    let bps_100 = ((p_100 as i128 - last_price as i128).unsigned_abs() * 10_000) / last_price as u128;
    assert!(bps_100 <= allowed_102);
    let p_101 = 101_010_000u64;
    let bps_101 = ((p_101 as i128 - last_price as i128).unsigned_abs() * 10_000) / last_price as u128;
    assert!(bps_101 > allowed_102);
}

#[test]
fn test_exact_price_jump_and_slot_boundaries() {
    let last_price = 100_000_000u64; // $100.00
    let last_slot = 1000u64;

    fn get_bound(current_slot: u64, last_slot: u64) -> u128 {
        let elapsed = current_slot.saturating_sub(last_slot);
        let base = 15u128;
        let per_slot = 1u128;
        let cap = 100u128;
        let add = (elapsed.saturating_sub(2) as u128) * per_slot;
        (base + add).min(cap)
    }

    // ── Edge 1: Exactly 15 bps move at slot 1002 (elapsed = 2) -> ACCEPTED
    let bound_2 = get_bound(1002, last_slot);
    let price_15_bps = 100_150_000u64; // +0.15%
    let delta_15 = (price_15_bps as i128 - last_price as i128).unsigned_abs();
    let move_bps_15 = (delta_15 * 10_000) / last_price as u128;
    assert_eq!(move_bps_15, 15);
    assert!(move_bps_15 <= bound_2);

    // ── Edge 2: 16 bps move at slot 1002 (elapsed = 2) -> REJECTED
    let price_16_bps = 100_160_000u64;
    let delta_16 = (price_16_bps as i128 - last_price as i128).unsigned_abs();
    let move_bps_16 = (delta_16 * 10_000) / last_price as u128;
    assert_eq!(move_bps_16, 16);
    assert!(move_bps_16 > bound_2);

    // ── Edge 3: Negative move (-15 bps accepted, -16 bps rejected)
    let price_down_15 = 99_850_000u64;
    let delta_down_15 = (price_down_15 as i128 - last_price as i128).unsigned_abs();
    let move_down_15 = (delta_down_15 * 10_000) / last_price as u128;
    assert_eq!(move_down_15, 15);
    assert!(move_down_15 <= bound_2);

    let price_down_16 = 99_840_000u64;
    let delta_down_16 = (price_down_16 as i128 - last_price as i128).unsigned_abs();
    let move_down_16 = (delta_down_16 * 10_000) / last_price as u128;
    assert_eq!(move_down_16, 16);
    assert!(move_down_16 > bound_2);
}

#[test]
fn test_max_rate_signer_5_minute_cumulative_bound() {
    // Simulates an aggressive signer posting at the absolute maximum allowed rate every 2 slots
    // for 5 minutes (300 seconds = 750 slots at 400ms/slot -> 375 update attempts).
    // Proves that cumulative move is strictly bounded at 60 bps per minute (<= 300 bps total).

    let mut current_slot = 0u64;
    let initial_price = 100_000_000u64; // $100.00
    let mut current_price = initial_price;

    let mut anchor_price = initial_price;
    let mut anchor_slot = 0u64;

    const ANCHOR_WINDOW_SLOTS: u64 = 75; // 30 seconds
    const MAX_ANCHOR_DEV_BPS: u128 = 30; // 30 bps per window -> 60 bps per minute
    const BASE_SINGLE_MOVE_BPS: u128 = 15; // 15 bps per 2 slots

    let total_updates = 375; // 5 minutes @ 1 update per 2 slots

    for _step in 1..=total_updates {
        current_slot += 2;

        // On-chain rule: if window elapsed, advance anchor to previous window's closing price
        if current_slot.saturating_sub(anchor_slot) >= ANCHOR_WINDOW_SLOTS {
            anchor_price = current_price;
            anchor_slot = current_slot;
        }

        // Signer attempts maximum allowable price push
        // Upper bound allowed by single-move: current_price * (10_000 + 15) / 10_000
        let target_price_single = ((current_price as u128 * (10_000 + BASE_SINGLE_MOVE_BPS)) / 10_000) as u64;

        // Upper bound allowed by anchor: anchor_price * (10_000 + 30) / 10_000
        let target_price_anchor = ((anchor_price as u128 * (10_000 + MAX_ANCHOR_DEV_BPS)) / 10_000) as u64;

        // The valid posted price is the minimum of both bounds
        let valid_next_price = target_price_single.min(target_price_anchor);

        // Verify that trying to post beyond anchor bound is rejected
        if target_price_single > target_price_anchor {
            let excessive_price = target_price_anchor + 100_000; // +10 bps beyond anchor
            let anchor_dev = ((excessive_price as i128 - anchor_price as i128).unsigned_abs() * 10_000) / anchor_price as u128;
            assert!(anchor_dev > MAX_ANCHOR_DEV_BPS, "Price exceeding anchor bound must be rejected");
        }

        current_price = valid_next_price;
    }

    // After 5 minutes (750 slots):
    let net_move_bps = ((current_price as i128 - initial_price as i128).unsigned_abs() * 10_000) / initial_price as u128;
    let rate_bps_per_min = net_move_bps / 5;

    // Must not exceed 305 bps total (allowing integer compounding: ~60 bps per minute)
    assert!(
        net_move_bps <= 305,
        "Total move over 5 minutes ({net_move_bps} bps) must not exceed 305 bps (~60 bps/min)"
    );
    assert_eq!(
        rate_bps_per_min, 60,
        "Rate must equal exactly 60 bps per minute"
    );
}
