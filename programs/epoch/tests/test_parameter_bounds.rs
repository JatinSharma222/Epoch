use epoch::errors::EpochError;
use epoch::instructions::initialize_market::InitializeMarketArgs;
use epoch::instructions::update_vault_params::UpdateVaultParamsArgs;
use epoch::state::constants::{K_TICKS, MAX_ORDERS, RING_SIZE};
use epoch::state::{MarketParams, VaultParams};

fn default_test_market_args() -> InitializeMarketArgs {
    InitializeMarketArgs {
        base_lot: 1000,
        price_tick: 1000,
        min_order_lots: 10,
        min_order_notional: 10_000_000,
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
    }
}

fn default_test_vault_args() -> UpdateVaultParamsArgs {
    UpdateVaultParamsArgs {
        quote_offset_bps: [3, 6, 10],
        quote_lots: [10, 20, 30],
        max_inventory_lots: 1000,
        skew_bps: 5,
        max_conf_bps: 15,
        is_active: 1,
    }
}

#[test]
fn test_market_params_valid_defaults_pass() {
    let args = default_test_market_args();
    let params: MarketParams = args.into();
    assert!(params.validate().is_ok());
}

#[test]
fn test_market_params_rejects_zero_price_tick() {
    let mut args = default_test_market_args();
    args.price_tick = 0;
    let params: MarketParams = args.into();
    assert_eq!(params.validate().unwrap_err(), EpochError::InvalidMarketParameter.into());
}

#[test]
fn test_market_params_rejects_zero_base_lot() {
    let mut args = default_test_market_args();
    args.base_lot = 0;
    let params: MarketParams = args.into();
    assert_eq!(params.validate().unwrap_err(), EpochError::InvalidMarketParameter.into());
}

#[test]
fn test_market_params_rejects_zero_batch_slots() {
    let mut args = default_test_market_args();
    args.batch_slots = 0;
    let params: MarketParams = args.into();
    assert_eq!(params.validate().unwrap_err(), EpochError::InvalidMarketParameter.into());
}

#[test]
fn test_market_params_rejects_zero_funding_period() {
    let mut args = default_test_market_args();
    args.funding_period_slots = 0;
    let params: MarketParams = args.into();
    assert_eq!(params.validate().unwrap_err(), EpochError::InvalidMarketParameter.into());
}

#[test]
fn test_market_params_rejects_imr_less_than_or_equal_mmr() {
    let mut args = default_test_market_args();
    args.imr_bps = 500;
    args.mmr_bps = 500;
    let params: MarketParams = args.into();
    assert_eq!(params.validate().unwrap_err(), EpochError::InvalidMarketParameter.into());

    let mut args2 = default_test_market_args();
    args2.imr_bps = 400;
    args2.mmr_bps = 500;
    let params2: MarketParams = args2.into();
    assert_eq!(params2.validate().unwrap_err(), EpochError::InvalidMarketParameter.into());
}

#[test]
fn test_market_params_rejects_imr_exceeding_100_percent() {
    let mut args = default_test_market_args();
    args.imr_bps = 10001; // > 10,000 bps
    let params: MarketParams = args.into();
    assert_eq!(params.validate().unwrap_err(), EpochError::InvalidMarketParameter.into());
}

#[test]
fn test_market_params_rejects_fee_exceeding_10_percent() {
    let mut args = default_test_market_args();
    args.fee_bps = 1001; // > 1,000 bps (10%)
    let params: MarketParams = args.into();
    assert_eq!(params.validate().unwrap_err(), EpochError::InvalidMarketParameter.into());
}

#[test]
fn test_market_params_rejects_even_or_out_of_bounds_k_ticks() {
    let mut args_even = default_test_market_args();
    args_even.k_ticks = 100; // Even!
    let params_even: MarketParams = args_even.into();
    assert_eq!(params_even.validate().unwrap_err(), EpochError::InvalidTick.into());

    let mut args_zero = default_test_market_args();
    args_zero.k_ticks = 0;
    let params_zero: MarketParams = args_zero.into();
    assert_eq!(params_zero.validate().unwrap_err(), EpochError::InvalidTick.into());

    let mut args_overflow = default_test_market_args();
    args_overflow.k_ticks = (K_TICKS + 2) as u16; // 103 > 101
    let params_overflow: MarketParams = args_overflow.into();
    assert_eq!(params_overflow.validate().unwrap_err(), EpochError::InvalidTick.into());
}

#[test]
fn test_market_params_rejects_lookahead_inconsistent_with_ring_size() {
    let mut args_zero = default_test_market_args();
    args_zero.lookahead = 0;
    let params_zero: MarketParams = args_zero.into();
    assert_eq!(params_zero.validate().unwrap_err(), EpochError::InvalidMarketParameter.into());

    let mut args_gte_ring = default_test_market_args();
    args_gte_ring.lookahead = RING_SIZE as u16; // 8 >= 8
    let params_gte_ring: MarketParams = args_gte_ring.into();
    assert_eq!(params_gte_ring.validate().unwrap_err(), EpochError::InvalidMarketParameter.into());
}

#[test]
fn test_market_params_rejects_max_orders_out_of_bounds() {
    let mut args_zero = default_test_market_args();
    args_zero.max_orders_per_batch = 0;
    let params_zero: MarketParams = args_zero.into();
    assert_eq!(params_zero.validate().unwrap_err(), EpochError::InvalidMarketParameter.into());

    let mut args_overflow = default_test_market_args();
    args_overflow.max_orders_per_batch = (MAX_ORDERS + 1) as u16;
    let params_overflow: MarketParams = args_overflow.into();
    assert_eq!(params_overflow.validate().unwrap_err(), EpochError::InvalidMarketParameter.into());
}

#[test]
fn test_vault_params_valid_defaults_pass() {
    let args = default_test_vault_args();
    let params: VaultParams = args.into();
    assert!(params.validate().is_ok());
}

#[test]
fn test_vault_params_rejects_zero_max_inventory() {
    let mut args = default_test_vault_args();
    args.max_inventory_lots = 0;
    let params: VaultParams = args.into();
    assert_eq!(params.validate().unwrap_err(), EpochError::InvalidVaultParameter.into());
}

#[test]
fn test_vault_params_rejects_non_increasing_or_zero_offsets() {
    let mut args = default_test_vault_args();
    args.quote_offset_bps = [0, 6, 10]; // zero offset
    let params: VaultParams = args.into();
    assert_eq!(params.validate().unwrap_err(), EpochError::InvalidVaultParameter.into());

    let mut args_inverted = default_test_vault_args();
    args_inverted.quote_offset_bps = [6, 3, 10]; // not strictly increasing
    let params_inverted: VaultParams = args_inverted.into();
    assert_eq!(params_inverted.validate().unwrap_err(), EpochError::InvalidVaultParameter.into());
}

#[test]
fn test_vault_params_rejects_zero_quote_lots() {
    let mut args = default_test_vault_args();
    args.quote_lots = [0, 20, 30];
    let params: VaultParams = args.into();
    assert_eq!(params.validate().unwrap_err(), EpochError::InvalidVaultParameter.into());
}

#[test]
fn test_vault_params_rejects_zero_max_conf_bps() {
    let mut args = default_test_vault_args();
    args.max_conf_bps = 0;
    let params: VaultParams = args.into();
    assert_eq!(params.validate().unwrap_err(), EpochError::InvalidVaultParameter.into());
}

#[test]
fn test_vault_params_rejects_invalid_is_active_flag() {
    let mut args = default_test_vault_args();
    args.is_active = 2; // only 0 or 1 allowed
    let params: VaultParams = args.into();
    assert_eq!(params.validate().unwrap_err(), EpochError::InvalidVaultParameter.into());
}
