//! Integration tests for Mechanism Spec §6.1:
//! Worked example of a market buy against a vault-style ladder.
//!
//! Validates that in a uniform-price batch:
//! 1. Every matched lot trades at the SINGLE clearing price P*, NOT a weighted average of the asks.
//! 2. 1,000-lot market buy against ladder 500@12, 1000@18, 2000@25 clears at +21 bps.
//! 3. 10-lot market buy against the same ladder clears at +14 bps.
//! 4. 100-lot market buy against the same ladder clears at +14 bps.
//! 5. Ladder VWAP is 21.1 bps (not 18.2 bps).

use epoch::instructions::clear_batch::execute_batch_auction;
use epoch::state::constants::CENTER_TICK;
use epoch::state::{Batch, BatchStatus};

fn create_mock_batch() -> Batch {
    Batch {
        batch_id: 1,
        status: BatchStatus::OPEN,
        oracle_price: 150_000_000,
        oracle_conf: 5_000,
        oracle_posted_slot: 101,
        clearing_tick: CENTER_TICK as u16,
        clearing_price: 150_000_000,
        ..Default::default()
    }
}

#[test]
fn test_spec_6_1_program_1000_lots_market_buy_clears_at_21_bps() {
    let mut batch = create_mock_batch();
    let c = CENTER_TICK;

    // Vault ladder: 500 @ +12, 1000 @ +18, 2000 @ +25
    batch.ask_qty[c + 12] = 500;
    batch.ask_qty[c + 18] = 1000;
    batch.ask_qty[c + 25] = 2000;

    // Market buy of 1,000 lots (limit +50 bps = tick 100)
    batch.bid_qty[c + 50] = 1000;

    let oracle_price = 150_000_000u64; // $150.00
    let tick_bps = 1u16;

    let (i_star, cl_price, q_star) = execute_batch_auction(&mut batch, oracle_price, tick_bps);

    // Matched volume: exactly 1,000 lots
    assert_eq!(q_star, 1000);

    // Single clearing tick: 71 (+21 bps), NOT pay-as-bid weighted average 15 bps
    assert_eq!(i_star, (c + 21) as u16);
    let offset_bps = i_star as i32 - c as i32;
    assert_eq!(offset_bps, 21);

    // Uniform price: 150.00 * (1 + 0.0021) = 150.315 micro-USDC
    assert_eq!(cl_price, 150_315_000);

    // Taker cost = +21 bps offset + 5 bps protocol fee = 26 bps one-way
    let fee_bps = 5i32;
    assert_eq!(offset_bps + fee_bps, 26);
}

#[test]
fn test_spec_6_1_program_10_lots_market_buy_clears_at_14_bps() {
    let mut batch = create_mock_batch();
    let c = CENTER_TICK;

    batch.ask_qty[c + 12] = 500;
    batch.ask_qty[c + 18] = 1000;
    batch.ask_qty[c + 25] = 2000;

    // 10 lots market buy
    batch.bid_qty[c + 50] = 10;

    let oracle_price = 150_000_000u64;
    let tick_bps = 1u16;

    let (i_star, cl_price, q_star) = execute_batch_auction(&mut batch, oracle_price, tick_bps);

    assert_eq!(q_star, 10);
    // Clearing tick: 64 (+14 bps)
    assert_eq!(i_star, (c + 14) as u16);
    let offset_bps = i_star as i32 - c as i32;
    assert_eq!(offset_bps, 14);

    // Price: 150.00 * (1 + 0.0014) = 150.210 micro-USDC
    assert_eq!(cl_price, 150_210_000);

    let fee_bps = 5i32;
    assert_eq!(offset_bps + fee_bps, 19);
}

#[test]
fn test_spec_6_1_program_100_lots_market_buy_clears_at_14_bps() {
    let mut batch = create_mock_batch();
    let c = CENTER_TICK;

    batch.ask_qty[c + 12] = 500;
    batch.ask_qty[c + 18] = 1000;
    batch.ask_qty[c + 25] = 2000;

    // 100 lots market buy (0.1 SOL)
    batch.bid_qty[c + 50] = 100;

    let oracle_price = 150_000_000u64;
    let tick_bps = 1u16;

    let (i_star, cl_price, q_star) = execute_batch_auction(&mut batch, oracle_price, tick_bps);

    assert_eq!(q_star, 100);
    assert_eq!(i_star, (c + 14) as u16);
    let offset_bps = i_star as i32 - c as i32;
    assert_eq!(offset_bps, 14);
    assert_eq!(cl_price, 150_210_000);

    let fee_bps = 5i32;
    assert_eq!(offset_bps + fee_bps, 19);
}

#[test]
fn test_spec_6_1_program_ladder_vwap_equals_21_1_bps() {
    // 500@12, 1000@18, 2000@25 (Total: 3500 lots)
    let total_lots: f64 = 500.0 + 1000.0 + 2000.0;
    let weighted_bps: f64 = 500.0 * 12.0 + 1000.0 * 18.0 + 2000.0 * 25.0;
    let vwap: f64 = weighted_bps / total_lots;
    let rounded = (vwap * 10.0).round() / 10.0;
    assert_eq!(rounded, 21.1f64);
}
