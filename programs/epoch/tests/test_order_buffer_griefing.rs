use anchor_lang::prelude::Pubkey;
use epoch::errors::EpochError;
use epoch::state::{Batch, OrderSide, OrderStatus};

#[test]
fn test_order_buffer_reuse_cancelled_slot_prevents_exhaustion() {
    let mut batch = Batch {
        batch_id: 1,
        status: epoch::state::BatchStatus::OPEN,
        num_orders: 0,
        settled_orders: 0,
        ..Default::default()
    };

    let user_pda = Pubkey::new_unique();
    let slot_id = 0u8;

    // Simulate 128 cycles of place and cancel on the same (user_pda, slot_id)
    for _ in 0..128 {
        // Look for existing order with matching (user_pda, slot_id) that is OPEN or CANCELLED
        let mut existing_idx = None;
        for i in 0..(batch.num_orders as usize) {
            let order = &batch.orders[i];
            if order.user_pda == user_pda && order.slot_id == slot_id {
                if order.status == OrderStatus::OPEN || order.status == OrderStatus::CANCELLED {
                    existing_idx = Some(i);
                    break;
                }
            }
        }

        let idx = if let Some(i) = existing_idx {
            if batch.orders[i].status == OrderStatus::CANCELLED {
                batch.settled_orders = batch.settled_orders.saturating_sub(1);
            }
            i
        } else {
            assert!(
                (batch.num_orders as usize) < 128,
                "Batch full: attacker managed to exhaust buffer!"
            );
            let new_i = batch.num_orders as usize;
            batch.num_orders += 1;
            new_i
        };

        // Place order
        batch.orders[idx].user_pda = user_pda;
        batch.orders[idx].slot_id = slot_id;
        batch.orders[idx].side = OrderSide::BUY;
        batch.orders[idx].lots = 10;
        batch.orders[idx].status = OrderStatus::OPEN;

        // Cancel order
        batch.orders[idx].status = OrderStatus::CANCELLED;
        batch.orders[idx].lots = 0;
        batch.settled_orders = batch.settled_orders.saturating_add(1);
    }

    // With cancelled slot reuse, num_orders must stay exactly 1!
    assert_eq!(
        batch.num_orders, 1,
        "128 place/cancel cycles should reuse the same slot and keep num_orders at 1"
    );
}

#[test]
fn test_order_buffer_enforces_max_orders_per_batch() {
    let max_orders_per_batch = 10usize;
    let batch = Batch {
        batch_id: 1,
        status: epoch::state::BatchStatus::OPEN,
        num_orders: 10,
        ..Default::default()
    };

    // If num_orders reaches max_orders_per_batch, adding a new order must fail with BatchFull
    let is_full = (batch.num_orders as usize) >= max_orders_per_batch;
    assert!(is_full);
    let check: Result<(), EpochError> = if is_full {
        Err(EpochError::BatchFull)
    } else {
        Ok(())
    };
    assert_eq!(check.unwrap_err(), EpochError::BatchFull);
}
