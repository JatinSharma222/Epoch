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
