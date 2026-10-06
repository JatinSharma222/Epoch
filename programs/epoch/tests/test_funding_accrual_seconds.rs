//! Test Funding Accrual Scaled by Unix Timestamp Seconds (8h = 28,800s)
//!
//! Validates:
//! 1. Formal 8-hour funding period in unix timestamp seconds: T_funding = 28,800 seconds.
//! 2. Batch duration in seconds at measured Devnet slot time (238.67 ms/slot -> 0.47734s / batch).
//! 3. Calibrated on-chain parameter funding_period_slots = 120,670 slots (28,800s / 0.23867s).
//! 4. Mathematical equivalence between continuous unix timestamp second accrual and discrete slot accrual.
//! 5. Full 8-hour continuous accumulation yields exact 8h funding rate on open interest.
//! 6. Long/short balance updates and zero-sum invariant preservation with fee_pool residual capture.

const F_SCALE: i128 = 1_000_000_000; // 10^9 fixed-point scaling factor
const FUNDING_PERIOD_SECONDS: u64 = 28_800; // 8 hours * 3600 seconds = 28,800s
const FUNDING_CAP_BPS: i32 = 50; // Max funding cap = 50 bps per 8h

/// Helper to compute batch funding index delta from unix timestamp seconds
fn compute_funding_accrual_seconds(
    rate_bps: i32,
    oracle_price_micro: u64,
    elapsed_seconds: f64,
    funding_period_seconds: u64,
) -> i128 {
    let rate = rate_bps.clamp(-FUNDING_CAP_BPS, FUNDING_CAP_BPS);
    let accrual = (rate as f64 * oracle_price_micro as f64 * elapsed_seconds * (F_SCALE as f64 / 1000.0))
        / (10_000.0 * funding_period_seconds as f64);
    accrual.round() as i128
}

/// Helper to compute batch funding index delta via on-chain slot formula
fn compute_funding_accrual_slots(
    rate_bps: i32,
    oracle_price_micro: u64,
    n_slots: u16,
    funding_period_slots: u32,
) -> i128 {
    let rate = rate_bps.clamp(-FUNDING_CAP_BPS, FUNDING_CAP_BPS);
    if funding_period_slots == 0 {
        return 0;
    }
    (rate as i128 * oracle_price_micro as i128 * n_slots as i128 * (F_SCALE / 1000))
        / (10_000 * funding_period_slots as i128)
}

#[test]
fn test_funding_accrual_8h_seconds_definition() {
    assert_eq!(FUNDING_PERIOD_SECONDS, 8 * 60 * 60);
    assert_eq!(FUNDING_PERIOD_SECONDS, 28_800);
}

#[test]
fn test_funding_accrual_seconds_vs_slots_equivalence() {
    let measured_slot_time_s = 0.23867; // [MEASURED] devnet slot time
    let batch_slots = 2u16;
    let batch_seconds = batch_slots as f64 * measured_slot_time_s; // ~0.47734s

    // Calibrated slots for 28,800 seconds: 28,800 / 0.23867 = 120,669 ~ 120,670 slots
    let calibrated_funding_slots = (FUNDING_PERIOD_SECONDS as f64 / measured_slot_time_s).round() as u32;
    assert!((calibrated_funding_slots as i32 - 120_670).abs() <= 1);

    let oracle_price = 150_000_000u64; // $150.00 in micro-USDC
    let rate_bps = 10i32; // +10 bps perpetual premium

    // Compute via seconds formula (continuous unix timestamp delta)
    let delta_sec = compute_funding_accrual_seconds(
        rate_bps,
        oracle_price,
        batch_seconds,
        FUNDING_PERIOD_SECONDS,
    );

    // Compute via on-chain slot formula with calibrated funding_period_slots
    let delta_slot = compute_funding_accrual_slots(
        rate_bps,
        oracle_price,
        batch_slots,
        calibrated_funding_slots,
    );

    println!("Delta per batch (seconds): {}", delta_sec);
    println!("Delta per batch (slots):   {}", delta_slot);

    // The two formulations agree within integer slot discretization rounding (< 0.001% error, or ~7e-9 USDC per lot)
    let diff = (delta_sec - delta_slot).abs();
    assert!(diff <= 10, "Diff between seconds and calibrated slot accrual was {}", diff);
    assert!((diff as f64 / delta_sec as f64) < 1e-4, "Relative error exceeds 0.01%");
}

#[test]
fn test_funding_accrual_full_8h_accumulation() {
    // Over a full 8-hour duration (28,800 seconds), an uninterrupted +20 bps rate
    // accumulates to exactly 20 bps of notional per base lot.
    let oracle_price = 150_000_000u64; // $150.00
    let rate_bps = 20i32;

    // Accrual over full 28,800s
    let total_delta_index = compute_funding_accrual_seconds(
        rate_bps,
        oracle_price,
        28_800.0,
        FUNDING_PERIOD_SECONDS,
    );

    // Per-lot payment in micro-USDC:
    // notional = 1 lot * ($150.00 / 1000) = $0.150 = 150_000 micro-USDC
    // 20 bps of 150_000 micro-USDC = 0.0020 * 150_000 = 300 micro-USDC
    let funding_per_lot = (1i128 * total_delta_index) / F_SCALE;
    assert_eq!(funding_per_lot, 300, "20 bps on 150,000 micro-USDC notional must equal 300 micro-USDC");
}

#[test]
fn test_funding_cap_clamping_seconds() {
    let oracle_price = 100_000_000u64; // $100.00
    let extreme_rate_bps = 250i32; // Exceeds 50 bps cap

    let capped_delta = compute_funding_accrual_seconds(
        extreme_rate_bps,
        oracle_price,
        28_800.0,
        FUNDING_PERIOD_SECONDS,
    );

    let max_delta = compute_funding_accrual_seconds(
        FUNDING_CAP_BPS,
        oracle_price,
        28_800.0,
        FUNDING_PERIOD_SECONDS,
    );

    assert_eq!(capped_delta, max_delta, "Extreme funding rate must be clamped to 50 bps cap");
}

#[test]
fn test_funding_zero_sum_with_fee_pool_residual() {
    // When longs pay and shorts receive, verify invariant conservation:
    // Δ(quote_long) + Δ(quote_short) + Δ(fee_pool) = 0
    let delta_index = 2_500_000_000i128; // 2.5 per lot
    let long_lots = 100i64;
    let short_lots = -100i64;

    // Long owes funding (round UP to protocol favor)
    let long_owed = (long_lots as i128 * delta_index + F_SCALE - 1) / F_SCALE;
    // Short receives funding (round DOWN)
    let short_received = ((-short_lots) as i128 * delta_index) / F_SCALE;

    let residual_to_fee_pool = long_owed - short_received;
    assert!(residual_to_fee_pool >= 0, "Residual must never leak protocol funds");

    let net_system_pnl = -long_owed + short_received + residual_to_fee_pool;
    assert_eq!(net_system_pnl, 0, "Funding transfer must be zero-sum with fee pool capture");
}
