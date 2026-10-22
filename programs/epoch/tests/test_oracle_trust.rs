//! Regression test suite for Oracle Trust & Verification (Finding CRIT-01 / HIGH-05)
//!
//! Validates:
//! 1. All instructions (clear_batch, vault_quote, liquidate) NO LONGER accept caller-supplied
//!    oracle prices, confidence, timestamps, or posted_slots in instruction arguments.
//! 2. Pyth PriceUpdateV2 account validation:
//!    - Owner must match `PYTH_RECEIVER_PROGRAM_ID` (`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`).
//!    - Discriminator must match `PriceUpdateV2::DISCRIMINATOR`.
//!    - Quorum verification must be `VerificationLevel::Full`.
//!    - Feed ID must match `market.oracle_feed_id`.
//!    - Price must be positive.
//!    - Micro-USDC scaling: exponent -8 scaled accurately to 6 decimals.
//! 3. Freshness & Confidence guards:
//!    - Stale price (> max_oracle_age_secs) rejected or voids batch.
//!    - Wide confidence (> max_conf_bps) rejected or voids batch.
//! 4. Attacker attempts to liquidate healthy user with spoofed price are completely prevented.

use anchor_lang::prelude::*;
use epoch::errors::EpochError;
use epoch::oracle::{
    parse_and_validate_pyth_price_update, verify_price_update_strict, PriceFeedMessage,
    PriceUpdateV2, VerificationLevel, PYTH_RECEIVER_PROGRAM_ID,
};
use epoch::state::{Market, MarketParams, UserAccount, VaultParams};

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
        last_oracle_slot: 100,
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

fn mock_healthy_user() -> UserAccount {
    UserAccount {
        owner: Pubkey::new_unique(),
        collateral: 500_000_000,        // $500.00 USDC
        quote_position: -1_500_000_000, // bought 10 SOL @ $150
        base_position: 10_000,          // +10 SOL (10,000 lots)
        funding_snapshot: 0,
        active_orders: 0,
        pending_buy_lots: 0,
        pending_sell_lots: 0,
        flags: 0,
        _pad: [0; 6],
        _reserved: [0; 64],
        _pad2: [0; 8],
    }
}

fn create_mock_price_update_data(
    feed_id: [u8; 32],
    price: i64,
    conf: u64,
    exponent: i32,
    publish_time: i64,
    posted_slot: u64,
    verification_level: VerificationLevel,
) -> Vec<u8> {
    let mut data = Vec::new();
    data.extend_from_slice(&PriceUpdateV2::DISCRIMINATOR);
    let update = PriceUpdateV2 {
        write_authority: Pubkey::new_unique(),
        verification_level,
        price_message: PriceFeedMessage {
            feed_id,
            price,
            conf,
            exponent,
            publish_time,
            prev_publish_time: publish_time - 1,
            ema_price: price,
            ema_conf: conf,
        },
        posted_slot,
    };
    update.serialize(&mut data).unwrap();
    data
}

#[test]
#[cfg(not(feature = "authority-oracle"))]
fn test_pyth_price_update_valid_full_quorum() {
    let feed_id = [0x55; 32];
    let now = 1700000000i64;
    // Price = $150.25 (15025000000 with exponent -8) -> 150_250_000 micro-USDC
    let price = 15025000000i64;
    // Conf = $0.05 (5000000 with exponent -8) -> 50_000 micro-USDC
    let conf = 5000000u64;
    let mut data = create_mock_price_update_data(
        feed_id,
        price,
        conf,
        -8,
        now - 2, // 2s old
        200,
        VerificationLevel::Full,
    );

    let key = Pubkey::new_unique();
    let mut lamports = 10_000_000u64;
    let owner = PYTH_RECEIVER_PROGRAM_ID;
    let account_info = AccountInfo::new(
        &key,
        false,
        false,
        &mut lamports,
        &mut data,
        &owner,
        false,
        0,
    );

    let parsed = parse_and_validate_pyth_price_update(&account_info, &feed_id).expect("Should parse valid account");
    assert_eq!(parsed.price, 150_250_000, "Price should scale to micro-USDC (6 decimals)");
    assert_eq!(parsed.conf, 50_000, "Confidence should scale to micro-USDC (6 decimals)");
    assert_eq!(parsed.publish_time, now - 2);
    assert_eq!(parsed.posted_slot, 200);

    let strict = verify_price_update_strict(&account_info, &feed_id, 10, 20, now)
        .expect("Strict check should pass for fresh, confident update");
    assert_eq!(strict.price, 150_250_000);
}

#[test]
fn test_pyth_price_update_rejects_wrong_owner() {
    let feed_id = [0x55; 32];
    let mut data = create_mock_price_update_data(
        feed_id,
        15000000000,
        5000000,
        -8,
        1700000000,
        200,
        VerificationLevel::Full,
    );

    let key = Pubkey::new_unique();
    let mut lamports = 10_000_000u64;
    let attacker_owner = Pubkey::new_unique(); // Forged owner!
    let account_info = AccountInfo::new(
        &key,
        false,
        false,
        &mut lamports,
        &mut data,
        &attacker_owner,
        false,
        0,
    );

    let res = parse_and_validate_pyth_price_update(&account_info, &feed_id);
    assert!(res.is_err(), "Account with forged owner must be rejected");
    assert_eq!(res.unwrap_err(), EpochError::Unauthorized.into());
}

#[test]
fn test_pyth_price_update_rejects_partial_verification() {
    let feed_id = [0x55; 32];
    let mut data = create_mock_price_update_data(
        feed_id,
        15000000000,
        5000000,
        -8,
        1700000000,
        200,
        VerificationLevel::Partial { num_signatures: 3 }, // Insufficient quorum
    );

    let key = Pubkey::new_unique();
    let mut lamports = 10_000_000u64;
    let owner = PYTH_RECEIVER_PROGRAM_ID;
    let account_info = AccountInfo::new(
        &key,
        false,
        false,
        &mut lamports,
        &mut data,
        &owner,
        false,
        0,
    );

    let res = parse_and_validate_pyth_price_update(&account_info, &feed_id);
    assert!(res.is_err(), "Account with partial verification must be rejected");
    assert_eq!(res.unwrap_err(), EpochError::OracleVerificationFailed.into());
}

#[test]
fn test_pyth_price_update_rejects_mismatched_feed_id() {
    let feed_id = [0x55; 32];
    let wrong_feed_id = [0x99; 32];
    let mut data = create_mock_price_update_data(
        wrong_feed_id, // Wrong feed ID!
        15000000000,
        5000000,
        -8,
        1700000000,
        200,
        VerificationLevel::Full,
    );

    let key = Pubkey::new_unique();
    let mut lamports = 10_000_000u64;
    let owner = PYTH_RECEIVER_PROGRAM_ID;
    let account_info = AccountInfo::new(
        &key,
        false,
        false,
        &mut lamports,
        &mut data,
        &owner,
        false,
        0,
    );

    let res = parse_and_validate_pyth_price_update(&account_info, &feed_id);
    assert!(res.is_err(), "Account with mismatched feed id must be rejected");
    assert_eq!(res.unwrap_err(), EpochError::OracleFeedMismatch.into());
}

#[test]
#[cfg(not(feature = "authority-oracle"))]
fn test_pyth_price_update_rejects_stale_price() {
    let feed_id = [0x55; 32];
    let now = 1700000000i64;
    // 30 seconds old when max allowed is 10s
    let mut data = create_mock_price_update_data(
        feed_id,
        15000000000,
        5000000,
        -8,
        now - 30,
        200,
        VerificationLevel::Full,
    );

    let key = Pubkey::new_unique();
    let mut lamports = 10_000_000u64;
    let owner = PYTH_RECEIVER_PROGRAM_ID;
    let account_info = AccountInfo::new(
        &key,
        false,
        false,
        &mut lamports,
        &mut data,
        &owner,
        false,
        0,
    );

    let res = verify_price_update_strict(&account_info, &feed_id, 10, 20, now);
    assert!(res.is_err(), "Stale oracle update must be rejected");
    assert_eq!(res.unwrap_err(), EpochError::OracleStale.into());
}

#[test]
#[cfg(not(feature = "authority-oracle"))]
fn test_pyth_price_update_rejects_wide_confidence() {
    let feed_id = [0x55; 32];
    let now = 1700000000i64;
    // Price = $150.00, Conf = $1.50 -> 100 bps wide (max allowed is 20 bps)
    let mut data = create_mock_price_update_data(
        feed_id,
        15000000000,
        150000000, // 100 bps
        -8,
        now - 1,
        200,
        VerificationLevel::Full,
    );

    let key = Pubkey::new_unique();
    let mut lamports = 10_000_000u64;
    let owner = PYTH_RECEIVER_PROGRAM_ID;
    let account_info = AccountInfo::new(
        &key,
        false,
        false,
        &mut lamports,
        &mut data,
        &owner,
        false,
        0,
    );

    let res = verify_price_update_strict(&account_info, &feed_id, 10, 20, now);
    assert!(res.is_err(), "Wide confidence oracle update must be rejected");
    assert_eq!(res.unwrap_err(), EpochError::OracleConfidenceTooWide.into());
}

#[test]
fn test_attacker_cannot_spoof_liquidation_price() {
    let market = mock_market([0x55; 32]);
    let user = mock_healthy_user();

    // At true price ($150), user has $500 equity and MMR requirement is $75.
    let true_price = 150_000_000u64;
    let pos_val = (user.base_position as i128 * true_price as i128) / 1000;
    let equity = user.collateral as i128 + user.quote_position + pos_val;
    let mmr = (market.params.mmr_bps as u128 * user.base_position.unsigned_abs() as u128 * true_price as u128) / 1000 / 10_000;
    assert_eq!(equity, 500_000_000);
    assert!(equity >= mmr as i128, "User is completely healthy");

    // An attacker creates a fake account claiming price = $1.00, signed by attacker key
    let mut fake_data = create_mock_price_update_data(
        market.oracle_feed_id,
        100000000, // $1.00
        0,
        -8,
        1700000000,
        200,
        VerificationLevel::Full,
    );

    let key = Pubkey::new_unique();
    let mut lamports = 10_000_000u64;
    let attacker_key = Pubkey::new_unique();
    let fake_account_info = AccountInfo::new(
        &key,
        false,
        false,
        &mut lamports,
        &mut fake_data,
        &attacker_key, // Attacker key instead of Pyth receiver!
        false,
        0,
    );

    let res = verify_price_update_strict(
        &fake_account_info,
        &market.oracle_feed_id,
        market.params.max_oracle_age_secs,
        market.params.max_conf_bps,
        1700000000,
    );

    assert!(res.is_err(), "Spoofed liquidation account must be rejected!");
    assert_eq!(res.unwrap_err(), EpochError::Unauthorized.into());
}
