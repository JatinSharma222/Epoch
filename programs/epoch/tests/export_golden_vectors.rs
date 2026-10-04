use epoch::instructions::clear_batch::execute_batch_auction;
use epoch::state::constants::{CENTER_TICK, K_TICKS, MAX_ORDERS, PRICE_TICK};
use epoch::state::{Batch, BatchStatus, Order, OrderSide, OrderStatus};
use epoch_ref::{allocate_order_fills, clear, clearing_price, OrderRef};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use std::fs;
use std::path::Path;

#[test]
fn export_golden_vectors_t29() {
    let mut rng = StdRng::seed_from_u64(0x5432395F474F4C44); // "T29_GOLD"
    let total_cases = 1_000;

    let mut vectors_json = Vec::new();

    // 1. Worked example from spec §6
    let c = CENTER_TICK as u16;
    let mut worked_bid_qty = vec![0u64; K_TICKS];
    let mut worked_ask_qty = vec![0u64; K_TICKS];
    worked_bid_qty[(c + 5) as usize] = 10;
    worked_bid_qty[(c + 3) as usize] = 20;
    worked_bid_qty[c as usize] = 15;
    worked_bid_qty[(c - 2) as usize] = 30;
    worked_ask_qty[(c - 4) as usize] = 12;
    worked_ask_qty[c as usize] = 18;
    worked_ask_qty[(c + 3) as usize] = 25;
    worked_ask_qty[(c + 6) as usize] = 10;

    let worked_orders = vec![
        OrderRef { side: 0, tick: c + 5, lots: 10 },
        OrderRef { side: 0, tick: c + 3, lots: 20 },
        OrderRef { side: 0, tick: c, lots: 15 },
        OrderRef { side: 0, tick: c - 2, lots: 30 },
        OrderRef { side: 1, tick: c - 4, lots: 12 },
        OrderRef { side: 1, tick: c, lots: 18 },
        OrderRef { side: 1, tick: c + 3, lots: 25 },
        OrderRef { side: 1, tick: c + 6, lots: 10 },
    ];

    let worked_res = clear(&worked_bid_qty, &worked_ask_qty).unwrap();
    let worked_fills = allocate_order_fills(&worked_orders, &worked_res);
    let worked_price = clearing_price(150_000_000, worked_res.tick, K_TICKS as u16, 1, PRICE_TICK);

    vectors_json.push(format!(
        r#"{{
    "id": "worked_example_spec_6",
    "oracle_price": 150000000,
    "tick_bps": 1,
    "k_ticks": 101,
    "bid_qty": {:?},
    "ask_qty": {:?},
    "orders": [{}],
    "expected": {{
      "cleared": true,
      "clearing_tick": {},
      "clearing_price": {},
      "matched_lots": {},
      "bid_marginal_tick": {},
      "bid_marginal_alloc": {},
      "bid_marginal_total": {},
      "ask_marginal_tick": {},
      "ask_marginal_alloc": {},
      "ask_marginal_total": {},
      "order_fills": {:?}
    }}
  }}"#,
        worked_bid_qty,
        worked_ask_qty,
        worked_orders
            .iter()
            .map(|o| format!(r#"{{"side":{},"tick":{},"lots":{}}}"#, o.side, o.tick, o.lots))
            .collect::<Vec<_>>()
            .join(","),
        worked_res.tick,
        worked_price,
        worked_res.matched,
        worked_res.bid.tick,
        worked_res.bid.alloc,
        worked_res.bid.total,
        worked_res.ask.tick,
        worked_res.ask.alloc,
        worked_res.ask.total,
        worked_fills
    ));

    // 2. 1,000 random batches (including adversarial edges)
    for i in 1..=total_cases {
        let mut bid_qty = vec![0u64; K_TICKS];
        let mut ask_qty = vec![0u64; K_TICKS];
        let num_orders = rng.gen_range(2..=30);
        let oracle_price = rng.gen_range(20_000_000..=500_000_000);
        let tick_bps = 1u16;

        let mut orders = Vec::with_capacity(num_orders);
        for _ in 0..num_orders {
            let side = rng.gen_range(0..=1);
            let tick = rng.gen_range(40..=60);
            let lots = rng.gen_range(1..=100);
            if side == 0 {
                bid_qty[tick as usize] += lots;
            } else {
                ask_qty[tick as usize] += lots;
            }
            orders.push(OrderRef { side, tick, lots });
        }

        let clear_opt = clear(&bid_qty, &ask_qty);
        match clear_opt {
            None => {
                vectors_json.push(format!(
                    r#"{{
    "id": "random_{}",
    "oracle_price": {},
    "tick_bps": {},
    "k_ticks": 101,
    "bid_qty": {:?},
    "ask_qty": {:?},
    "orders": [{}],
    "expected": {{
      "cleared": false,
      "clearing_tick": 50,
      "clearing_price": {},
      "matched_lots": 0,
      "bid_marginal_tick": 0,
      "bid_marginal_alloc": 0,
      "bid_marginal_total": 0,
      "ask_marginal_tick": 0,
      "ask_marginal_alloc": 0,
      "ask_marginal_total": 0,
      "order_fills": {:?}
    }}
  }}"#,
                    i,
                    oracle_price,
                    tick_bps,
                    bid_qty,
                    ask_qty,
                    orders
                        .iter()
                        .map(|o| format!(r#"{{"side":{},"tick":{},"lots":{}}}"#, o.side, o.tick, o.lots))
                        .collect::<Vec<_>>()
                        .join(","),
                    oracle_price,
                    vec![0u64; orders.len()]
                ));
            }
            Some(res) => {
                let fills = allocate_order_fills(&orders, &res);
                let price = clearing_price(oracle_price, res.tick, K_TICKS as u16, tick_bps, PRICE_TICK);
                vectors_json.push(format!(
                    r#"{{
    "id": "random_{}",
    "oracle_price": {},
    "tick_bps": {},
    "k_ticks": 101,
    "bid_qty": {:?},
    "ask_qty": {:?},
    "orders": [{}],
    "expected": {{
      "cleared": true,
      "clearing_tick": {},
      "clearing_price": {},
      "matched_lots": {},
      "bid_marginal_tick": {},
      "bid_marginal_alloc": {},
      "bid_marginal_total": {},
      "ask_marginal_tick": {},
      "ask_marginal_alloc": {},
      "ask_marginal_total": {},
      "order_fills": {:?}
    }}
  }}"#,
                    i,
                    oracle_price,
                    tick_bps,
                    bid_qty,
                    ask_qty,
                    orders
                        .iter()
                        .map(|o| format!(r#"{{"side":{},"tick":{},"lots":{}}}"#, o.side, o.tick, o.lots))
                        .collect::<Vec<_>>()
                        .join(","),
                    res.tick,
                    price,
                    res.matched,
                    res.bid.tick,
                    res.bid.alloc,
                    res.bid.total,
                    res.ask.tick,
                    res.ask.alloc,
                    res.ask.total,
                    fills
                ));
            }
        }
    }

    let final_json = format!("[\n{}\n]\n", vectors_json.join(",\n"));
    let evidence_path = Path::new("../../evidence/golden_vectors.json");
    if let Some(parent) = evidence_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(evidence_path, &final_json).expect("Failed to write golden vectors");
    println!("Exported {} golden vectors to evidence/golden_vectors.json", vectors_json.len());
}
