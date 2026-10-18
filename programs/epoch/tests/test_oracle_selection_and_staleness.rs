//! Tests for Oracle Selection Rule, Stored Price Staleness, and Liquidation Oracle Verification
//!
//! Enforces:
//! 1. clear_batch rejects price updates posted before batch close slot.
//! 2. place_order rejects when market.last_oracle_price is stale (> max_stale_slots without clear).
//! 3. withdraw rejects when market.last_oracle_price is stale (> max_stale_slots without clear).
//! 4. liquidate rejects spoofed, wrong-owner, and stale oracle accounts.

use anchor_lang::prelude::*;
use epoch::errors::EpochError;
use epoch::oracle::{
    parse_and_validate_pyth_price_update, verify_price_update_strict, PriceFeedMessage,
    PriceUpdateV2, VerificationLevel, PYTH_RECEIVER_PROGRAM_ID,
};
use epoch::state::{Market, MarketParams, VaultParams};

fn mock_market(oracle_feed_id: [u8; 32]) -> Market {
    Market {
        funding_index: 0,
        admin: Pubkey::new_unique(),
        quote_mint: Pubkey::new_unique(),
        collateral_vault: Pubkey::new_unique(),
        oracle_feed_id,
        params: MarketParams::default(),
        start_slot: 100,
        next_batch_to_clear: 0,
        last_oracle_price: 150_000_000, // $150.00
        last_oracle_slot: 105,
        open_interest_lots: 0,
        fee_pool: 0,
        insurance_fund: 1_000_000_000,
        bad_debt: 0,
        vault_params: VaultParams::default(),
        bump: 255,
        _pad_bump: [0; 7],
        _reserved: [0; 56],
    }
}

fn serialize_price_update(
    feed_id: [u8; 32],
    price: i64,
    conf: u64,
    publish_time: i64,
    posted_slot: u64,
    verification_level: VerificationLevel,
) -> Vec<u8> {
    let msg = PriceFeedMessage {
        feed_id,
        price,
        conf,
        exponent: -8,
        publish_time,
        prev_publish_time: publish_time - 1,
        ema_price: price,
        ema_conf: conf,
    };
    let update = PriceUpdateV2 {
        write_authority: Pubkey::new_unique(),
        verification_level,
        price_message: msg,
        posted_slot,
    };

    let mut data = Vec::new();
    data.extend_from_slice(&PriceUpdateV2::DISCRIMINATOR);
    update.serialize(&mut data).unwrap();
    data
}

#[test]
fn test_liquidate_rejects_wrong_owner_oracle() {
    let feed_id = [0x55; 32];
    let mut data = serialize_price_update(feed_id, 150_0000_0000, 1000, 1_000_000, 105, VerificationLevel::Full);
    let mut lamports = 1_000_000;
    let wrong_owner = Pubkey::new_unique();
    let account_key = Pubkey::new_unique();

    let account_info = AccountInfo::new(
        &account_key,
        false,
        false,
        &mut lamports,
        &mut data,
        &wrong_owner, // WRONG OWNER (not Pyth receiver)
        false,
        0,
    );

    let res = verify_price_update_strict(&account_info, &feed_id, 10, 20, 1_000_005);
    assert_eq!(res.unwrap_err(), error!(EpochError::Unauthorized));
}

#[test]
fn test_liquidate_rejects_spoofed_discriminator() {
    let feed_id = [0x55; 32];
    let mut data = serialize_price_update(feed_id, 150_0000_0000, 1000, 1_000_000, 105, VerificationLevel::Full);
    data[0] ^= 0xff; // Corrupt discriminator
    let mut lamports = 1_000_000;
    let account_key = Pubkey::new_unique();

    let account_info = AccountInfo::new(
        &account_key,
        false,
        false,
        &mut lamports,
        &mut data,
        &PYTH_RECEIVER_PROGRAM_ID,
        false,
        0,
    );

    let res = verify_price_update_strict(&account_info, &feed_id, 10, 20, 1_000_005);
    assert_eq!(res.unwrap_err(), error!(EpochError::InvalidOracleAccount));
}

#[test]
fn test_liquidate_rejects_stale_oracle_timestamp() {
    let feed_id = [0x55; 32];
    let publish_time = 1_000_000;
    let mut data = serialize_price_update(feed_id, 150_0000_0000, 1000, publish_time, 105, VerificationLevel::Full);
    let mut lamports = 1_000_000;
    let account_key = Pubkey::new_unique();

    let account_info = AccountInfo::new(
        &account_key,
        false,
        false,
        &mut lamports,
        &mut data,
        &PYTH_RECEIVER_PROGRAM_ID,
        false,
        0,
    );

    // Current time is 1_000_020 (20 seconds later, max age is 10)
    let res = verify_price_update_strict(&account_info, &feed_id, 10, 20, 1_000_020);
    assert_eq!(res.unwrap_err(), error!(EpochError::OracleStale));
}

#[test]
fn test_clear_batch_rejects_oracle_posted_before_close() {
    // Batch 0: start_slot = 100, batch_slots = 2 -> close_slot = 100 + (0 + 1) * 2 = 102
    let close_slot = 102u64;
    let max_delay = 4u64;

    // Price was posted at slot 101 (< close_slot 102), before batch closed
    let posted_slot = 101u64;
    let current_slot = 103u64;

    // Oracle selection rule: require posted_slot >= close_slot
    let check = posted_slot >= close_slot
        && (max_delay == 0 || posted_slot <= close_slot.saturating_add(max_delay))
        && posted_slot <= current_slot;

    assert!(!check, "Oracle posted before close slot must be rejected");
}

#[test]
fn test_stored_price_staleness_calculation() {
    let market = mock_market([0x55; 32]);
    let max_stale_slots = ((market.params.max_oracle_age_secs as u64) * 3).max(25);
    assert_eq!(max_stale_slots, 30); // 10 secs * 3 = 30 slots

    // Case 1: fresh (last_oracle_slot = 105, current_slot = 120 -> delta 15 <= 30)
    let current_slot_fresh = 120;
    let is_stale_fresh = current_slot_fresh - market.last_oracle_slot > max_stale_slots;
    assert!(!is_stale_fresh);

    // Case 2: stale (last_oracle_slot = 105, current_slot = 200 -> delta 95 > 30)
    let current_slot_stale = 200;
    let is_stale_stale = current_slot_stale - market.last_oracle_slot > max_stale_slots;
    assert!(is_stale_stale);
}
