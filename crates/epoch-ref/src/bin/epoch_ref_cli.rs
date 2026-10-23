use epoch_ref::{allocate_order_fills, clear, OrderRef};
use serde::{Deserialize, Serialize};
use std::io::{self, Read};

#[derive(Deserialize)]
struct InputData {
    bid_qty: Vec<u64>,
    ask_qty: Vec<u64>,
    orders: Vec<OrderInput>,
    oracle_price: u64,
    tick_bps: u16,
}

#[derive(Deserialize, Serialize, Clone, Copy)]
struct OrderInput {
    id: usize,
    side: u8,
    tick: u16,
    lots: u64,
}

#[derive(Serialize)]
struct OutputData {
    has_cleared: bool,
    clearing_tick: Option<u16>,
    clearing_price: Option<u64>,
    matched_lots: Option<u64>,
    bid_marginal_tick: Option<u16>,
    bid_marginal_alloc: Option<u64>,
    ask_marginal_tick: Option<u16>,
    ask_marginal_alloc: Option<u64>,
    fills: Vec<OrderFillResult>,
    invariant_i3_passed: bool,
    i3_details: Vec<String>,
}

#[derive(Serialize)]
struct OrderFillResult {
    order_id: usize,
    side: u8,
    limit_tick: u16,
    requested_lots: u64,
    filled_lots: u64,
}

fn main() {
    let mut buffer = String::new();
    io::stdin().read_to_string(&mut buffer).expect("Failed to read stdin");
    let input: InputData = serde_json::from_str(&buffer).expect("Invalid JSON input");

    let clear_res = clear(&input.bid_qty, &input.ask_qty);
    if let Some(res) = clear_res {
        let k = input.bid_qty.len() as u16;
        let price_tick = 1000u64; // PRICE_TICK constant
        let clearing_price = epoch_ref::clearing_price(input.oracle_price, res.tick, k, input.tick_bps, price_tick);

        let order_refs: Vec<OrderRef> = input.orders.iter().map(|o| OrderRef {
            side: o.side,
            tick: o.tick,
            lots: o.lots,
        }).collect();

        let fills = allocate_order_fills(&order_refs, &res);
        let mut order_results = Vec::new();
        let mut i3_passed = true;
        let mut i3_details = Vec::new();

        for (i, fill) in fills.iter().enumerate() {
            let order = &input.orders[i];
            order_results.push(OrderFillResult {
                order_id: order.id,
                side: order.side,
                limit_tick: order.tick,
                requested_lots: order.lots,
                filled_lots: *fill,
            });

            // Check Invariant I-3:
            // Filled buyer: limit_tick >= clearing_tick
            // Filled seller: limit_tick <= clearing_tick
            if *fill > 0 {
                if order.side == 0 { // BUY
                    let satisfies = order.tick >= res.tick;
                    if !satisfies {
                        i3_passed = false;
                        i3_details.push(format!("VIOLATION: Buyer order #{} limit tick {} < clearing tick {}", order.id, order.tick, res.tick));
                    } else {
                        i3_details.push(format!("OK: Buyer #{} limit tick {} >= clearing tick {}", order.id, order.tick, res.tick));
                    }
                } else { // SELL
                    let satisfies = order.tick <= res.tick;
                    if !satisfies {
                        i3_passed = false;
                        i3_details.push(format!("VIOLATION: Seller order #{} limit tick {} > clearing tick {}", order.id, order.tick, res.tick));
                    } else {
                        i3_details.push(format!("OK: Seller #{} limit tick {} <= clearing tick {}", order.id, order.tick, res.tick));
                    }
                }
            }
        }

        let out = OutputData {
            has_cleared: true,
            clearing_tick: Some(res.tick),
            clearing_price: Some(clearing_price),
            matched_lots: Some(res.matched),
            bid_marginal_tick: Some(res.bid.tick),
            bid_marginal_alloc: Some(res.bid.alloc),
            ask_marginal_tick: Some(res.ask.tick),
            ask_marginal_alloc: Some(res.ask.alloc),
            fills: order_results,
            invariant_i3_passed: i3_passed,
            i3_details,
        };
        println!("{}", serde_json::to_string_pretty(&out).unwrap());
    } else {
        let out = OutputData {
            has_cleared: false,
            clearing_tick: None,
            clearing_price: None,
            matched_lots: None,
            bid_marginal_tick: None,
            bid_marginal_alloc: None,
            ask_marginal_tick: None,
            ask_marginal_alloc: None,
            fills: Vec::new(),
            invariant_i3_passed: true,
            i3_details: vec!["No trade cleared".to_string()],
        };
        println!("{}", serde_json::to_string_pretty(&out).unwrap());
    }
}
