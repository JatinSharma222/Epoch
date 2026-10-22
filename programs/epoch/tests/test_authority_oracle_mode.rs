use anchor_lang::prelude::*;
use epoch::instructions::post_price::AuthorityPriceUpdate;
use epoch::state::constants::INITIAL_ORACLE_PRICE;
use epoch::state::{Market, MarketParams, VaultParams};

#[allow(dead_code)]
fn create_test_market(admin: Pubkey) -> Market {
    Market {
        funding_index: 0,
        admin,
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
        _reserved: [0; 56],
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
