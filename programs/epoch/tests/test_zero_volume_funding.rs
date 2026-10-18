use epoch::instructions::clear_batch::execute_batch_auction;
use epoch::state::constants::{CENTER_TICK, F_SCALE};
use epoch::state::{Batch, BatchStatus, MarketParams, OrderSide, OrderStatus};

#[test]
fn test_zero_volume_batch_funding_accrual_at_oracle_parity() {
    let mut batch = Batch::default();
    let oracle_price = 150_000_000u64; // $150.00
    let tick_bps = 1u16;

    let (i_star, cl_price, q_star) = execute_batch_auction(&mut batch, oracle_price, tick_bps);

    // Rule approved: when q_star == 0, clears at oracle price with offset 0
    assert_eq!(q_star, 0);
    assert_eq!(cl_price, oracle_price);
    assert_eq!(i_star, CENTER_TICK as u16);
    assert_eq!(batch.status, BatchStatus::CLEARED);

    let c = CENTER_TICK;
    let offset_star = (i_star as i32 - c as i32) * tick_bps as i32;
    assert_eq!(offset_star, 0, "Zero-volume batch offset must be exactly 0 bps (oracle parity)");

    let params = MarketParams::default();
    let rate = offset_star.clamp(-(params.funding_cap_bps as i32), params.funding_cap_bps as i32);
    assert_eq!(rate, 0);

    let funding_period_slots = params.funding_period_slots as i128;
    let n_slots = params.batch_slots as i128;

    let accrual = (rate as i128 * oracle_price as i128 * n_slots * (F_SCALE / 1000))
        / (10_000 * funding_period_slots);

    assert_eq!(accrual, 0, "Zero volume batch accrues 0 funding delta at oracle parity");
}

#[test]
fn test_zero_volume_batch_expires_unmatched_resting_orders() {
    let mut batch = Batch::default();
    batch.num_orders = 2;
    // Bid at tick 40 (below center tick 50)
    batch.orders[0].user_pda = anchor_lang::solana_program::pubkey::Pubkey::new_unique();
    batch.orders[0].tick = 40;
    batch.orders[0].lots = 10;
    batch.orders[0].side = OrderSide::BUY;
    batch.orders[0].status = OrderStatus::OPEN;
    batch.bid_qty[40] = 10;

    // Ask at tick 60 (above center tick 50) - no crossing
    batch.orders[1].user_pda = anchor_lang::solana_program::pubkey::Pubkey::new_unique();
    batch.orders[1].tick = 60;
    batch.orders[1].lots = 10;
    batch.orders[1].side = OrderSide::SELL;
    batch.orders[1].status = OrderStatus::OPEN;
    batch.ask_qty[60] = 10;

    let oracle_price = 150_000_000u64;
    let (i_star, cl_price, q_star) = execute_batch_auction(&mut batch, oracle_price, 1);

    assert_eq!(q_star, 0);
    assert_eq!(cl_price, oracle_price);
    assert_eq!(i_star, CENTER_TICK as u16);
    assert_eq!(batch.orders[0].status, OrderStatus::EXPIRED);
    assert_eq!(batch.orders[1].status, OrderStatus::EXPIRED);
    assert_eq!(batch.orders[0].filled_lots, 0);
    assert_eq!(batch.orders[1].filled_lots, 0);
}
