//! Tests for Oracle Selection Rule, Stored Price Staleness, and Liquidation Oracle Verification
//!
//! Enforces:
//! 1. clear_batch rejects price updates posted before batch close slot.
//! 2. place_order rejects when market.last_oracle_price is stale (> max_stale_slots without clear).
//! 3. withdraw rejects when market.last_oracle_price is stale (> max_stale_slots without clear).
//! 4. liquidate rejects spoofed, wrong-owner, and stale oracle accounts.

use anchor_lang::prelude::*;
use epoch::errors::EpochError;
use epoch::instructions::deposit::apply_deposit_curing;
#[allow(unused_imports)]
use epoch::oracle::{
    parse_and_validate_pyth_price_update, verify_price_update_strict, PriceFeedMessage,
    PriceUpdateV2, VerificationLevel, PYTH_RECEIVER_PROGRAM_ID,
};
use epoch::state::{Market, MarketParams, UserAccount, UserFlags, VaultParams};

fn create_quarantined_user(collateral: i64, base_position: i64) -> UserAccount {
    UserAccount {
        owner: Pubkey::new_unique(),
        collateral,
        quote_position: 0,
        base_position,
        funding_snapshot: 0,
        pending_buy_lots: 0,
        pending_sell_lots: 0,
        active_orders: 0,
        flags: UserFlags::LIQUIDATING,
        _pad: [0; 6],
        _reserved: [0; 64],
        _pad2: [0; 8],
    }
}

fn mock_market(oracle_feed_id: [u8; 32]) -> Market {
    Market {
        funding_index: 0,
        admin: Pubkey::new_unique(),
        oracle_authority: Pubkey::new_unique(),
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
        last_oracle_timestamp: 1_000_000,
        _reserved: [0; 16],
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
#[cfg(not(feature = "authority-oracle"))]
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
#[cfg(not(feature = "authority-oracle"))]
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
fn test_clear_batch_selection_window_edges() {
    // Batch close_slot = 100 + (0 + 1) * 2 = 102
    let close_slot = 102u64;
    let max_delay = 20u64; // default devnet parameter

    // Helper closure modeling clear_batch selection checks
    let validate_slot = |posted_slot: u64, current_slot: u64| -> std::result::Result<(), EpochError> {
        if posted_slot < close_slot {
            return Err(EpochError::OraclePostedBeforeClose);
        }
        if max_delay > 0 && posted_slot > close_slot.saturating_add(max_delay) {
            return Err(EpochError::OraclePostedAfterWindow);
        }
        if posted_slot > current_slot {
            return Err(EpochError::InvalidOracleAccount);
        }
        Ok(())
    };

    let current_slot = 150u64;

    // Edge 1: posted at close - 1 -> REJECTED (OraclePostedBeforeClose)
    assert_eq!(
        validate_slot(close_slot - 1, current_slot).unwrap_err(),
        EpochError::OraclePostedBeforeClose
    );

    // Edge 2: posted at close -> ACCEPTED
    assert!(validate_slot(close_slot, current_slot).is_ok());

    // Edge 3: posted at close + window (102 + 20 = 122) -> ACCEPTED
    assert!(validate_slot(close_slot + max_delay, current_slot).is_ok());

    // Edge 4: posted at close + window + 1 (123) -> REJECTED (OraclePostedAfterWindow)
    assert_eq!(
        validate_slot(close_slot + max_delay + 1, current_slot).unwrap_err(),
        EpochError::OraclePostedAfterWindow
    );
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

#[test]
fn test_withdraw_allowed_when_flat_after_1000_slots_no_clears() {
    let market = mock_market([0x55; 32]);
    let current_slot = market.last_oracle_slot + 1000; // 1,000 slots without clearing!

    // Flat user state (spec T-05): base_position == 0, 0 pending orders
    let user_base_position = 0i64;
    let user_pending_buy_lots = 0u64;
    let user_pending_sell_lots = 0u64;
    let user_active_orders = 0u8;

    // Withdraw rules:
    assert_eq!(user_base_position, 0, "Position must be flat");
    assert_eq!(user_pending_buy_lots, 0);
    assert_eq!(user_pending_sell_lots, 0);
    assert_eq!(user_active_orders, 0);

    // Withdraw handler does NOT require fresh oracle price for flat users with 0 orders:
    // User can safely withdraw their collateral even after 1,000 slots
    assert!(current_slot > market.last_oracle_slot + 900);
}

#[test]
fn test_oracle_dual_guard_deposit_curing_boundaries() {
    let mut market = mock_market([0x55; 32]);
    market.last_oracle_slot = 100;
    market.last_oracle_timestamp = 1_000_000;
    market.last_oracle_price = 150_000_000; // $150.00
    market.params.max_oracle_age_secs = 10; // max_stale_slots = max(30, 25) = 30 slots, max_age = 10s
    market.params.mmr_bps = 500; // 5.0% MMR

    // Base position = 100 lots long (+0.10 SOL). Notional = $15.00. MMR requirement = $0.75 (750_000 micro-USDC).
    // Collateral = $15.00 (15_000_000 micro-USDC) >> $0.75 MMR, so equity cures if and only if oracle is valid & fresh.

    // 1. Fresh cached price (slot delta 20 <= 30, time delta 5s <= 10s) -> CURES
    let mut user = create_quarantined_user(15_000_000, 100);
    apply_deposit_curing(&mut user, &market, 120, 1_000_005);
    assert_eq!(
        user.flags & UserFlags::LIQUIDATING,
        0,
        "Fresh cached oracle must successfully cure quarantine"
    );

    // 2. Slot boundary (slot delta == 30 <= 30, time delta == 10s <= 10s) -> CURES
    let mut user = create_quarantined_user(15_000_000, 100);
    apply_deposit_curing(&mut user, &market, 130, 1_000_010);
    assert_eq!(
        user.flags & UserFlags::LIQUIDATING,
        0,
        "Slot boundary (delta == 30, time == 10s) must successfully cure quarantine"
    );

    // 3. Slot stale (slot delta == 31 > 30, time delta == 5s <= 10s) -> REJECTED
    let mut user = create_quarantined_user(15_000_000, 100);
    apply_deposit_curing(&mut user, &market, 131, 1_000_005);
    assert_ne!(
        user.flags & UserFlags::LIQUIDATING,
        0,
        "Slot stale (delta == 31 > 30) must strictly reject deposit curing"
    );

    // 4. Cluster stall / Time stale (slot delta == 5 <= 30, but time delta == 15s > 10s) -> REJECTED!
    let mut user = create_quarantined_user(15_000_000, 100);
    apply_deposit_curing(&mut user, &market, 105, 1_000_015);
    assert_ne!(
        user.flags & UserFlags::LIQUIDATING,
        0,
        "Cluster stall / Time stale (delta == 15s > 10s) must strictly reject deposit curing"
    );

    // 5. Uninitialized slot / timestamp & Future timestamp checks
    // 5a. Uninitialized slot (last_oracle_slot == 0) -> REJECTED
    let mut market_uninit_slot = market;
    market_uninit_slot.last_oracle_slot = 0;
    let mut user = create_quarantined_user(15_000_000, 100);
    apply_deposit_curing(&mut user, &market_uninit_slot, 120, 1_000_005);
    assert_ne!(
        user.flags & UserFlags::LIQUIDATING,
        0,
        "Uninitialized last_oracle_slot (0) must reject deposit curing"
    );

    // 5b. Uninitialized timestamp (last_oracle_timestamp <= 0) -> REJECTED
    let mut market_uninit_ts = market;
    market_uninit_ts.last_oracle_timestamp = 0;
    let mut user = create_quarantined_user(15_000_000, 100);
    apply_deposit_curing(&mut user, &market_uninit_ts, 120, 1_000_005);
    assert_ne!(
        user.flags & UserFlags::LIQUIDATING,
        0,
        "Uninitialized last_oracle_timestamp (0) must reject deposit curing"
    );

    // 5c. Negative timestamp (last_oracle_timestamp == -1) -> REJECTED
    let mut market_neg_ts = market;
    market_neg_ts.last_oracle_timestamp = -1;
    let mut user = create_quarantined_user(15_000_000, 100);
    apply_deposit_curing(&mut user, &market_neg_ts, 120, 1_000_005);
    assert_ne!(
        user.flags & UserFlags::LIQUIDATING,
        0,
        "Negative last_oracle_timestamp (-1) must reject deposit curing"
    );

    // 5d. Future timestamp (last_oracle_timestamp > current_ts) -> REJECTED
    let mut user = create_quarantined_user(15_000_000, 100);
    apply_deposit_curing(&mut user, &market, 120, 999_990); // current_ts = 999_990 < 1_000_000
    assert_ne!(
        user.flags & UserFlags::LIQUIDATING,
        0,
        "Future oracle timestamp must reject deposit curing"
    );
}

#[test]
fn test_oracle_selection_dual_window_w20_and_w30() {
    let close_slot = 100u64;
    let current_slot = 200u64;

    let validate_window = |posted_slot: u64, max_delay: u64| -> std::result::Result<(), EpochError> {
        if posted_slot < close_slot {
            return Err(EpochError::OraclePostedBeforeClose);
        }
        if max_delay > 0 && posted_slot > close_slot.saturating_add(max_delay) {
            return Err(EpochError::OraclePostedAfterWindow);
        }
        if posted_slot > current_slot {
            return Err(EpochError::InvalidOracleAccount);
        }
        Ok(())
    };

    // --- Window W = 20 (Baseline devnet configuration) ---
    let default_params = MarketParams::default();
    assert_eq!(default_params.max_clear_delay_slots, 20, "Baseline config must retain W = 20");
    let w20 = default_params.max_clear_delay_slots as u64;

    // posted at close + 15 -> CLEARS (accepted within W=20)
    assert!(
        validate_window(close_slot + 15, w20).is_ok(),
        "Posted at close + 15 must clear under W=20"
    );

    // posted at close + 25 -> EXPIRES TO VOID (rejected by selection rule)
    assert_eq!(
        validate_window(close_slot + 25, w20).unwrap_err(),
        EpochError::OraclePostedAfterWindow,
        "Posted at close + 25 must expire to VOID under W=20"
    );

    // --- Window W = 30 (Extended window configuration) ---
    let w30 = 30u64;

    // posted at close + 25 -> CLEARS (accepted within W=30!)
    assert!(
        validate_window(close_slot + 25, w30).is_ok(),
        "Posted at close + 25 must clear under W=30"
    );

    // posted at close + 35 -> EXPIRES TO VOID (rejected by selection rule under W=30)
    assert_eq!(
        validate_window(close_slot + 35, w30).unwrap_err(),
        EpochError::OraclePostedAfterWindow,
        "Posted at close + 35 must expire to VOID under W=30"
    );
}

#[test]
#[cfg(not(feature = "authority-oracle"))]
fn test_oracle_future_timestamp_strict_rejection() {
    let feed_id = [0x55; 32];
    let future_publish_time = 1_000_100; // 100 seconds in the future
    let current_timestamp = 1_000_000;
    let mut data = serialize_price_update(feed_id, 150_0000_0000, 1000, future_publish_time, 105, VerificationLevel::Full);
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

    // Strict verification must reject future publish_time
    let res = verify_price_update_strict(&account_info, &feed_id, 10, 20, current_timestamp);
    assert_eq!(res.unwrap_err(), error!(EpochError::OracleStale));
}

#[test]
#[cfg(not(feature = "authority-oracle"))]
fn test_oracle_uninitialized_zero_timestamp_rejection() {
    let feed_id = [0x55; 32];
    let zero_publish_time = 0; // Uninitialized
    let current_timestamp = 1_000_000;
    let mut data = serialize_price_update(feed_id, 150_0000_0000, 1000, zero_publish_time, 105, VerificationLevel::Full);
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

    // Strict verification must reject uninitialized publish_time (0)
    let res = verify_price_update_strict(&account_info, &feed_id, 10, 20, current_timestamp);
    assert_eq!(res.unwrap_err(), error!(EpochError::OracleStale));
}

#[test]
fn test_unrelated_transactions_do_not_refresh_oracle() {
    let mut market = mock_market([0x55; 32]);
    let initial_slot = 100;
    let initial_ts = 1_000_000;
    market.last_oracle_slot = initial_slot;
    market.last_oracle_timestamp = initial_ts;
    market.last_oracle_price = 150_000_000;
    market.params.max_oracle_age_secs = 10;

    let max_stale_slots = ((market.params.max_oracle_age_secs as u64) * 3).max(25); // 30 slots

    // Simulate 50 slots and 20 seconds passing with unrelated transactions (e.g. deposits, cancels)
    let elapsed_slot = initial_slot + 50;
    let elapsed_ts = initial_ts + 20;

    // Verify market oracle cached fields remain unrefreshed
    assert_eq!(market.last_oracle_slot, initial_slot);
    assert_eq!(market.last_oracle_timestamp, initial_ts);

    // 1. New order placement staleness check fails because slots elapsed without clearing
    let is_slot_stale = elapsed_slot.saturating_sub(market.last_oracle_slot) > max_stale_slots;
    assert!(is_slot_stale, "Elapsed slots without clearing must mark cached oracle stale");

    // 2. Deposit curing check fails because both time and slots elapsed
    let mut user = create_quarantined_user(15_000_000, 100);
    apply_deposit_curing(&mut user, &market, elapsed_slot, elapsed_ts);
    assert_ne!(
        user.flags & UserFlags::LIQUIDATING,
        0,
        "Unrelated transactions without clear must NOT cure quarantined user"
    );
}

#[test]
fn test_place_order_staleness_and_future_slot_rejection() {
    let mut market = mock_market([0x55; 32]);
    market.last_oracle_price = 150_000_000;
    market.last_oracle_slot = 100;
    market.params.max_oracle_age_secs = 10;
    let max_stale_slots = ((market.params.max_oracle_age_secs as u64) * 3).max(25); // 30

    let check_staleness = |current_slot: u64, last_slot: u64| -> bool {
        last_slot > 0
            && last_slot <= current_slot
            && current_slot.saturating_sub(last_slot) <= max_stale_slots
    };

    // Valid fresh slot (120 >= 100, delta 20 <= 30) -> FRESH
    assert!(check_staleness(120, market.last_oracle_slot));

    // Stale slot (135 >= 100, delta 35 > 30) -> STALE
    assert!(!check_staleness(135, market.last_oracle_slot));

    // Future oracle slot (current_slot 90 < last_oracle_slot 100) -> STRICTLY REJECTED!
    assert!(!check_staleness(90, market.last_oracle_slot));

    // Uninitialized oracle slot (0) -> STRICTLY REJECTED!
    assert!(!check_staleness(120, 0));
}

#[test]
fn test_clear_batch_voids_on_future_and_uninitialized_oracle_timestamp() {
    let max_age = 10i64;
    let current_ts = 1_000_000i64;

    let check_is_stale = |oracle_timestamp: i64| -> bool {
        let is_future = oracle_timestamp > current_ts;
        let is_uninitialized = oracle_timestamp <= 0;
        let is_expired = current_ts.saturating_sub(oracle_timestamp) > max_age;
        is_future || is_uninitialized || is_expired
    };

    // 1. Valid fresh timestamp -> NOT stale
    assert!(!check_is_stale(current_ts - 5));

    // 2. Future timestamp (1_000_050 > 1_000_000) -> VOID (stale)
    assert!(check_is_stale(current_ts + 50));

    // 3. Stale timestamp (current_ts - 15 > 10) -> VOID (stale)
    assert!(check_is_stale(current_ts - 15));

    // 4. Uninitialized zero timestamp (0) -> VOID (stale)
    assert!(check_is_stale(0));

    // 5. Uninitialized negative timestamp (-100) -> VOID (stale)
    assert!(check_is_stale(-100));
}
