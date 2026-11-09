//! Production Verification Suite for H-5 Oracle Remediation & Rate Limiting Governor
//!
//! Validates:
//! 1. Prolonged-Outage Recovery Redesign:
//!    Resetting the velocity window CANNOT permit an unrestricted price jump.
//!    First post-outage update is strictly bounded to <= 100 bps from the pre-outage anchor.
//! 2. Dual Window Rollover:
//!    Tracks both 150 slots and 60 seconds of wall-clock time to resist Solana slot jitter.
//! 3. Rolling-Window Accumulator Behavior:
//!    - Clamped prices smoothly incorporated without instruction failures.
//!    - Opposite-direction movements: Alternating +15 bps and -15 bps updates do NOT exhaust
//!      the velocity budget or freeze the oracle, as net displacement returns to baseline.
//!    - Directional monotonic drift is strictly capped at <= 60 bps per 150 slots.
//! 4. Adversarial Scenarios:
//!    - Repeated outage resets: Attacker triggers 5 consecutive 200-slot outages trying to jump price.
//!    - Large post-outage jump (+50% market shock clamped safely).
//!    - Alternating price movements.
//!    - Repeated small updates.

use epoch::errors::EpochError;

/// Simulated production oracle state matching AuthorityPriceUpdate layout.
#[derive(Debug, Clone)]
pub struct ProductionOracleGovernor {
    pub price: u64,
    pub conf: u64,
    pub publish_time: i64,
    pub publish_slot: u64,
    pub anchor_price: u64,
    pub anchor_slot: u64,
    pub window_start_price: u64,
    pub window_start_slot: u64,
}

impl ProductionOracleGovernor {
    pub fn new(initial_price: u64, initial_slot: u64, initial_time: i64) -> Self {
        Self {
            price: initial_price,
            conf: 50_000,
            publish_time: initial_time,
            publish_slot: initial_slot,
            anchor_price: initial_price,
            anchor_slot: initial_slot,
            window_start_price: initial_price,
            window_start_slot: initial_slot,
        }
    }

    /// Mirrors handle_post_price logic in programs/epoch/src/instructions/post_price.rs
    pub fn post_price(
        &mut self,
        price: u64,
        conf: u64,
        slot: u64,
        publish_time: i64,
    ) -> std::result::Result<u64, EpochError> {
        if price == 0 {
            return Err(EpochError::InvalidOraclePrice);
        }
        if conf == 0 {
            return Err(EpochError::OracleConfidenceTooLow);
        }

        // Guard 1: Monotonic progression
        if slot <= self.publish_slot {
            return Err(EpochError::OracleStale);
        }
        if publish_time < self.publish_time {
            return Err(EpochError::OracleStale);
        }

        let slots_elapsed = slot.saturating_sub(self.publish_slot);
        let time_elapsed = publish_time.saturating_sub(self.publish_time);

        // Dual Window Rollover:
        // Window rolls when either 150 slots have passed OR 60 seconds have elapsed
        let window_slots = slot.saturating_sub(self.window_start_slot);
        if window_slots >= 150 || time_elapsed >= 60 {
            self.window_start_price = self.price;
            self.window_start_slot = slot;
        }

        let anchor_slots = slot.saturating_sub(self.anchor_slot);
        if anchor_slots >= 75 {
            self.anchor_price = self.price;
            self.anchor_slot = slot;
        }

        // Bounded Prolonged-Outage Recovery (H-5 §3.1):
        // Even after a prolonged outage (>= 150 slots or silence >= 60s), resetting the window
        // CANNOT permit an unrestricted price jump!
        let is_prolonged_outage = slots_elapsed >= 150 || time_elapsed >= 60;
        let allowed_single_move_bps = if is_prolonged_outage {
            // Outage recovery cap: hard ceiling of 100 bps (1.00%) from pre-outage anchor
            100u128
        } else {
            // Normal cadence: 15 bps base + 1 bps per slot beyond 2 slots (capped at 100 bps)
            let base_move_bps = 15u128;
            let per_slot_allowance_bps = 1u128;
            let additional = (slots_elapsed.saturating_sub(2) as u128) * per_slot_allowance_bps;
            (base_move_bps + additional).min(100u128)
        };

        // Compute allowable bounds:
        let max_from_last = self.price as u128 + (self.price as u128 * allowed_single_move_bps) / 10_000;
        let min_from_last = self.price as u128 - (self.price as u128 * allowed_single_move_bps) / 10_000;

        let max_from_anchor = self.anchor_price as u128 + (self.anchor_price as u128 * 30u128) / 10_000;
        let min_from_anchor = self.anchor_price as u128 - (self.anchor_price as u128 * 30u128) / 10_000;

        let max_from_window = self.window_start_price as u128 + (self.window_start_price as u128 * 60u128) / 10_000;
        let min_from_window = self.window_start_price as u128 - (self.window_start_price as u128 * 60u128) / 10_000;

        let upper_bound = if is_prolonged_outage {
            let max_outage = self.anchor_price as u128 + (self.anchor_price as u128 * 100u128) / 10_000;
            max_from_last.min(max_outage)
        } else {
            max_from_last.min(max_from_anchor).min(max_from_window)
        };

        let lower_bound = if is_prolonged_outage {
            let min_outage = self.anchor_price as u128 - (self.anchor_price as u128 * 100u128) / 10_000;
            min_from_last.max(min_outage)
        } else {
            min_from_last.max(min_from_anchor).max(min_from_window)
        };

        let clamped = (price as u128).min(upper_bound).max(lower_bound) as u64;

        self.price = clamped;
        self.conf = conf;
        self.publish_time = publish_time;
        self.publish_slot = slot;

        // Continuous EMA anchor update (H-5 §2.2)
        self.anchor_price = epoch::instructions::post_price::compute_continuous_ema(clamped, self.anchor_price, anchor_slots);
        self.anchor_slot = slot;

        Ok(clamped)
    }
}

#[test]
fn test_h5_large_post_outage_jump_is_bounded() {
    let initial_price = 150_000_000u64; // $150.00
    let mut gov = ProductionOracleGovernor::new(initial_price, 100, 1000);

    // Outage of 500 slots (~200 seconds of silence)
    let post_outage_slot = 600;
    let post_outage_time = 1200;

    // External market claims SOL pumped +50% to $225.00 during the outage
    let market_pump_price = 225_000_000u64;

    // Post-outage update: must NOT jump to $225! It must be clamped to at most 100 bps from pre-outage anchor ($151.50)
    let updated = gov.post_price(market_pump_price, 50_000, post_outage_slot, post_outage_time)
        .expect("Post outage update should succeed with clamping");

    let max_allowable = initial_price + (initial_price * 100) / 10_000; // $151.50
    assert!(
        updated <= max_allowable,
        "Post-outage jump must be bounded by 100 bps: updated {} <= max {}",
        updated, max_allowable
    );
    assert_eq!(updated, 151_500_000, "Clamped exactly at +100 bps ceiling ($151.50)");
}

#[test]
fn test_h5_repeated_outage_resets_cannot_bypass_rate_governor() {
    let initial_price = 150_000_000u64;
    let mut gov = ProductionOracleGovernor::new(initial_price, 100, 1000);

    // Attacker triggers 5 consecutive outages of 200 slots each,
    // trying to jump the price by +20% on each post-outage update.
    let mut current_slot = 100;
    let mut current_time = 1000;

    for i in 1..=5 {
        current_slot += 200; // 200-slot outage
        current_time += 100; // 100s outage

        let prev_price = gov.price;
        let pump_attempt = gov.price + 30_000_000; // Attacker tries +$30 jump

        let post_outage_price = gov.post_price(pump_attempt, 50_000, current_slot, current_time)
            .expect("Should clamp safely");

        // Every single post-outage jump must be <= 100 bps from pre-outage price!
        let max_step = prev_price + (prev_price * 100) / 10_000;
        assert!(
            post_outage_price <= max_step,
            "Outage #{} jump exceeded 100 bps: got {}, max {}",
            i, post_outage_price, max_step
        );
    }
}

#[test]
fn test_h5_alternating_price_movements_do_not_pin_oracle() {
    let initial_price = 150_000_000u64;
    let mut gov = ProductionOracleGovernor::new(initial_price, 100, 1000);

    // Attacker alternates +15 bps and -15 bps updates every 2 slots for 10 rounds (20 updates).
    // An absolute variation accumulator would exhaust 60 bps budget in 4 updates (pinning the oracle).
    // Our net displacement / directional accumulator allows healthy two-way trading without pinning!
    let mut current_slot = 100;
    let mut current_time = 1000;

    for _round in 1..=10 {
        // Up move: +15 bps
        current_slot += 2;
        current_time += 1;
        let p_up = gov.post_price(initial_price + 225_000, 50_000, current_slot, current_time)
            .expect("Up move should succeed");
        assert_eq!(p_up, initial_price + 225_000);

        // Down move: back to baseline
        current_slot += 2;
        current_time += 1;
        let p_down = gov.post_price(initial_price, 50_000, current_slot, current_time)
            .expect("Down move should succeed");
        assert_eq!(p_down, initial_price);
    }

    // After 20 alternating updates, oracle is STILL active and accepts valid prices!
    current_slot += 2;
    current_time += 1;
    let next_price = gov.post_price(initial_price + 100_000, 50_000, current_slot, current_time)
        .expect("Oracle must NOT be pinned by alternating oscillations");
    assert_eq!(next_price, initial_price + 100_000);
}

#[test]
fn test_h5_repeated_small_updates_strictly_bounded_to_60bps_per_window() {
    let initial_price = 150_000_000u64;
    let mut gov = ProductionOracleGovernor::new(initial_price, 100, 1000);

    // Attacker sends 50 micro-updates (each attempting to move price up by +5 bps) within a 100-slot window.
    // The cumulative movement must strictly be capped at <= 60 bps from window start ($150.90).
    let mut current_slot = 100;
    let mut current_time = 1000;

    for _ in 1..=50 {
        current_slot += 2;
        current_time += 1;
        let _ = gov.post_price(gov.price + 75_000, 50_000, current_slot, current_time).unwrap();
    }

    let max_window_price = initial_price + (initial_price * 60) / 10_000; // $150.90
    assert!(
        gov.price <= max_window_price,
        "Total drift across window must be <= 60 bps: got {}, max {}",
        gov.price, max_window_price
    );
}

#[test]
fn test_h5_variable_solana_slot_duration_handling() {
    // Tests that slot duration variance (e.g. 400ms vs 800ms vs 1200ms during congestion)
    // is cleanly handled by the dual rollover condition (slots >= 150 OR time >= 60s).
    let initial_price = 150_000_000u64;
    let mut gov = ProductionOracleGovernor::new(initial_price, 100, 1000);

    // Scenario A: Congested cluster where each slot takes 1,000ms (1 second per slot)
    // After 70 slots, 70 seconds have elapsed (time >= 60s triggered even though slots < 150)
    let slot_a = 170;
    let time_a = 1070; // 70 seconds
    let _ = gov.post_price(initial_price + 100_000, 50_000, slot_a, time_a).unwrap();

    assert_eq!(gov.window_start_slot, slot_a, "Window rolled based on wall-clock time >= 60s");

    // Scenario B: Fast cluster where 160 slots take only 40 seconds (slots >= 150 triggered)
    let slot_b = slot_a + 160;
    let time_b = time_a + 40; // 40 seconds
    let _ = gov.post_price(gov.price + 100_000, 50_000, slot_b, time_b).unwrap();

    assert_eq!(gov.window_start_slot, slot_b, "Window rolled based on slot count >= 150");
}

#[test]
fn test_h5_production_process_price_update_direct_instruction_logic() {
    use epoch::instructions::post_price::{process_price_update, AuthorityPriceUpdate};

    let mut oracle = AuthorityPriceUpdate::default();
    let initial_price = 150_000_000u64; // $150.00
    let initial_slot = 100u64;
    let initial_time = 1000i64;

    // 1. Initial bootstrap
    let p0 = process_price_update(&mut oracle, initial_price, 50_000, initial_time, initial_slot)
        .expect("Bootstrap must succeed");
    assert_eq!(p0, initial_price);
    assert_eq!(oracle.anchor_price, initial_price);
    assert_eq!(oracle.last_anchor_update_slot, initial_slot);
    assert_eq!(oracle.velocity_accumulator_bps, 0);

    // 2. Same-slot update strictly rejected
    let err_same_slot = process_price_update(&mut oracle, initial_price + 100_000, 50_000, initial_time + 1, initial_slot);
    assert_eq!(err_same_slot.unwrap_err(), EpochError::OracleStale.into());

    // 3. Out-of-order slot rejected
    let err_past_slot = process_price_update(&mut oracle, initial_price + 100_000, 50_000, initial_time + 1, initial_slot - 1);
    assert_eq!(err_past_slot.unwrap_err(), EpochError::OracleStale.into());

    // 4. Out-of-order timestamp rejected
    let err_past_time = process_price_update(&mut oracle, initial_price + 100_000, 50_000, initial_time - 1, initial_slot + 2);
    assert_eq!(err_past_time.unwrap_err(), EpochError::OracleStale.into());

    // 5. Large legitimate market jump (+20% from $150 to $180) clamped safely
    let jump_target = 180_000_000u64;
    let p1 = process_price_update(&mut oracle, jump_target, 50_000, initial_time + 1, initial_slot + 2)
        .expect("Clamping allows safe price progression");

    // Standard 2-slot cadence allows +15 bps = +225_000 micro-USDC ($150.225)
    assert_eq!(p1, 150_225_000, "Price clamped to exact +15 bps ceiling");
    assert_eq!(oracle.velocity_accumulator_bps, 15);
    assert!(oracle.anchor_price > initial_price, "Continuous EMA anchor stepped upward");
    assert_eq!(oracle.last_anchor_update_slot, initial_slot + 2);

    // 6. Rapid updates cannot exceed 60 bps velocity per window
    let mut current_slot = initial_slot + 2;
    let mut current_time = initial_time + 1;
    for _ in 1..=10 {
        current_slot += 2;
        current_time += 1;
        let _ = process_price_update(&mut oracle, jump_target, 50_000, current_time, current_slot).unwrap();
    }
    let total_drift_bps = ((oracle.price - initial_price) * 10_000) / initial_price;
    assert!(
        total_drift_bps <= 60,
        "Total drift was {} bps, strictly capped at <= 60 bps",
        total_drift_bps
    );
}

#[test]
fn test_h5_cumulative_bounds_across_repeated_outages() {
    use epoch::instructions::post_price::{process_price_update, AuthorityPriceUpdate};

    let mut oracle = AuthorityPriceUpdate::default();
    let initial_price = 150_000_000u64; // $150.00
    let mut current_slot = 100u64;
    let mut current_time = 1000i64;

    // Bootstrap
    let _ = process_price_update(&mut oracle, initial_price, 50_000, current_time, current_slot).unwrap();

    // Attacker triggers 10 consecutive prolonged outages of 500 slots and 200 seconds each.
    // In each recovery, attacker attempts to push the price up by +50% ($225.00).
    for i in 1..=10 {
        let pre_outage_price = oracle.price;
        current_slot += 500; // 500-slot outage (> 150 slot window)
        current_time += 200; // 200s outage (> 60s window)

        let p_outage = process_price_update(&mut oracle, 225_000_000, 50_000, current_time, current_slot)
            .expect("Outage recovery succeeds via clamping");

        // Single outage recovery must be strictly bounded by Tier 2 anchor deviation (<= 30 bps)
        let step_bps = ((p_outage - pre_outage_price) * 10_000) / pre_outage_price;
        assert!(
            step_bps <= 30,
            "Outage cycle #{} step {} bps exceeded 30 bps anchor bound",
            i, step_bps
        );
    }

    // Cumulative drift across 10 repeated outage-reset cycles is strictly capped:
    // (1 + 0.0030)^10 ≈ +3.04% maximum theoretical upper bound over 2,000 seconds (33 minutes).
    let total_bps = ((oracle.price - initial_price) * 10_000) / initial_price;
    assert!(
        total_bps <= 310,
        "10 repeated outage cycles resulted in {} bps drift (must be <= 310 bps)",
        total_bps
    );
}

#[test]
fn test_h5_extreme_values_and_overflow_protection() {
    use epoch::instructions::post_price::{process_price_update, AuthorityPriceUpdate};

    let mut oracle = AuthorityPriceUpdate::default();
    let initial_price = 150_000_000u64;

    // 1. Zero price rejected
    let err_zero_price = process_price_update(&mut oracle, 0, 50_000, 1000, 100);
    assert_eq!(err_zero_price.unwrap_err(), EpochError::InvalidOraclePrice.into());

    // 2. Zero confidence rejected
    let err_zero_conf = process_price_update(&mut oracle, initial_price, 0, 1000, 100);
    assert_eq!(err_zero_conf.unwrap_err(), EpochError::OracleConfidenceTooLow.into());

    // 3. Bootstrap with valid parameters
    let p0 = process_price_update(&mut oracle, initial_price, 50_000, 1000, 100).unwrap();
    assert_eq!(p0, initial_price);

    // 4. Extreme price value (near u64::MAX / 2) does not cause arithmetic overflow
    let extreme_price = u64::MAX / 4;
    let p_extreme = process_price_update(&mut oracle, extreme_price, 50_000, 1001, 102)
        .expect("Extreme price safely clamped without overflow");
    assert!(p_extreme > initial_price && p_extreme < initial_price + 1_000_000);

    // 5. Massive slot gap (10,000,000 slots) does not cause arithmetic overflow
    let p_huge_gap = process_price_update(&mut oracle, 200_000_000, 50_000, 10_000_000, 10_000_102)
        .expect("Massive slot gap safely processed");
    let gap_step_bps = ((p_huge_gap - oracle.anchor_price) * 10_000) / oracle.anchor_price;
    assert!(gap_step_bps <= 30, "Massive gap still bounded by anchor deviation limit");
}

#[test]
fn test_h5_continuous_ema_anchor_tamper_resistance() {
    use epoch::instructions::post_price::{compute_continuous_ema, process_price_update, AuthorityPriceUpdate};

    let mut oracle = AuthorityPriceUpdate::default();
    let initial_price = 100_000_000u64; // $100.00
    let _ = process_price_update(&mut oracle, initial_price, 50_000, 1000, 100).unwrap();

    // Verify mathematical decay properties of continuous EMA:
    // Calibrated to 1 - 1/e ≈ 63.21% time constant at 75 slots
    let ema_1 = compute_continuous_ema(110_000_000, 100_000_000, 1);
    assert_eq!(ema_1, 100_084_000, "1 slot elapsed gives exactly 84 bps response");

    let ema_75 = compute_continuous_ema(110_000_000, 100_000_000, 75);
    assert_eq!(ema_75, 106_321_000, "75 slots elapsed gives exact 1 - 1/e (63.21%) response");

    // Verify that alternating price updates smoothly center the anchor without bias
    let ema_up = compute_continuous_ema(100_300_000, 100_000_000, 2);
    let ema_down = compute_continuous_ema(99_700_000, ema_up, 2);
    // Symmetric 30 bps excursion returns cleanly to near $100.00
    assert!((99_990_000..=100_010_000).contains(&ema_down));
}


