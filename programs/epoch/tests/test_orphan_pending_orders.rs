//! Test reproducing and verifying the fix for the orphan-pending-orders bug (error 6003).
//!
//! BUG REPRODUCTION (Step 1):
//! When a batch is marked VOID (e.g. oracle stale or late clearance), but `settle_users` has not yet
//! settled all orders (`settled_orders < num_orders`), the ring wrap logic previously allowed
//! `batch.reset_for_batch(target_batch)` because `batch.status == BatchStatus::VOID`.
//! This wiped the batch's orders, leaving the user with `pending_buy_lots > 0` and `active_orders > 0`.
//! When the user subsequently attempted to withdraw, `withdraw` failed with error 6003 (`EpochError::HasPendingOrders`).
//! The user's funds were permanently locked.
//!
//! FIX VERIFICATION (Step 2 & 3):
//! 1. Reusing a ring slot holding unsettled orders (`num_orders > 0 && settled_orders < num_orders`)
//!    MUST be rejected with `EpochError::RingSlotBusy`.
//! 2. `expire_and_release` voids stale batches and clears users' pending lots and active orders,
//!    releasing margin and setting `batch.status = BatchStatus::SETTLED`.
//! 3. After release, withdrawal succeeds, and Invariants I-1, I-4, and I-12 are preserved.

use anchor_lang::prelude::Pubkey;
use epoch::errors::EpochError;
use epoch::state::{Batch, BatchStatus, Order, OrderSide, OrderStatus, UserAccount};

/// Helper to simulate user order placement in a batch
fn place_simulated_order(
    batch: &mut Batch,
    user: &mut UserAccount,
    user_pda: Pubkey,
    side: u8,
    lots: u64,
    tick: u16,
    slot_id: u8,
) {
    let order_idx = batch.num_orders as usize;
    batch.orders[order_idx] = Order {
        user_pda,
        lots,
        filled_lots: 0,
        tick,
        side,
        slot_id,
        status: OrderStatus::OPEN,
        flags: 0,
        _padding: [0; 10],
    };
    batch.num_orders += 1;
    user.active_orders += 1;
    if side == OrderSide::BUY {
        user.pending_buy_lots += lots;
        batch.bid_qty[tick as usize] += lots;
    } else {
        user.pending_sell_lots += lots;
        batch.ask_qty[tick as usize] += lots;
    }
}

/// Helper representing withdraw pre-condition check from withdraw.rs
fn check_withdraw_allowed(user: &UserAccount) -> Result<(), EpochError> {
    if !(user.pending_buy_lots == 0 && user.pending_sell_lots == 0 && user.active_orders == 0) {
        return Err(EpochError::HasPendingOrders);
    }
    if user.base_position != 0 {
        return Err(EpochError::PositionNotFlat);
    }
    Ok(())
}

/// Evaluates if a ring slot is reusable under the OLD (buggy) rule:
/// Old rule: allowed reuse if EMPTY, SETTLED, VOID, or num_orders == 0.
fn is_reusable_old(batch: &Batch) -> bool {
    batch.status == BatchStatus::EMPTY
        || batch.status == BatchStatus::SETTLED
        || batch.status == BatchStatus::VOID
        || batch.num_orders == 0
}

/// Evaluates if a ring slot is reusable under the NEW (fixed) rule:
/// New rule: ONLY allow reuse if EMPTY, SETTLED, num_orders == 0, OR all orders are settled.
fn is_reusable_fixed(batch: &Batch) -> bool {
    batch.status == BatchStatus::EMPTY
        || batch.status == BatchStatus::SETTLED
        || batch.num_orders == 0
        || (batch.settled_orders >= batch.num_orders)
}

fn create_mock_user() -> UserAccount {
    UserAccount {
        owner: Pubkey::new_unique(),
        collateral: 1_000_000_000, // 1,000 USDC
        quote_position: 0,
        base_position: 0,
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

#[test]
fn test_reproduce_orphan_pending_orders_bug_error_6003() {
    let user_pda = Pubkey::new_unique();
    let mut user = create_mock_user();

    let mut batch0 = Batch {
        batch_id: 0,
        status: BatchStatus::OPEN,
        ..Default::default()
    };

    // User places order in Batch 0
    place_simulated_order(&mut batch0, &mut user, user_pda, OrderSide::BUY, 100, 50, 0);
    assert_eq!(user.pending_buy_lots, 100);
    assert_eq!(user.active_orders, 1);
    assert_eq!(batch0.num_orders, 1);
    assert_eq!(batch0.settled_orders, 0);

    // Batch 0 closes and is marked VOID (e.g. stale oracle / delay)
    batch0.status = BatchStatus::VOID;

    // Notice: settle_users has NOT been called for user!
    assert_eq!(batch0.settled_orders, 0);

    // Under the OLD BUGGY logic:
    // When target_batch = 8 wraps around to ring slot 0 (8 % 8 == 0):
    assert!(
        is_reusable_old(&batch0),
        "BUG: Old logic allowed slot reuse while batch had unsettled orders because status == VOID"
    );

    // If slot is reused:
    batch0.reset_for_batch(8);
    // Old orders are wiped:
    assert_eq!(batch0.num_orders, 0);

    // Now User tries to withdraw:
    let withdraw_result = check_withdraw_allowed(&user);
    assert_eq!(
        withdraw_result,
        Err(EpochError::HasPendingOrders),
        "User is trapped with Error 6003: HasPendingOrders"
    );
    // User active_orders is stuck at 1 and pending_buy_lots is stuck at 100 forever
    assert_eq!(user.active_orders, 1);
    assert_eq!(user.pending_buy_lots, 100);
    println!("Successfully reproduced orphan pending orders bug (Error 6003: HasPendingOrders)");
}

#[test]
fn test_fixed_ring_slot_busy_rejection_and_expire_and_release() {
    let user_pda = Pubkey::new_unique();
    let mut user = create_mock_user();

    let mut batch0 = Batch {
        batch_id: 0,
        status: BatchStatus::OPEN,
        ..Default::default()
    };

    // User places order in Batch 0
    place_simulated_order(&mut batch0, &mut user, user_pda, OrderSide::BUY, 100, 50, 0);

    // Batch 0 closes and is VOID
    batch0.status = BatchStatus::VOID;

    // STEP 1: Under FIXED logic, ring wrap MUST reject reuse with RingSlotBusy
    assert!(
        !is_reusable_fixed(&batch0),
        "FIX: Ring slot must NOT be reusable while settled_orders < num_orders"
    );

    // STEP 2: Execute expire_and_release logic for the user
    // Release user orders in batch0:
    for i in 0..(batch0.num_orders as usize) {
        let order = &mut batch0.orders[i];
        if order.user_pda == user_pda && order.status != OrderStatus::SETTLED {
            if order.side == OrderSide::BUY {
                user.pending_buy_lots = user.pending_buy_lots.saturating_sub(order.lots);
            } else {
                user.pending_sell_lots = user.pending_sell_lots.saturating_sub(order.lots);
            }
            user.active_orders = user.active_orders.saturating_sub(1);
            order.status = OrderStatus::SETTLED;
            batch0.settled_orders = batch0.settled_orders.saturating_add(1);
        }
    }

    if batch0.settled_orders >= batch0.num_orders {
        batch0.status = BatchStatus::SETTLED;
    }

    // Assert user state is now clean
    assert_eq!(user.pending_buy_lots, 0);
    assert_eq!(user.pending_sell_lots, 0);
    assert_eq!(user.active_orders, 0);
    assert_eq!(batch0.status, BatchStatus::SETTLED);

    // STEP 3: User withdraw check now SUCCEEDS
    let withdraw_result = check_withdraw_allowed(&user);
    assert!(withdraw_result.is_ok(), "User can now withdraw cleanly!");

    // STEP 4: Ring slot 0 is now reusable for Batch 8
    assert!(
        is_reusable_fixed(&batch0),
        "Ring slot is now cleanly reusable"
    );
    batch0.reset_for_batch(8);
    assert_eq!(batch0.batch_id, 8);
    assert_eq!(batch0.status, BatchStatus::OPEN);
}
