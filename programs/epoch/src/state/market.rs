use anchor_lang::prelude::*;

/// Market parameters stored inline in the Market account.
/// All defaults are from `02-MECHANISM_SPEC.md` §1, §9 and `01-ARCHITECTURE.md` §5.1.
#[zero_copy]
#[derive(Debug, PartialEq, Eq)]
#[repr(C)]
pub struct MarketParams {
    /// Base lot size in lamports (default 1000 = 0.001 SOL).
    pub base_lot: u64,
    /// Price granularity in micro-USDC (default 1000 = $0.001).
    pub price_tick: u64,
    /// Minimum order size in lots (default 10).
    pub min_order_lots: u64,
    /// Minimum order notional in micro-USDC (default 10_000_000 = $10).
    pub min_order_notional: u64,
    /// Funding period length in slots (default 72000 ≈ 8 hours).
    pub funding_period_slots: u32,
    /// Slots per batch (default 2).
    pub batch_slots: u16,
    /// Lookahead: how many future batches an order may target (default 3).
    pub lookahead: u16,
    /// Number of price ticks in the grid (default 101, must be odd).
    pub k_ticks: u16,
    /// Basis points per tick (default 1).
    pub tick_bps: u16,
    /// Initial margin requirement in bps (default 1000 = 10%).
    pub imr_bps: u16,
    /// Maintenance margin requirement in bps (default 500 = 5%).
    pub mmr_bps: u16,
    /// Trading fee in bps on filled notional (default 5).
    pub fee_bps: u16,
    /// Liquidation penalty in bps (default 100).
    pub liq_penalty_bps: u16,
    /// Max oracle age in seconds before rejection (default 10).
    pub max_oracle_age_secs: u16,
    /// Max oracle confidence / price ratio in bps (default 20).
    pub max_conf_bps: u16,
    /// Max slots after batch close before VOID (default 4).
    pub max_clear_delay_slots: u16,
    /// Max orders allowed per batch (default 128).
    pub max_orders_per_batch: u16,
    /// Funding rate cap in bps (default 50).
    pub funding_cap_bps: u16,
    /// Padding for 8-byte alignment (offset 62 -> 64).
    pub _pad0: [u8; 2],
}

impl Default for MarketParams {
    fn default() -> Self {
        Self {
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
            max_clear_delay_slots: 4,
            max_orders_per_batch: 128,
            funding_cap_bps: 50,
            _pad0: [0; 2],
        }
    }
}

/// Global market configuration account (PDA seed `[b"market"]`).
///
/// One per market. Contains admin keys, oracle config, funding state,
/// and fee/insurance pools. Zero-copy for efficient on-chain access.
///
/// Field ordering: i128 fields first (16-byte aligned), then Pubkeys (32B)
/// and u64 fields. Avoids implicit padding under `#[repr(C)]`.
#[account(zero_copy)]
#[derive(Debug)]
#[repr(C)]
pub struct Market {
    /// Cumulative funding index, fixed-point with F_SCALE = 10^9.
    pub funding_index: i128,
    /// Admin authority (devnet only; can update params and fund vault).
    pub admin: Pubkey,
    /// Mock USDC mint address.
    pub quote_mint: Pubkey,
    /// SPL token account holding all user collateral.
    pub collateral_vault: Pubkey,
    /// Pyth SOL/USD feed id (32 bytes, verified on-chain).
    pub oracle_feed_id: [u8; 32],
    /// All tunable market parameters (inline struct).
    pub params: MarketParams,
    /// Slot at which batch counting begins; `batch_id = (slot - start_slot) / N`.
    pub start_slot: u64,
    /// Next batch_id that needs clearing (monotonic pointer).
    pub next_batch_to_clear: u64,
    /// Last observed oracle price (for display and coarse checks).
    pub last_oracle_price: u64,
    /// Sum of all long positions in lots (= sum of all short positions).
    pub open_interest_lots: u64,
    /// Accrued trading fees in micro-USDC.
    pub fee_pool: u64,
    /// Accrued insurance fund in micro-USDC.
    pub insurance_fund: u64,
    /// PDA bump for the market account.
    pub bump: u8,
    /// Padding to align to 8-byte boundary.
    pub _pad_bump: [u8; 7],
    /// Reserved space for future fields without reallocation.
    pub _reserved: [u8; 120],
}

const _: () = {
    assert!(std::mem::size_of::<MarketParams>() % 8 == 0);
    assert!(std::mem::size_of::<MarketParams>() == 64);
    assert!(std::mem::size_of::<Market>() == 384);
    assert!(std::mem::size_of::<Market>() % 16 == 0);
};
