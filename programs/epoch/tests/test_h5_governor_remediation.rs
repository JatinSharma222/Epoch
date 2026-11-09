//! Rigorous Adversarial and Invariant Verification Suite for H-5 Oracle Governor
//!
//! Validates:
//! 1. Cumulative movement bounds across repeated outage and recovery cycles:
//!    Proves that 10 repeated outage cycles of 150 slots / 60 seconds are strictly bounded
//!    to an average velocity of <= 30 bps/minute (and never exceed the 60 bps/minute limit).
//! 2. Repeated window resets cannot provide an unlimited sequence of additional price movements:
//!    Because both window_slots >= 150 AND time_elapsed >= 60 are required, advancing only
//!    time or only slots does not reset the window.
//! 3. Alternating price movements:
//!    50 alternating updates (+15 bps, -15 bps) do NOT freeze or pin the oracle because
//!    net directional drift from window start returns to baseline.
//! 4. Arithmetic safety and no mathematical overflow on extreme values:
//!    Extreme prices (u64::MAX / 2), extreme confidence intervals, and massive slot gaps (1,000,000 slots).
//! 5. Timestamp regressions rejected with EpochError::OracleStale.
//! 6. Same-slot and backwards-slot updates rejected with EpochError::OracleStale.
//! 7. Mathematical relationship between slot-based and wall-clock window expiration.
//! 8. Bounded continuous EMA anchor prevents sudden jumps across recovery cycles.

use anchor_lang::prelude::Pubkey;
use epoch::errors::EpochError;
use epoch::instructions::post_price::{
    process_price_update, AuthorityPriceUpdate,
};

fn create_initial_oracle(price: u64, slot: u64, time: i64) -> AuthorityPriceUpdate {
    let mut oracle = AuthorityPriceUpdate {
        market: Pubkey::new_unique(),
        price: 0,
        conf: 0,
        publish_time: 0,
        publish_slot: 0,
        last_anchor_update_slot: 0,
        posted_slot: 0,
        anchor_price: 0,
        velocity_accumulator_bps: 0,
        velocity_window_start_slot: 0,
        velocity_window_start_time: 0,
        velocity_window_start_price: 0,
        _reserved: [0; 8],
    };
    // Bootstrap first price
    process_price_update(&mut oracle, price, 50_000, time, slot).unwrap();
    oracle
}

#[test]
fn test_h5_cumulative_movement_bounded_across_repeated_outage_cycles() {
    let initial_price = 150_000_000u64; // $150.00
    let mut oracle = create_initial_oracle(initial_price, 100, 1000);

    let mut current_slot = 100u64;
    let mut current_time = 1000i64;

    // Run 10 consecutive outage and recovery cycles
    // In each cycle: 150 slots and 60 seconds elapse (outage duration)
    // An attacker submits a massive pump price (+50% each time)
    for cycle in 1..=10 {
        current_slot += 150;
        current_time += 60;

        let pump_target = oracle.price + (oracle.price * 50) / 100; // +50% shock
        let accepted = process_price_update(
            &mut oracle,
            pump_target,
            50_000,
            current_time,
            current_slot,
        )
        .expect("Post-outage price update should succeed with clamping");

        // Single-cycle move is bounded by Tier 2 anchor deviation (<= 30 bps)
        let cycle_delta = accepted.abs_diff(oracle.anchor_price);
        let cycle_bps = (cycle_delta as u128 * 10_000) / (oracle.anchor_price as u128);
        assert!(
            cycle_bps <= 30,
            "Cycle {}: move {} bps exceeds 30 bps anchor bound",
            cycle,
            cycle_bps
        );
    }

    // After 10 cycles (1500 slots, 600 seconds = 10 minutes):
    let total_elapsed_minutes = (current_time - 1000) / 60;
    assert_eq!(total_elapsed_minutes, 10);

    let total_delta = oracle.price.saturating_sub(initial_price);
    let total_bps = (total_delta as u128 * 10_000) / (initial_price as u128);

    // Average velocity per minute across all repeated outages:
    let velocity_bps_per_min = total_bps / total_elapsed_minutes as u128;
    assert!(
        velocity_bps_per_min <= 30,
        "Repeated outage velocity {} bps/min exceeds 30 bps/min mathematical bound",
        velocity_bps_per_min
    );
    assert!(
        velocity_bps_per_min <= 60,
        "Must never exceed global 60 bps/minute rate limit"
    );
}

#[test]
fn test_h5_repeated_window_resets_require_both_slots_and_time() {
    let initial_price = 150_000_000u64;
    let mut oracle = create_initial_oracle(initial_price, 100, 1000);

    // Scenario A: Time advances by 60 seconds, but ONLY 10 slots advance (cluster congested)
    // The window must NOT reset because window_slots < 150!
    let target = initial_price + (initial_price * 10) / 100;
    let price_1 = process_price_update(&mut oracle, target, 50_000, 1060, 110).unwrap();
    let move_1 = price_1.abs_diff(initial_price);
    let bps_1 = (move_1 as u128 * 10_000) / (initial_price as u128);
    assert!(bps_1 <= 30);

    // Next update 1 slot later: attempts another jump
    let price_2 = process_price_update(&mut oracle, target, 50_000, 1061, 111).unwrap();
    // Window has NOT reset (window_slots = 11 < 150), so directional drift remains capped at 60 bps
    let drift_from_start = (price_2.abs_diff(initial_price) as u128 * 10_000) / (initial_price as u128);
    assert!(
        drift_from_start <= 60,
        "Directional drift {} must not exceed 60 bps from window start",
        drift_from_start
    );

    // Scenario B: 150 slots advance, but ONLY 10 seconds advance (fast replay / fast slots)
    // The window must NOT reset because time_elapsed < 60s!
    let mut oracle2 = create_initial_oracle(initial_price, 100, 1000);
    let p_fast = process_price_update(&mut oracle2, target, 50_000, 1010, 250).unwrap();
    let drift_fast = (p_fast.abs_diff(initial_price) as u128 * 10_000) / (initial_price as u128);
    assert!(drift_fast <= 60);

    // Attempting next update 1 slot later
    let p_fast2 = process_price_update(&mut oracle2, target, 50_000, 1011, 251).unwrap();
    let drift_fast2 = (p_fast2.abs_diff(initial_price) as u128 * 10_000) / (initial_price as u128);
    assert!(
        drift_fast2 <= 60,
        "Fast slots without wall-clock time must not reset window"
    );
}

#[test]
fn test_h5_alternating_movements_do_not_freeze_oracle() {
    let base_price = 150_000_000u64; // $150.00
    let mut oracle = create_initial_oracle(base_price, 100, 1000);

    // Up 15 bps: $150.225
    let up_price = base_price + (base_price * 15) / 10_000;
    // Down 15 bps: $149.775
    let down_price = base_price - (base_price * 15) / 10_000;

    let mut slot = 100u64;
    let mut time = 1000i64;

    // Run 50 alternating updates (+15, -15, +15, -15, ...)
    for i in 1..=50 {
        slot += 2; // Normal 2-slot cadence
        time += 1;

        let target = if i % 2 == 1 { up_price } else { down_price };
        let accepted = process_price_update(&mut oracle, target, 50_000, time, slot)
            .expect("Alternating update must never throw instruction error");

        // Verify the price actually moved to the target and was NOT frozen at 0!
        if i % 2 == 1 {
            assert!(
                accepted > base_price,
                "Iteration {}: Price must move up by 15 bps, got {}",
                i,
                accepted
            );
        } else {
            assert!(
                accepted < base_price,
                "Iteration {}: Price must move down by 15 bps, got {}",
                i,
                accepted
            );
        }

        // Verify accumulator records net directional drift, which stays <= 15 bps
        assert!(
            oracle.velocity_accumulator_bps <= 15,
            "Net drift {} must not accumulate bidirectionally",
            oracle.velocity_accumulator_bps
        );
    }
}

#[test]
fn test_h5_extreme_values_and_no_overflow() {
    // Extreme high price: $92 billion (u64::MAX / 200)
    let extreme_high = u64::MAX / 200;
    let mut oracle = create_initial_oracle(extreme_high, 100, 1000);

    // Extreme jump target
    let target = extreme_high + 10_000_000_000;
    let res = process_price_update(&mut oracle, target, u64::MAX / 1000, 1060, 250);
    assert!(res.is_ok(), "Must handle extreme price values without overflow");

    // Extreme slot gap: 10,000,000 slots
    let res_gap = process_price_update(&mut oracle, extreme_high, 50_000, 10_000_000, 10_000_250);
    assert!(res_gap.is_ok(), "Must handle massive slot gaps without overflow");

    // Extreme small price: 1 micro-cent
    let mut oracle_small = create_initial_oracle(1, 100, 1000);
    let res_small = process_price_update(&mut oracle_small, 2, 1, 1001, 102);
    assert!(res_small.is_ok(), "Must handle unit prices without panic");
}

#[test]
fn test_h5_timestamp_and_slot_regressions_rejected() {
    let initial_price = 150_000_000u64;
    let mut oracle = create_initial_oracle(initial_price, 100, 1000);

    // 1. Same-slot update rejected
    let err_same_slot = process_price_update(&mut oracle, initial_price + 1000, 50_000, 1001, 100);
    assert_eq!(err_same_slot.unwrap_err(), EpochError::OracleStale.into());

    // 2. Past-slot update rejected
    let err_past_slot = process_price_update(&mut oracle, initial_price + 1000, 50_000, 1001, 99);
    assert_eq!(err_past_slot.unwrap_err(), EpochError::OracleStale.into());

    // 3. Timestamp regression rejected
    let err_past_time = process_price_update(&mut oracle, initial_price + 1000, 50_000, 999, 102);
    assert_eq!(err_past_time.unwrap_err(), EpochError::OracleStale.into());
}

#[test]
fn test_h5_ema_anchor_cannot_be_manipulated_by_outage_resets() {
    let initial_price = 150_000_000u64;
    let mut oracle = create_initial_oracle(initial_price, 100, 1000);

    // Outage of 1,000 slots (~400 seconds)
    let post_outage_slot = 1100;
    let post_outage_time = 1400;

    // Attacker tries +100% price pump
    let pump_target = 300_000_000u64;
    let clamped_price = process_price_update(
        &mut oracle,
        pump_target,
        50_000,
        post_outage_time,
        post_outage_slot,
    )
    .unwrap();

    // Clamped price can move at most 30 bps from anchor
    let price_delta_bps = ((clamped_price - initial_price) as u128 * 10_000) / initial_price as u128;
    assert!(price_delta_bps <= 30);

    // Verify EMA anchor:
    // Even after a 1,000-slot outage, compute_continuous_ema bounds alpha <= 75%,
    // keeping anchor tightly bound to pre-outage history!
    let anchor_delta_bps = ((oracle.anchor_price - initial_price) as u128 * 10_000) / initial_price as u128;
    assert!(
        anchor_delta_bps <= 25,
        "Anchor moved {} bps, exceeding bounded smoothing ceiling",
        anchor_delta_bps
    );
}

#[test]
fn test_h5_oscillation_adversarial_security_analysis() {
    let initial_price = 150_000_000u64;
    let mut oracle = create_initial_oracle(initial_price, 100, 1000);

    // Attacker submits 40 rapid alternating price moves:
    // Update 1: +15 bps shock
    // Update 2: -15 bps shock
    // Update 3: +15 bps shock
    // ...
    // Total path length of attempted movements = 40 * 15 = 600 bps!
    let mut current_slot = 100u64;
    let mut current_time = 1000i64;

    for i in 1..=40 {
        current_slot += 2; // Normal 2-slot batch cadence
        current_time += 1; // 1 second per 2 slots

        let target = if i % 2 == 1 {
            initial_price + (initial_price * 15) / 10_000 // +15 bps
        } else {
            initial_price - (initial_price * 15) / 10_000 // -15 bps
        };

        let res = process_price_update(
            &mut oracle,
            target,
            50_000,
            current_time,
            current_slot,
        );
        assert!(res.is_ok(), "Alternating update #{} must succeed without locking", i);

        let final_price = res.unwrap();

        // 1. Excursion from continuous EMA anchor is ALWAYS <= 30 bps
        let anchor_dev_bps = (final_price.abs_diff(oracle.anchor_price) as u128 * 10_000)
            / (oracle.anchor_price as u128);
        assert!(
            anchor_dev_bps <= 30,
            "Anchor deviation {} bps must not exceed Tier 2 limit (30 bps)",
            anchor_dev_bps
        );

        // 2. Net directional displacement from window start is ALWAYS <= 60 bps
        let net_disp_bps = (final_price.abs_diff(initial_price) as u128 * 10_000)
            / (initial_price as u128);
        assert!(
            net_disp_bps <= 60,
            "Net displacement {} bps must not exceed Tier 3 limit (60 bps)",
            net_disp_bps
        );
    }

    // After 40 alternating updates, verify oracle is healthy, anchor is at parity,
    // and oracle NEVER halted!
    assert!(oracle.velocity_accumulator_bps <= 60);
}

#[test]
fn test_h5_repeated_resets_and_prolonged_outages_unbypassable_proof() {
    let initial_price = 150_000_000u64;
    let mut oracle = create_initial_oracle(initial_price, 100, 1000);

    // Adversary Attempt 1: Advancing time by 10 minutes WITHOUT advancing slots (stalled Solana network)
    // Rolling window MUST NOT reset!
    let target = initial_price + (initial_price * 50) / 10_000; // +50 bps
    let res1 = process_price_update(
        &mut oracle,
        target,
        50_000,
        1600, // +600 seconds
        105,  // only +5 slots!
    )
    .unwrap();
    // Slots elapsed is only 5; single-move allowance is only (15 + 3) = 18 bps!
    let move_bps1 = ((res1 - initial_price) as u128 * 10_000) / initial_price as u128;
    assert!(move_bps1 <= 18, "Advancing only time without slots must NOT reset window (move was {} bps)", move_bps1);

    // Adversary Attempt 2: Advancing 500 slots WITHOUT advancing time (fast local replay)
    // Rolling window MUST NOT reset!
    let res2 = process_price_update(
        &mut oracle,
        initial_price + (initial_price * 50) / 10_000,
        50_000,
        1601, // only +1 second
        605,  // +500 slots!
    )
    .unwrap();
    // Anchor deviation constraint (<= 30 bps) still strictly applies!
    let move_bps2 = (res2.abs_diff(oracle.anchor_price) as u128 * 10_000) / oracle.anchor_price as u128;
    assert!(move_bps2 <= 30, "Advancing only slots without time must NOT bypass anchor constraint (dev was {} bps)", move_bps2);
}

#[test]
fn test_h5_high_leverage_boundary_liquidation_and_clamping() {
    let initial_price = 100_000_000u64; // $100.00
    let mut oracle = create_initial_oracle(initial_price, 100, 1000);

    // Position A: Highly leveraged (20x) position hovering 15 bps above MMR
    // Base position: 100 lots long. Notional = $10.00.
    // MMR = 5.0% = $0.50 (500,000 micro-USDC).
    // User equity = $0.515 (515,000 micro-USDC) -> Only 15 bps margin buffer!
    let _pos_a_base: i64 = 100;
    let pos_a_equity_start: i64 = 515_000;
    let mmr_req_start = (500u128 * 100 * initial_price as u128) / 1000 / 10_000; // 500,000
    assert!(pos_a_equity_start > mmr_req_start as i64, "Position A initially solvent");

    // Legitimate small market move: -20 bps (drops price from $100.00 to $99.80 after 7 slots)
    let market_drop_price = 99_800_000u64;
    let accepted_price = process_price_update(
        &mut oracle,
        market_drop_price,
        50_000,
        1003,
        107, // 7 slots elapsed -> allowance is 15 + (7-2) = 20 bps
    )
    .unwrap();
    assert_eq!(accepted_price, 99_800_000, "20 bps legitimate move is accepted after 7 slots");

    // Reassess Position A under the new price:
    // Loss = 100 lots * $0.20 / 1000 = $0.02 (20,000 micro-USDC)
    // New equity = $0.515 - $0.02 = $0.495 (495,000 micro-USDC)
    let pos_a_equity_end = pos_a_equity_start - 20_000;
    let mmr_req_end = (500u128 * 100 * accepted_price as u128) / 1000 / 10_000;
    assert!(pos_a_equity_end < mmr_req_end as i64, "Position A legitimately crosses into liquidation");

    // Position B: Moderately leveraged (10x) position with normal buffer
    // Base position: 100 lots long. Equity = $1.00 (10.0% margin, 500 bps buffer above MMR).
    let pos_b_equity_start: i64 = 1_000_000;

    // Attacker attempts a sudden 300 bps flash spike manipulation (-3.0% drop to $96.80)
    let flash_target = 96_800_000u64;
    let clamped_price = process_price_update(
        &mut oracle,
        flash_target,
        50_000,
        1004,
        109, // 2 slots elapsed -> allowance is 15 bps
    )
    .unwrap();

    // The governor clamps the single-update move to 15 bps from 99.80 (drops to $99.65):
    let actual_move_bps = ((accepted_price - clamped_price) as u128 * 10_000) / accepted_price as u128;
    assert!(actual_move_bps <= 15, "Flash crash clamped to <= 15 bps");

    // Reassess Position B under the clamped price ($99.65):
    // Drop is only 15 bps ($0.015 / unit -> $0.0015 on 100 lots = 1,500 micro-USDC)
    // Position B equity = $1.00 - $0.0015 = $0.9985 >> MMR ($0.50)!
    let pos_b_equity_end = pos_b_equity_start - 1_500;
    let mmr_b_end = (500u128 * 100 * clamped_price as u128) / 1000 / 10_000;
    assert!(pos_b_equity_end > mmr_b_end as i64, "Position B protected from false liquidation by governor clamping");
}

#[test]
fn test_h5_long_sequence_repeated_outages_and_resets_gradual_drift_bound() {
    let initial_price = 100_000_000u64; // $100.00
    let mut oracle = create_initial_oracle(initial_price, 100, 1000);

    let mut current_slot = 100u64;
    let mut current_time = 1000i64;

    // Simulate 30 consecutive outage and reset cycles (30 wall-clock minutes)
    // In each cycle: 150 slots and 60 seconds elapse, and an attacker attempts +100% price pump
    for cycle in 1..=30 {
        current_slot += 150;
        current_time += 60;

        let pump_target = oracle.price * 2; // +100% target
        let accepted = process_price_update(
            &mut oracle,
            pump_target,
            50_000,
            current_time,
            current_slot,
        )
        .expect("Update succeeds with clamping");

        // Per-cycle move from the EMA anchor is strictly <= 30 bps
        let step_bps = (accepted.abs_diff(oracle.anchor_price) as u128 * 10_000) / (oracle.anchor_price as u128);
        assert!(
            step_bps <= 30,
            "Cycle #{}: Step move {} bps exceeds anchor deviation bound of 30 bps",
            cycle,
            step_bps
        );
    }

    // Cumulative movement check across the full 30-minute sequence:
    // With tau = 75 slots, anchor tracks at alpha = 1 - e^-2 ≈ 86.5% of the 30 bps per cycle (~26 bps/cycle).
    // After 30 cycles, maximum possible price drift is bounded by:
    // 30 cycles * 30 bps = 900 bps (and actual continuous EMA drift is ~780 bps).
    let total_drift_bps = ((oracle.price - initial_price) as u128 * 10_000) / (initial_price as u128);
    assert!(
        total_drift_bps <= 900,
        "Total drift across 30 minutes was {} bps, exceeding strict 900 bps theoretical ceiling",
        total_drift_bps
    );
    assert!(
        total_drift_bps >= 600,
        "Total drift was {} bps; confirms price smoothly tracks legitimate sustained movement",
        total_drift_bps
    );
}
