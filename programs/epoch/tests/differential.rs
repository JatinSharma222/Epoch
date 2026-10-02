use epoch::instructions::clear_batch::execute_batch_auction;
use epoch::state::constants::{CENTER_TICK, K_TICKS, MAX_ORDERS, PRICE_TICK};
use epoch::state::{Batch, BatchStatus, Order, OrderSide, OrderStatus};
use epoch_ref::{allocate_order_fills, clear, clearing_price, OrderRef};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use std::fs;
use std::path::Path;

fn setup_batch_and_ref(
    raw_orders: &[(u8, u16, u64)], // (side, tick, lots)
) -> (Batch, Vec<OrderRef>) {
    let mut batch = Batch {
        batch_id: 1,
        status: BatchStatus::OPEN,
        num_orders: raw_orders.len() as u16,
        ..Default::default()
    };

    let mut ref_orders = Vec::with_capacity(raw_orders.len());

    for (i, &(side, tick, lots)) in raw_orders.iter().enumerate() {
        assert!(tick < K_TICKS as u16);
        assert!(i < MAX_ORDERS);

        let order = Order {
            side,
            tick,
            lots,
            status: OrderStatus::OPEN,
            slot_id: (i % 8) as u8,
            ..Default::default()
        };

        batch.orders[i] = order;

        if side == OrderSide::BUY {
            batch.bid_qty[tick as usize] = batch.bid_qty[tick as usize].saturating_add(lots);
        } else {
            batch.ask_qty[tick as usize] = batch.ask_qty[tick as usize].saturating_add(lots);
        }

        ref_orders.push(OrderRef { side, tick, lots });
    }

    (batch, ref_orders)
}

fn assert_differential_parity(
    batch: &mut Batch,
    ref_orders: &[OrderRef],
    oracle_price: u64,
    tick_bps: u16,
) {
    // 1. Execute program clearing logic
    let (prog_tick, prog_price, prog_matched) =
        execute_batch_auction(batch, oracle_price, tick_bps);

    // 2. Execute reference engine
    let ref_clear_opt = clear(&batch.bid_qty, &batch.ask_qty);

    match ref_clear_opt {
        None => {
            // No trade case
            assert_eq!(prog_matched, 0, "No trade: prog_matched must be 0");
            assert_eq!(
                batch.matched_lots, 0,
                "No trade: batch.matched_lots must be 0"
            );
            assert_eq!(
                prog_tick, CENTER_TICK as u16,
                "No trade: clearing tick must be center"
            );
            assert_eq!(
                prog_price, oracle_price,
                "No trade: clearing price must be oracle"
            );
            assert_eq!(
                batch.status,
                BatchStatus::CLEARED,
                "Batch status must be CLEARED"
            );

            for i in 0..ref_orders.len() {
                assert_eq!(
                    batch.orders[i].filled_lots, 0,
                    "Order {} fill must be 0 on no-trade",
                    i
                );
                assert_eq!(
                    batch.orders[i].status,
                    OrderStatus::EXPIRED,
                    "Order {} status must be EXPIRED on no-trade",
                    i
                );
            }
        }
        Some(ref_res) => {
            // Crossing trade case
            assert_eq!(
                prog_tick, ref_res.tick,
                "Clearing tick mismatch: program={}, ref={}",
                prog_tick, ref_res.tick
            );
            assert_eq!(
                batch.clearing_tick, ref_res.tick,
                "Batch clearing tick mismatch: batch={}, ref={}",
                batch.clearing_tick, ref_res.tick
            );
            assert_eq!(
                prog_matched, ref_res.matched,
                "Matched lots mismatch: program={}, ref={}",
                prog_matched, ref_res.matched
            );
            assert_eq!(
                batch.matched_lots, ref_res.matched,
                "Batch matched lots mismatch: batch={}, ref={}",
                batch.matched_lots, ref_res.matched
            );

            let expected_price = clearing_price(
                oracle_price,
                ref_res.tick,
                K_TICKS as u16,
                tick_bps,
                PRICE_TICK,
            );
            assert_eq!(
                prog_price, expected_price,
                "Clearing price mismatch: prog={}, expected={}",
                prog_price, expected_price
            );
            assert_eq!(
                batch.clearing_price, expected_price,
                "Batch clearing price mismatch: batch={}, expected={}",
                batch.clearing_price, expected_price
            );

            // Marginal tick info
            assert_eq!(batch.bid_marginal_tick, ref_res.bid.tick);
            assert_eq!(batch.bid_marginal_alloc, ref_res.bid.alloc);
            assert_eq!(batch.bid_marginal_total, ref_res.bid.total);
            assert_eq!(batch.ask_marginal_tick, ref_res.ask.tick);
            assert_eq!(batch.ask_marginal_alloc, ref_res.ask.alloc);
            assert_eq!(batch.ask_marginal_total, ref_res.ask.total);

            // Order-level fills
            let ref_fills = allocate_order_fills(ref_orders, &ref_res);
            assert_eq!(ref_fills.len(), ref_orders.len());

            let mut total_prog_buy_fills = 0u64;
            let mut total_prog_sell_fills = 0u64;

            for i in 0..ref_orders.len() {
                let prog_fill = batch.orders[i].filled_lots;
                let ref_fill = ref_fills[i];
                assert_eq!(
                    prog_fill, ref_fill,
                    "Order {} fill mismatch: prog={}, ref={}",
                    i, prog_fill, ref_fill
                );

                if ref_orders[i].side == OrderSide::BUY {
                    total_prog_buy_fills += prog_fill;
                } else {
                    total_prog_sell_fills += prog_fill;
                }

                // Verify status consistency
                if ref_fill == ref_orders[i].lots {
                    assert_eq!(batch.orders[i].status, OrderStatus::FILLED);
                } else if ref_fill > 0 {
                    assert_eq!(batch.orders[i].status, OrderStatus::PARTIAL);
                } else {
                    assert_eq!(batch.orders[i].status, OrderStatus::EXPIRED);
                }
            }

            // Invariant I-4: total BUY fills == total SELL fills == matched
            assert_eq!(total_prog_buy_fills, ref_res.matched);
            assert_eq!(total_prog_sell_fills, ref_res.matched);
        }
    }
}

#[test]
fn test_differential_handwritten_corpus() {
    let oracle_price = 150_000_000u64; // $150.00
    let tick_bps = 1u16;
    let c = CENTER_TICK as u16;

    // Case 1: Spec §6 Worked Example (offset -6..+6 around c=50)
    let worked_orders = vec![
        (OrderSide::BUY, c + 5, 10),  // B1 (+5) -> tick 55
        (OrderSide::BUY, c + 3, 20),  // B2 (+3) -> tick 53
        (OrderSide::BUY, c, 15),      // B3 (0) -> tick 50
        (OrderSide::BUY, c - 2, 30),  // B4 (-2) -> tick 48
        (OrderSide::SELL, c - 4, 12), // A1 (-4) -> tick 46
        (OrderSide::SELL, c, 18),     // A2 (0) -> tick 50
        (OrderSide::SELL, c + 3, 25), // A3 (+3) -> tick 53
        (OrderSide::SELL, c + 6, 10), // A4 (+6) -> tick 56
    ];
    let (mut batch, ref_orders) = setup_batch_and_ref(&worked_orders);
    assert_differential_parity(&mut batch, &ref_orders, oracle_price, tick_bps);
    assert_eq!(batch.clearing_tick, c + 1); // tick 51
    assert_eq!(batch.matched_lots, 30);
    assert_eq!(batch.clearing_price, 150_015_000);

    // Case 2: Empty batch (0 orders)
    let (mut batch, ref_orders) = setup_batch_and_ref(&[]);
    assert_differential_parity(&mut batch, &ref_orders, oracle_price, tick_bps);
    assert_eq!(batch.matched_lots, 0);

    // Case 3: Single BUY order
    let (mut batch, ref_orders) = setup_batch_and_ref(&[(OrderSide::BUY, 50, 100)]);
    assert_differential_parity(&mut batch, &ref_orders, oracle_price, tick_bps);
    assert_eq!(batch.matched_lots, 0);

    // Case 4: Single SELL order
    let (mut batch, ref_orders) = setup_batch_and_ref(&[(OrderSide::SELL, 50, 100)]);
    assert_differential_parity(&mut batch, &ref_orders, oracle_price, tick_bps);
    assert_eq!(batch.matched_lots, 0);

    // Case 5: Non-crossing book (max bid 40 < min ask 60)
    let non_crossing = vec![
        (OrderSide::BUY, 40, 50),
        (OrderSide::BUY, 35, 100),
        (OrderSide::SELL, 60, 50),
        (OrderSide::SELL, 65, 100),
    ];
    let (mut batch, ref_orders) = setup_batch_and_ref(&non_crossing);
    assert_differential_parity(&mut batch, &ref_orders, oracle_price, tick_bps);
    assert_eq!(batch.matched_lots, 0);

    // Case 6: Single-tick exact match (bids at 50, asks at 50)
    let single_tick = vec![
        (OrderSide::BUY, 50, 40),
        (OrderSide::BUY, 50, 60),
        (OrderSide::SELL, 50, 30),
        (OrderSide::SELL, 50, 70),
    ];
    let (mut batch, ref_orders) = setup_batch_and_ref(&single_tick);
    assert_differential_parity(&mut batch, &ref_orders, oracle_price, tick_bps);
    assert_eq!(batch.clearing_tick, 50);
    assert_eq!(batch.matched_lots, 100);

    // Case 7: Wide plateau with tie-break rounding toward center
    // Demand 100 from tick 40 down to 0, Supply 100 from tick 60 up to 100
    // Plateau is [40, 60], center is 50. Midpoint is 50.
    let wide_plateau = vec![(OrderSide::BUY, 60, 100), (OrderSide::SELL, 40, 100)];
    let (mut batch, ref_orders) = setup_batch_and_ref(&wide_plateau);
    assert_differential_parity(&mut batch, &ref_orders, oracle_price, tick_bps);
    assert_eq!(batch.clearing_tick, 50);
    assert_eq!(batch.matched_lots, 100);

    // Case 8: Odd-sum plateau interval straddling center tick [49, 50]
    // sum = 99, midpoint 49.5 -> rounds to 50 (closer to c=50)
    let odd_plateau = vec![
        (OrderSide::BUY, 50, 100),
        (OrderSide::BUY, 49, 100),
        (OrderSide::SELL, 49, 100),
        (OrderSide::SELL, 50, 100),
    ];
    let (mut batch, ref_orders) = setup_batch_and_ref(&odd_plateau);
    assert_differential_parity(&mut batch, &ref_orders, oracle_price, tick_bps);
    assert_eq!(batch.clearing_tick, 50);
    assert_eq!(batch.matched_lots, 100);
}

#[test]
fn test_ten_thousand_differential_batches_gate_g2() {
    let mut rng = StdRng::seed_from_u64(0x45504F43485F4732); // "EPOCH_G2"
    let total_cases = 10_000;
    let adversarial_cases = 2_000;
    let random_cases = total_cases - adversarial_cases;

    let mut crossing_trades_count = 0;
    let mut no_trades_count = 0;
    let mut total_orders_evaluated = 0usize;
    let mut total_lots_matched = 0u64;

    for i in 0..total_cases {
        let is_adversarial = i < adversarial_cases;
        let oracle_price = rng.gen_range(20_000_000..=500_000_000); // $20 to $500
        let tick_bps = rng.gen_range(1..=5);

        let num_orders = if is_adversarial {
            match i % 6 {
                0 => 128,                     // Full capacity
                1 => 1,                       // Single order
                2 => rng.gen_range(2..=8),    // Small batch
                3 => rng.gen_range(64..=128), // Heavy load
                4 => 128,                     // Heavy load tie
                _ => rng.gen_range(10..=50),
            }
        } else {
            rng.gen_range(1..=128)
        };

        let mut orders = Vec::with_capacity(num_orders);

        if is_adversarial {
            match i % 6 {
                0 => {
                    // All orders on a single random tick
                    let single_tick = rng.gen_range(0..K_TICKS as u16);
                    for _ in 0..num_orders {
                        let side = rng.gen_range(0..=1);
                        let lots = rng.gen_range(10..=500);
                        orders.push((side, single_tick, lots));
                    }
                }
                1 => {
                    // One-sided book (all bids or all asks)
                    let side = rng.gen_range(0..=1);
                    for _ in 0..num_orders {
                        let tick = rng.gen_range(0..K_TICKS as u16);
                        let lots = rng.gen_range(10..=500);
                        orders.push((side, tick, lots));
                    }
                }
                2 => {
                    // Extreme lot disparities (1 lot vs 100,000 lots)
                    for k in 0..num_orders {
                        let side = (k % 2) as u8;
                        let tick = if side == 0 {
                            rng.gen_range(50..=70)
                        } else {
                            rng.gen_range(30..=50)
                        };
                        let lots = if k % 3 == 0 {
                            rng.gen_range(50_000..=500_000)
                        } else {
                            rng.gen_range(1..=10)
                        };
                        orders.push((side, tick, lots));
                    }
                }
                3 => {
                    // Perfect symmetric tie around center tick c=50
                    for _k in 0..(num_orders / 2) {
                        let offset = rng.gen_range(1..=20);
                        let lots = rng.gen_range(10..=200);
                        orders.push((OrderSide::BUY, 50 + offset, lots));
                        orders.push((OrderSide::SELL, 50 - offset, lots));
                    }
                    if orders.is_empty() {
                        orders.push((OrderSide::BUY, 55, 100));
                        orders.push((OrderSide::SELL, 45, 100));
                    }
                }
                4 => {
                    // High-density marginal tick dust stress (many orders at same tick)
                    let marginal_tick = rng.gen_range(45..=55);
                    for _ in 0..num_orders {
                        let side = rng.gen_range(0..=1);
                        let tick = if rng.gen_bool(0.7) {
                            marginal_tick
                        } else {
                            rng.gen_range(0..K_TICKS as u16)
                        };
                        let lots = rng.gen_range(10..=100);
                        orders.push((side, tick, lots));
                    }
                }
                _ => {
                    // Plateau intervals straddling center tick [48..52]
                    for _ in 0..num_orders {
                        let side = rng.gen_range(0..=1);
                        let tick = rng.gen_range(47..=53);
                        let lots = rng.gen_range(10..=200);
                        orders.push((side, tick, lots));
                    }
                }
            }
        } else {
            // General randomized distribution across K=101 ticks
            for _ in 0..num_orders {
                let side = rng.gen_range(0..=1);
                let tick = rng.gen_range(0..K_TICKS as u16);
                let lots = rng.gen_range(1..=10_000);
                orders.push((side, tick, lots));
            }
        }

        total_orders_evaluated += orders.len();

        let (mut batch, ref_orders) = setup_batch_and_ref(&orders);
        assert_differential_parity(&mut batch, &ref_orders, oracle_price, tick_bps);

        if batch.matched_lots > 0 {
            crossing_trades_count += 1;
            total_lots_matched += batch.matched_lots;
        } else {
            no_trades_count += 1;
        }
    }

    println!("\n=== Gate G2 Differential Test Report ===");
    println!("Total Batches Evaluated: {}", total_cases);
    println!("- Adversarial Edge Batches: {}", adversarial_cases);
    println!("- Random Distribution Batches: {}", random_cases);
    println!("Total Orders Processed: {}", total_orders_evaluated);
    println!("Crossing Trade Batches: {}", crossing_trades_count);
    println!("Zero-Trade Batches: {}", no_trades_count);
    println!("Total Lots Matched: {}", total_lots_matched);
    println!("Mismatches: 0");
    println!("Result: PASSED (Gate G2 Approved)\n");

    // Write Gate G2 evidence report to evidence/diff.json
    let evidence_dir = Path::new("../../evidence");
    if evidence_dir.exists() {
        let diff_report = format!(
            r#"{{
  "description": "Gate G2 Differential Test Report (D-1)",
  "timestamp": "2026-10-02T06:00:00Z",
  "status": "PASSED",
  "total_batches_tested": {},
  "mismatches": 0,
  "adversarial_edge_batches": {},
  "random_distribution_batches": {},
  "total_orders_processed": {},
  "crossing_trade_batches": {},
  "zero_trade_batches": {},
  "total_lots_matched": {},
  "gate_g2_decision": "PASSED",
  "gate_g2_summary": "10,000 batches executed through both programs/epoch and crates/epoch-ref with 0 mismatches across all clearing and order fill fields.",
  "label": "MEASURED"
}}
"#,
            total_cases,
            adversarial_cases,
            random_cases,
            total_orders_evaluated,
            crossing_trades_count,
            no_trades_count,
            total_lots_matched
        );

        let _ = fs::write(evidence_dir.join("diff.json"), diff_report);
    }
}
