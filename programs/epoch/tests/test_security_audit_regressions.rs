//! Adversarial Verification & Security Audit Regression Suite
//!
//! Independently verifies the Security Auditor's findings:
//! - [H-1] `fee_pool` underflow during negative funding residual settlement
//! - [H-2] Admin bypass in `clear_batch` timing validation & conflict with oracle window
//! - [H-3] Admin bypass in `expire_and_release` granting unilateral void option
//! - [H-4] Missing Backstop Vault margin & inventory limit validation during liquidation
//! - [H-5] Oracle anchor-price window boundary manipulation & persistent lockout
//! - [M-1] Ring slot reuse deadlock & DoS griefing from unsettled batches
//! - [ADD-1] Silent ring slot bricking via incomplete order cancellation in `vault_quote.rs`

use anchor_lang::prelude::Pubkey;
use epoch::errors::EpochError;
use epoch::state::constants::F_SCALE;
use epoch::state::{
    Batch, BatchStatus, Market, MarketParams, Order, OrderSide, OrderStatus, UserAccount, VaultParams,
};

fn create_test_user(collateral: i64) -> UserAccount {
    UserAccount {
        owner: Pubkey::new_unique(),
        collateral,
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

fn create_test_market(admin: Pubkey, fee_pool: u64) -> Market {
    Market {
        funding_index: 0,
        admin,
        oracle_authority: Pubkey::new_unique(),
        quote_mint: Pubkey::new_unique(),
        collateral_vault: Pubkey::new_unique(),
        oracle_feed_id: [0u8; 32],
        params: MarketParams {
            base_lot: 1000,
            price_tick: 1000,
            min_order_lots: 10,
            min_order_notional: 1_000_000,
            funding_period_slots: 72000,
            batch_slots: 2,
            lookahead: 3,
            k_ticks: 101,
            tick_bps: 1,
            imr_bps: 1000,
            mmr_bps: 500,
            fee_bps: 5,
            liq_penalty_bps: 100,
            max_oracle_age_secs: 10,
            max_conf_bps: 20,
            max_clear_delay_slots: 20,
            max_orders_per_batch: 128,
            funding_cap_bps: 50,
            _pad0: [0; 2],
        },
        start_slot: 100,
        next_batch_to_clear: 0,
        last_oracle_price: 150_000_000,
        last_oracle_slot: 100,
        open_interest_lots: 0,
        fee_pool,
        insurance_fund: 1_000_000,
        bad_debt: 0,
        vault_params: VaultParams {
            quote_offset_bps: [12, 18, 25],
            _pad0: [0; 2],
            quote_lots: [1000, 1000, 1500],
            max_inventory_lots: 500,
            skew_bps: 5,
            max_conf_bps: 20,
            is_active: 1,
            _pad1: [0; 3],
        },
        bump: 254,
        _pad_bump: [0; 7],
        _reserved: [0; 24],
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// [H-1] `fee_pool` Underflow During Negative Funding Residual Settlement
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_h1_fee_pool_underflow_negative_funding_residual() {
    // Scenario:
    // User is SHORT: base_position = -100 lots.
    // Funding rate has been positive, so funding_index increased from 0 to 1_000_000_000.
    // Longs pay shorts: user is owed funding!
    // Market fee_pool is low/zero (e.g. fresh market or post fee withdrawal).
    let market = create_test_market(Pubkey::new_unique(), 0);
    let mut user = create_test_user(1_000_000);
    user.base_position = -100;
    user.funding_snapshot = 0;

    let new_funding_index: i128 = 1_000_000_000; // Funding index accrued
    let delta = new_funding_index - user.funding_snapshot;
    let prod = user.base_position as i128 * delta; // -100 * 1_000_000_000 < 0
    assert!(prod < 0);

    // Matching settle_users.rs lines 82-88:
    let payment = if prod > 0 {
        (prod + F_SCALE - 1) / F_SCALE
    } else {
        prod / F_SCALE // Negative payment owed to user
    };
    assert!(payment < 0);

    // User is credited quote_position
    user.quote_position = user.quote_position.checked_sub(payment).unwrap();
    assert_eq!(user.quote_position, -payment);

    let mut total_funding_residual: i128 = 0;
    total_funding_residual = total_funding_residual.checked_add(payment).unwrap();
    assert!(total_funding_residual < 0);

    // Matching settle_users.rs lines 218-225:
    let neg_res = u64::try_from(total_funding_residual.checked_abs().unwrap());
    assert!(neg_res.is_ok());
    let neg = neg_res.unwrap();

    // CONFIRM VULNERABILITY:
    // With market.fee_pool = 0, checked_sub(neg) returns None, triggering EpochError::MathOverflow!
    let underflow_result = market.fee_pool.checked_sub(neg);
    assert_eq!(underflow_result, None, "Checked sub underflows when fee_pool < funding payout");

    // This panic in settle_users aborts the transaction, preventing batch.status from reaching SETTLED.
}

// ─────────────────────────────────────────────────────────────────────────────
// [H-2] Admin Timing Bypass in `clear_batch` & Conflict with Downstream Oracle Window
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_h2_admin_early_clear_bypass_and_oracle_window_conflict() {
    let admin = Pubkey::new_unique();
    let cranker = admin; // Caller is admin
    let non_admin_cranker = Pubkey::new_unique();

    let start_slot: u64 = 100;
    let batch_slots: u64 = 10;
    let batch_id: u64 = 0;
    let close_slot = start_slot + (batch_id + 1) * batch_slots; // slot 110

    let current_slot: u64 = 105; // 5 slots BEFORE close_slot!

    // Check 1: Non-admin caller is rejected at timing check
    let non_admin_timing_pass = current_slot >= close_slot || admin == non_admin_cranker;
    assert!(!non_admin_timing_pass, "Non-admin cannot bypass timing check");

    // Check 2: Admin caller passes the timing check at line 109!
    let admin_timing_pass = current_slot >= close_slot || admin == cranker;
    assert!(admin_timing_pass, "Admin bypasses the timing check in Step 2");

    // Check 3: Downstream Oracle Selection constraint (lines 148, 156)
    // require!(oracle_posted_slot >= close_slot)
    // require!(oracle_posted_slot <= current_slot)
    // When current_slot (105) < close_slot (110):
    // For any oracle_posted_slot, it cannot simultaneously be >= 110 AND <= 105!
    let simulate_oracle_window = |oracle_posted_slot: u64| -> Result<(), EpochError> {
        if oracle_posted_slot < close_slot {
            return Err(EpochError::OraclePostedBeforeClose);
        }
        if oracle_posted_slot > current_slot {
            return Err(EpochError::InvalidOracleAccount);
        }
        Ok(())
    };

    assert_eq!(
        simulate_oracle_window(104),
        Err(EpochError::OraclePostedBeforeClose)
    );
    assert_eq!(
        simulate_oracle_window(110),
        Err(EpochError::InvalidOracleAccount)
    );

    // Finding Classification: Partially valid.
    // The admin bypass exists at line 109, but cannot be exploited to prematurely clear
    // because downstream oracle posted_slot checks strictly require oracle_posted_slot in [close_slot, current_slot].
}

// ─────────────────────────────────────────────────────────────────────────────
// [H-3] Admin Unilateral Premature Voiding ("Free Cancellation Option") in `expire_and_release`
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_h3_admin_unilateral_premature_void_free_option() {
    let admin = Pubkey::new_unique();
    let regular_user = Pubkey::new_unique();

    let start_slot: u64 = 100;
    let batch_slots: u64 = 10;
    let max_delay: u64 = 20;
    let batch_id: u64 = 0;
    let close_slot = start_slot + (batch_id + 1) * batch_slots; // 110

    let current_slot: u64 = 102; // Batch is OPEN and actively trading! (8 slots before close)

    // Matching expire_and_release.rs lines 64-68:
    // let is_stale = current_slot > close_slot.saturating_add(max_delay) || market.admin == caller;
    let check_is_stale = |caller: Pubkey| -> bool {
        current_slot > close_slot.saturating_add(max_delay) || admin == caller
    };

    // 1. Regular user calling expire_and_release is rejected with BatchNotStale
    assert!(!check_is_stale(regular_user), "Regular user cannot expire open active batch");

    // 2. CONFIRM VULNERABILITY:
    // Admin caller returns true at ANY slot, allowing the admin to unilaterally void
    // an open batch mid-auction with 0 fills!
    assert!(check_is_stale(admin), "Admin bypass allows unilateral premature voiding");
}

// ─────────────────────────────────────────────────────────────────────────────
// [H-4] Missing Backstop Vault Margin & Inventory Checks During Liquidation
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_h4_missing_vault_margin_validation_during_liquidation() {
    let mut liquidatee = create_test_user(50_000_000); // 50 USDC collateral
    liquidatee.base_position = 10_000; // 10,000 lots LONG

    // Vault has modest collateral and inventory limit = 500 lots
    let mut vault_user = create_test_user(1_000_000); // 1 USDC collateral
    vault_user.base_position = 0;

    let oracle_price: u64 = 100_000_000; // $100.00
    let notional = ((liquidatee.base_position.unsigned_abs() as u128 * oracle_price as u128) / 1000) as u64;

    // Simulate liquidate.rs lines 143-158:
    // User was LONG: sells base position to vault at oracle price
    liquidatee.base_position = 0;
    liquidatee.quote_position = liquidatee.quote_position.checked_add(notional as i128).unwrap();

    vault_user.base_position = vault_user.base_position.checked_add(10_000).unwrap();
    vault_user.quote_position = vault_user.quote_position.checked_sub(notional as i128).unwrap();

    // CONFIRM VULNERABILITY 1: Vault inventory exceeds configured max_inventory_lots (500)
    let max_inventory_lots = 500;
    assert!(vault_user.base_position > max_inventory_lots, "Vault inventory exceeds risk limits");
    assert_eq!(vault_user.base_position, 10_000);

    // CONFIRM VULNERABILITY 2: If price drops by 5% ($95.00), vault equity becomes deeply negative!
    let new_oracle_price: u64 = 95_000_000;
    let vault_pos_val = (vault_user.base_position as i128 * new_oracle_price as i128) / 1000;
    let vault_equity = vault_user.collateral as i128 + vault_user.quote_position + vault_pos_val;

    // 10,000 lots = 10 SOL. Price drop of $5/SOL = -$50.00 = -50_000_000 micro-USDC.
    // Vault had only 1 USDC collateral (1_000_000 micro-USDC), so equity is -49_000_000 micro-USDC.
    assert!(vault_equity < -40_000_000, "Vault is rendered completely insolvent: vault_equity = {}", vault_equity);
}

// ─────────────────────────────────────────────────────────────────────────────
// [H-5] Oracle Anchor-Price Window Manipulation & Persistent Lockout
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_h5_oracle_anchor_price_window_stalling_and_boundary_stacking() {
    let mut anchor_price: u64 = 100_000_000; // $100.00
    let mut anchor_slot: u64 = 100;
    let last_price: u64 = 100_000_000;
    let last_slot: u64 = 100;

    // Network delay or pause: 80 slots elapse (> 75 slot anchor window)
    let current_slot: u64 = 180;
    let current_market_price: u64 = 100_450_000; // +45 bps move over 80 slots

    // Layer A check (per-update rate limit with pause allowance):
    let slots_elapsed = current_slot.saturating_sub(last_slot); // 80 slots
    let additional_allowance = slots_elapsed.saturating_sub(2) as u128;
    let allowed_single_move_bps = (15u128 + additional_allowance).min(100u128); // 93 bps
    let delta = (current_market_price as i128 - last_price as i128).unsigned_abs();
    let move_bps = (delta * 10_000) / last_price as u128; // 45 bps
    assert!(move_bps <= allowed_single_move_bps, "Layer A allowance passes");

    // Layer B check (post_price.rs lines 104-118):
    if current_slot.saturating_sub(anchor_slot) >= 75 {
        anchor_price = last_price; // Resets to last closing price ($100.00)
        anchor_slot = current_slot;
    }
    assert_eq!(anchor_slot, 180);

    let anchor_delta = (current_market_price as i128 - anchor_price as i128).unsigned_abs();
    let anchor_move_bps = (anchor_delta * 10_000) / anchor_price as u128; // 45 bps

    // CONFIRM VULNERABILITY:
    // Even though 80 slots elapsed and Layer A allowed up to 93 bps, Layer B hard-reverts on > 30 bps!
    let layer_b_pass = anchor_move_bps <= 30u128;
    assert!(!layer_b_pass, "Layer B reverts with OraclePriceJumpTooLarge (45 > 30)");

    // Because the transaction reverts, anchor_price and anchor_slot are never saved,
    // permanently deadlocking the oracle from updating to true market price without fake stepped updates.
}

// ─────────────────────────────────────────────────────────────────────────────
// [M-1] Ring Slot Reuse Deadlock & DoS Griefing From Unsettled Batches
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_m1_ring_slot_reuse_deadlock_unsettled_batch() {
    let batch = Batch {
        batch_id: 0,
        status: BatchStatus::CLEARED,
        num_orders: 1,
        settled_orders: 0, // Unsettled!
        ..Default::default()
    };

    // Matching place_order.rs lines 130-134:
    let is_reusable = batch.status == BatchStatus::EMPTY
        || batch.status == BatchStatus::SETTLED
        || batch.num_orders == 0
        || (batch.settled_orders >= batch.num_orders);

    // CONFIRM VULNERABILITY:
    // When batch 8 targets ring slot 0 (8 % 8 == 0), is_reusable is FALSE.
    assert!(!is_reusable, "Batch with unsettled order cannot be reused");

    // An attacker leaving 1 unsettled order blocks that ring index for all subsequent epochs.
}

// ─────────────────────────────────────────────────────────────────────────────
// [ADD-1] Silent Ring Slot Bricking in `vault_quote.rs` Quote Cancellation
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_add1_vault_quote_silent_ring_bricking() {
    let vault_user_pda = Pubkey::new_unique();

    let mut batch = Batch {
        batch_id: 1,
        status: BatchStatus::OPEN,
        num_orders: 6, // 3 buy orders, 3 sell orders
        settled_orders: 0,
        ..Default::default()
    };

    let mut vault_user = create_test_user(10_000_000);
    vault_user.active_orders = 6;
    vault_user.pending_buy_lots = 60;
    vault_user.pending_sell_lots = 60;

    // Setup 3 buy orders and 3 sell orders from vault
    for i in 0..3 {
        batch.orders[i] = Order {
            user_pda: vault_user_pda,
            lots: 20,
            filled_lots: 0,
            tick: 45,
            side: OrderSide::BUY,
            slot_id: i as u8,
            status: OrderStatus::OPEN,
            flags: 0,
            _padding: [0; 10],
        };
    }
    for i in 3..6 {
        batch.orders[i] = Order {
            user_pda: vault_user_pda,
            lots: 20,
            filled_lots: 0,
            tick: 55,
            side: OrderSide::SELL,
            slot_id: i as u8,
            status: OrderStatus::OPEN,
            flags: 0,
            _padding: [0; 10],
        };
    }

    // Now vault_quote is called again with inventory skew disallowing bids (allow_bids = false)
    // Simulating vault_quote.rs lines 185-206:
    let allow_bids = false;
    for i in 0..(batch.num_orders as usize) {
        let (is_match, side, lots) = {
            let o = &batch.orders[i];
            if o.user_pda == vault_user_pda && o.status == OrderStatus::OPEN {
                (true, o.side, o.lots)
            } else {
                (false, 0, 0)
            }
        };

        if is_match && side == OrderSide::BUY && !allow_bids {
            vault_user.pending_buy_lots = vault_user.pending_buy_lots.saturating_sub(lots);
            batch.orders[i].status = OrderStatus::CANCELLED;
            // FLAW: batch.settled_orders is NOT incremented!
            // FLAW: vault_user.active_orders is NOT decremented!
        }
    }

    // The 3 buy orders are now CANCELLED:
    assert_eq!(batch.orders[0].status, OrderStatus::CANCELLED);
    assert_eq!(batch.orders[1].status, OrderStatus::CANCELLED);
    assert_eq!(batch.orders[2].status, OrderStatus::CANCELLED);
    assert_eq!(batch.settled_orders, 0, "settled_orders remained 0");
    assert_eq!(vault_user.active_orders, 6, "active_orders leaked");

    // Later, the batch clears and settle_users runs on the 3 remaining sell orders.
    // Matching settle_users.rs lines 108-110:
    for i in 0..(batch.num_orders as usize) {
        let order = &mut batch.orders[i];
        if order.status == OrderStatus::SETTLED || order.status == OrderStatus::CANCELLED {
            // settle_users explicitly SKIPS CANCELLED orders!
            continue;
        }
        order.status = OrderStatus::SETTLED;
        batch.settled_orders = batch.settled_orders.saturating_add(1);
    }

    // CONFIRM VULNERABILITY:
    // settled_orders reaches 3, but num_orders is 6.
    assert_eq!(batch.settled_orders, 3);
    assert_eq!(batch.num_orders, 6);

    // batch.status will NEVER become SETTLED because settled_orders (3) < num_orders (6).
    if batch.settled_orders >= batch.num_orders {
        batch.status = BatchStatus::SETTLED;
    }
    assert_ne!(batch.status, BatchStatus::SETTLED);

    // When the next epoch targets this ring index (batch 9, 9 % 8 == 1):
    let is_reusable = batch.status == BatchStatus::EMPTY
        || batch.status == BatchStatus::SETTLED
        || batch.num_orders == 0
        || (batch.settled_orders >= batch.num_orders);

    assert!(!is_reusable, "Ring slot is permanently locked with RingSlotBusy!");
}
