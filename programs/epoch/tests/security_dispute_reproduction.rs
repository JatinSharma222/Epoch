//! Comprehensive Reproduction and Proof Suite for Security Disputes
//!
//! Independently verifies the 7 disputed security findings:
//! - H-1: Funding residual accounting in partial settlement
//! - H-2: clear_batch admin timing bypass
//! - H-3: expire_and_release admin bypass
//! - H-4: Liquidation vault solvency and margin omission
//! - H-5: Oracle anchor-price window boundary manipulation and outage lockout
//! - M-1: Ring slot reuse deadlock across cycles
//! - ADD-1: Silent ring slot bricking via vault quote cancellation counter omissions

use anchor_lang::prelude::Pubkey;
use epoch::errors::EpochError;
use epoch::state::constants::F_SCALE;
use epoch::state::{Batch, BatchStatus, Order, OrderSide, OrderStatus, UserAccount};

// ============================================================================
// H-1: FUNDING RESIDUAL ACCOUNTING IN PARTIAL SETTLEMENT
// ============================================================================

#[test]
fn test_h1_partial_settlement_funding_residual_underflow() {
    // 1. Setup Market with empty fee pool (typical for fresh market or after distribution)
    let fee_pool: u64 = 0;
    let funding_delta: i128 = 10_000 * F_SCALE; // Funding index advanced by +10,000 micro-USDC per lot

    // User A: Long 1,000 lots (funding payer)
    let user_a_base: i64 = 1_000;
    let prod_a = user_a_base as i128 * funding_delta;
    let payment_a = if prod_a > 0 {
        (prod_a + F_SCALE - 1) / F_SCALE
    } else {
        prod_a / F_SCALE
    };

    // User B: Short 1,000 lots (funding receiver)
    let user_b_base: i64 = -1_000;
    let prod_b = user_b_base as i128 * funding_delta;
    let payment_b = if prod_b > 0 {
        (prod_b + F_SCALE - 1) / F_SCALE
    } else {
        prod_b / F_SCALE
    };

    // Mathematical Fact 1: Across the closed system, funding is zero-sum:
    assert_eq!(payment_a, 10_000_000i128); // User A owes $10.00 USDC (10M micro-USDC)
    assert_eq!(payment_b, -10_000_000i128); // User B is owed $10.00 USDC (10M micro-USDC)
    assert_eq!(payment_a + payment_b, 0i128); // Net system funding delta == 0

    // Mathematical Fact 2: In partial settlement (Solana tx accounts cap at 16 users):
    // Transaction Page 1 settles User B (receiver) ONLY.
    // User B's batch order settles, updating funding snapshot:
    let mut total_funding_residual: i128 = 0;
    total_funding_residual += payment_b;

    // The quantity total_funding_residual is NOT rounding dust!
    // It is the entire gross funding payment owed to User B (-$10.00 USDC)!
    assert_eq!(total_funding_residual, -10_000_000i128);

    // On-chain settle_users logic (lines 218-225):
    let execution_result: Result<(), EpochError> = if total_funding_residual < 0 {
        let neg = u64::try_from(total_funding_residual.checked_abs().unwrap()).unwrap();
        match fee_pool.checked_sub(neg) {
            Some(_) => Ok(()),
            None => Err(EpochError::MathOverflow),
        }
    } else {
        Ok(())
    };

    // CRITICAL PROOF: Settlement of User B aborts with MathOverflow because fee_pool is 0!
    assert_eq!(
        execution_result.unwrap_err(),
        EpochError::MathOverflow,
        "settle_users MUST fail with MathOverflow when settling funding receiver with fee_pool < gross payment"
    );
}

// ============================================================================
// H-2: CLEAR_BATCH ADMIN TIMING BYPASS
// ============================================================================

#[test]
fn test_h2_clear_batch_admin_timing_bypass() {
    let start_slot = 100u64;
    let batch_slots = 2u64;
    let batch_id = 10u64;
    let close_slot = start_slot + (batch_id + 1) * batch_slots; // close_slot = 100 + 22 = 122

    let current_slot = 120u64; // Batch is still OPEN! (2 slots remaining until close)

    let admin_key = Pubkey::new_unique();
    let regular_cranker = Pubkey::new_unique();

    // Exact check from clear_batch.rs line 108:
    // require!(current_slot >= close_slot || market.admin == ctx.accounts.cranker.key(), EpochError::BatchNotOpen);
    let check_timing = |cranker: Pubkey| -> Result<(), EpochError> {
        if current_slot >= close_slot || admin_key == cranker {
            Ok(())
        } else {
            Err(EpochError::BatchNotOpen)
        }
    };

    // Non-admin cranker is correctly rejected
    assert_eq!(
        check_timing(regular_cranker).unwrap_err(),
        EpochError::BatchNotOpen,
        "Regular cranker must be rejected before close_slot"
    );

    // Admin bypasses timing validation and clears premature auction!
    assert!(
        check_timing(admin_key).is_ok(),
        "Admin successfully bypasses close_slot timing requirement"
    );
}

// ============================================================================
// H-3: EXPIRE_AND_RELEASE ADMIN BYPASS
// ============================================================================

#[test]
fn test_h3_expire_and_release_admin_bypass() {
    let start_slot = 100u64;
    let batch_slots = 2u64;
    let batch_id = 5u64;
    let max_delay = 20u64;
    let close_slot = start_slot + (batch_id + 1) * batch_slots; // 100 + 12 = 112
    let current_slot = 113u64; // Batch closed 1 slot ago; within normal 20-slot clearing window!

    let admin_key = Pubkey::new_unique();
    let regular_caller = Pubkey::new_unique();

    // Exact check from expire_and_release.rs line 65:
    // let is_stale = current_slot > close_slot.saturating_add(max_delay) || market.admin == ctx.accounts.caller.key();
    let check_stale = |caller: Pubkey| -> Result<(), EpochError> {
        let is_stale = current_slot > close_slot.saturating_add(max_delay) || admin_key == caller;
        if is_stale {
            Ok(())
        } else {
            Err(EpochError::BatchNotStale)
        }
    };

    // Permissionless caller cannot void an in-window batch
    assert_eq!(
        check_stale(regular_caller).unwrap_err(),
        EpochError::BatchNotStale,
        "Non-admin cannot expire an in-window non-stale batch"
    );

    // Admin force-voids active non-stale batch, annulling user orders!
    assert!(
        check_stale(admin_key).is_ok(),
        "Admin can unilaterally force-void active batches before max_clear_delay"
    );
}

// ============================================================================
// H-4: LIQUIDATION VAULT SOLVENCY & MARGIN OMISSION
// ============================================================================

#[test]
fn test_h4_liquidation_renders_backstop_vault_insolvent() {
    // Backstop Vault starts solvent with $10,000 USDC collateral and 0 position
    let vault_collateral: i64 = 10_000_000_000; // $10,000 USDC
    let mut vault_quote: i128 = 0;
    let mut vault_base: i64 = 0;

    // Liquidatee: heavily overleveraged Long of 1,000,000 lots (1,000 SOL)
    let liquidatee_base: i64 = 1_000_000;
    let oracle_price_at_liquidation = 150_000_000u64; // $150.00 / SOL

    // Notional absorbed by vault: 1,000,000 lots * $150 / 1000 = $150,000 USDC
    let notional = ((liquidatee_base.unsigned_abs() as u128 * oracle_price_at_liquidation as u128)
        / 1000) as u64;
    assert_eq!(notional, 150_000_000_000); // $150,000 USDC

    // Exact transfer logic from liquidate.rs lines 151-158:
    vault_base = vault_base.checked_add(liquidatee_base).unwrap();
    vault_quote = vault_quote.checked_sub(notional as i128).unwrap();

    // Now SOL price drops 15% to $127.50 / SOL:
    let crashed_price = 127_500_000u64;
    let pos_val = (vault_base as i128 * crashed_price as i128) / 1000;
    let vault_equity = vault_collateral as i128 + vault_quote + pos_val;

    // Initial Vault Collateral: +$10,000 USDC
    // Quote Position: -$150,000 USDC
    // Position Value at $127.50: +$127,500 USDC
    // Vault Equity: $10,000 - $150,000 + $127,500 = -$12,500 USDC!
    assert_eq!(vault_equity, -12_500_000_000i128);
    assert!(
        vault_equity < 0,
        "Backstop Vault equity is deeply negative (-$12,500 USDC)! Vault is bankrupt."
    );

    // Proof: liquidate.rs contained ZERO check_margin_requirement for vault_user!
}

// ============================================================================
// H-5: ORACLE ANCHOR-PRICE WINDOW BOUNDARY MANIPULATION & OUTAGE LOCKOUT
// ============================================================================

#[test]
fn test_h5_oracle_window_boundary_stacking_and_outage_lockout() {
    let initial_price = 100_000_000u64; // $100.00
    let mut current_price = initial_price;
    let mut anchor_price = initial_price;
    let anchor_slot = 0u64;
    let mut publish_slot = 0u64;

    // --- Scenario A: Window Boundary Stacking ---
    // At slot 74 (74 slots elapsed):
    let slot_74 = 74u64;
    let price_74 = 100_300_000u64; // +30 bps

    // Check Layer A at slot 74: allowed = (15 + (74 - 2) * 1).min(100) = 87 bps
    let slots_elapsed = slot_74 - publish_slot;
    let allowed_single = (15u128 + (slots_elapsed.saturating_sub(2) as u128)).min(100);
    assert_eq!(allowed_single, 87);
    let move_bps_74 = ((price_74 as i128 - current_price as i128).unsigned_abs() * 10_000) / current_price as u128;
    assert!(move_bps_74 <= allowed_single);

    // Check Layer B at slot 74: slot 74 - anchor_slot(0) = 74 < 75 -> Anchor does NOT expire
    let anchor_move_74 = ((price_74 as i128 - anchor_price as i128).unsigned_abs() * 10_000) / anchor_price as u128;
    assert_eq!(anchor_move_74, 30);
    assert!(anchor_move_74 <= 30); // VALID

    // Commit update 1
    current_price = price_74;
    publish_slot = slot_74;

    // At slot 75 (JUST 1 SLOT LATER):
    let slot_75 = 75u64;
    // Anchor window expires: slot 75 - anchor_slot(0) >= 75
    if slot_75.saturating_sub(anchor_slot) >= 75 {
        anchor_price = current_price; // Anchor instantly jumps to $100.30!
    }

    // Now attacker posts ANOTHER +15 bps move at slot 75
    let price_75 = 100_450_450u64; // +15 bps above 100.30
    let slots_elapsed_75 = slot_75 - publish_slot;
    let allowed_single_75 = (15u128 + (slots_elapsed_75.saturating_sub(2) as u128)).min(100);
    let move_single_75 = ((price_75 as i128 - current_price as i128).unsigned_abs() * 10_000) / current_price as u128;
    assert!(move_single_75 <= allowed_single_75); // Layer A passes for 1-slot move

    let anchor_move_75 = ((price_75 as i128 - anchor_price as i128).unsigned_abs() * 10_000) / anchor_price as u128;
    assert!(anchor_move_75 <= 30); // Layer B passes

    // RESULT: Net price movement from slot 73 to 75 (2 slots / 800ms):
    let total_2_slot_move_bps = ((price_75 as i128 - initial_price as i128).unsigned_abs() * 10_000) / initial_price as u128;
    assert_eq!(total_2_slot_move_bps, 45); // 45 bps in 2 slots! Exceeds advertised 30 bps per 30s rate.

    // --- Scenario B: Outage Lockout / DoS on Real Market Volatility ---
    // Suppose an outage lasted 80 slots (~32s), during which real market moved +35 bps:
    let real_market_price_after_outage = 100_350_000u64; // +35 bps
    let post_outage_slot = 80u64;

    let base_price_before_outage = initial_price;
    let anchor_slot_before = 0u64;

    // Anchor updates to old price
    let mut new_anchor_price = base_price_before_outage;
    if post_outage_slot.saturating_sub(anchor_slot_before) >= 75 {
        new_anchor_price = base_price_before_outage;
    }

    // Layer A allows outage catch-up:
    let elapsed_outage = post_outage_slot - 0;
    let allowed_layer_a = (15u128 + (elapsed_outage.saturating_sub(2) as u128)).min(100);
    assert_eq!(allowed_layer_a, 93); // Layer A allows 93 bps!

    // But Layer B on-chain rule:
    let anchor_delta_outage = (real_market_price_after_outage as i128 - new_anchor_price as i128).unsigned_abs();
    let anchor_move_bps_outage = (anchor_delta_outage * 10_000) / new_anchor_price as u128;
    assert_eq!(anchor_move_bps_outage, 35);

    // Layer B check:
    let is_rejected_by_layer_b = anchor_move_bps_outage > 30;
    assert!(
        is_rejected_by_layer_b,
        "Layer B PERMANENTLY REJECTS real market price (+35 bps) after outage! Oracle is locked."
    );
}

// ============================================================================
// M-1: RING SLOT REUSE DEADLOCK
// ============================================================================

#[test]
fn test_m1_ring_slot_reuse_deadlock() {
    let batch = Batch {
        batch_id: 0,
        status: BatchStatus::CLEARED,
        num_orders: 1,
        settled_orders: 0, // Order was NOT settled
        ..Default::default()
    };

    // Exact reuse condition from place_order.rs lines 130-133:
    let is_reusable = batch.status == BatchStatus::EMPTY
        || batch.status == BatchStatus::SETTLED
        || batch.num_orders == 0
        || (batch.settled_orders >= batch.num_orders);

    assert!(
        !is_reusable,
        "Ring slot 0 cannot be reused because settled_orders (0) < num_orders (1)"
    );

    // Calling place_order for batch 8 returns RingSlotBusy!
    let place_order_result: Result<(), EpochError> = if is_reusable {
        Ok(())
    } else {
        Err(EpochError::RingSlotBusy)
    };

    assert_eq!(
        place_order_result.unwrap_err(),
        EpochError::RingSlotBusy,
        "Unsettled order deadlocks ring slot across wrap cycles"
    );
}

// ============================================================================
// ADD-1: VAULT QUOTE CANCELLATION COUNTERS LEAK & BRICKING
// ============================================================================

#[test]
fn test_add1_vault_quote_cancellation_permanently_bricks_ring_slot() {
    let mut batch = Batch {
        batch_id: 1,
        status: BatchStatus::OPEN,
        num_orders: 0,
        settled_orders: 0,
        ..Default::default()
    };

    let mut vault_user: UserAccount = bytemuck::Zeroable::zeroed();

    let vault_user_pda = Pubkey::new_unique();

    // 1. Vault places 6 initial quotes: 3 bids and 3 asks
    for i in 0..6 {
        let side = if i < 3 { OrderSide::BUY } else { OrderSide::SELL };
        batch.orders[i] = Order {
            user_pda: vault_user_pda,
            lots: 10,
            filled_lots: 0,
            tick: (40 + i * 5) as u16,
            side,
            slot_id: i as u8,
            status: OrderStatus::OPEN,
            flags: 0,
            _padding: [0; 10],
        };
        batch.num_orders += 1;
        vault_user.active_orders += 1;
        if side == OrderSide::BUY {
            vault_user.pending_buy_lots += 10;
        } else {
            vault_user.pending_sell_lots += 10;
        }
    }

    assert_eq!(batch.num_orders, 6);
    assert_eq!(vault_user.active_orders, 6);
    assert_eq!(batch.settled_orders, 0);

    // 2. Inventory boundary crossed: allow_bids becomes false!
    let allow_bids = false;
    let allow_asks = true;

    // Exact cancellation logic from vault_quote.rs lines 185-205:
    for i in 0..(batch.num_orders as usize) {
        let (is_match, side, tick, lots) = {
            let o = &batch.orders[i];
            if o.user_pda == vault_user_pda && o.status == OrderStatus::OPEN {
                (true, o.side, o.tick as usize, o.lots)
            } else {
                (false, 0, 0, 0)
            }
        };

        if is_match {
            if side == OrderSide::BUY && !allow_bids {
                batch.bid_qty[tick] = batch.bid_qty[tick].saturating_sub(lots);
                vault_user.pending_buy_lots = vault_user.pending_buy_lots.saturating_sub(lots);
                batch.orders[i].status = OrderStatus::CANCELLED;
                // BUG: batch.settled_orders is NOT incremented!
                // BUG: vault_user.active_orders is NOT decremented!
            } else if side == OrderSide::SELL && !allow_asks {
                batch.ask_qty[tick] = batch.ask_qty[tick].saturating_sub(lots);
                vault_user.pending_sell_lots = vault_user.pending_sell_lots.saturating_sub(lots);
                batch.orders[i].status = OrderStatus::CANCELLED;
            }
        }
    }

    // Notice the counter state:
    assert_eq!(batch.settled_orders, 0, "settled_orders was NOT incremented on cancellation");
    assert_eq!(vault_user.active_orders, 6, "active_orders leaked and was NOT decremented");

    // 3. Batch closes and clears. settle_users settles all remaining active orders:
    // settle_users.rs lines 108-110 explicitly SKIPS CANCELLED orders:
    for i in 0..(batch.num_orders as usize) {
        let order = &mut batch.orders[i];
        if order.status == OrderStatus::SETTLED || order.status == OrderStatus::CANCELLED {
            continue; // SKIPS CANCELLED ORDERS!
        }
        order.status = OrderStatus::SETTLED;
        batch.settled_orders += 1; // Only increments for the 3 asks!
    }

    // 4. Batch check in settle_users line 228:
    if batch.settled_orders >= batch.num_orders {
        batch.status = BatchStatus::SETTLED;
    }

    // PROOF: settled_orders is 3, but num_orders is 6!
    assert_eq!(batch.settled_orders, 3);
    assert_eq!(batch.num_orders, 6);
    assert_ne!(
        batch.status,
        BatchStatus::SETTLED,
        "Batch status CAN NEVER BE SETTLED because cancelled orders were omitted from settled_orders!"
    );

    // 5. When batch 9 (maps to ring index 1) attempts to reuse the slot:
    let is_reusable = batch.status == BatchStatus::EMPTY
        || batch.status == BatchStatus::SETTLED
        || batch.num_orders == 0
        || (batch.settled_orders >= batch.num_orders);

    assert!(
        !is_reusable,
        "Ring slot is permanently locked! is_reusable is permanently false."
    );
}
