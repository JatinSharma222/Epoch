use anchor_lang::prelude::*;

/// Emitted when a user's fills, funding, and fees are settled for a batch.
#[event]
pub struct UserSettled {
    pub user: Pubkey,
    pub batch_id: u64,
    pub fill_lots: u64,
    pub fee: u64,
}

/// Emitted when a batch is cleared through on-chain auction.
#[event]
pub struct BatchCleared {
    pub batch_id: u64,
    pub clearing_price: u64,
    pub offset_bps: i32,
    pub matched_lots: u64,
    pub oracle_price: u64,
    pub oracle_conf: u64,
}

/// Emitted when a batch is marked VOID (e.g. stale oracle or delay).
#[event]
pub struct BatchVoided {
    pub batch_id: u64,
    pub reason: u8,
}

/// Emitted when the Backstop Vault successfully quotes into a batch.
#[event]
pub struct VaultQuoted {
    pub target_batch: u64,
    pub ring_index: u8,
    pub inventory: i64,
    pub shift_bps: i64,
    pub orders_placed: u8,
}

/// Emitted when the Backstop Vault skips quoting due to an on-chain guard.
#[event]
pub struct VaultQuoteSkipped {
    pub target_batch: u64,
    pub ring_index: u8,
    pub reason: u8,
}

/// Skip reason codes for VaultQuoteSkipped.
#[allow(non_snake_case)]
pub mod VaultSkipReason {
    pub const NOT_ACTIVE: u8 = 1;
    pub const ORACLE_STALE: u8 = 2;
    pub const CONFIDENCE_TOO_WIDE: u8 = 3;
    pub const MAX_INVENTORY_EXCEEDED: u8 = 4;
    pub const INSUFFICIENT_MARGIN: u8 = 5;
    pub const BATCH_FULL: u8 = 6;
}

/// Emitted when an undercollateralized user position is liquidated.
#[event]
pub struct PositionLiquidated {
    pub liquidatee: Pubkey,
    pub liquidator: Pubkey,
    pub batch_id: u64,
    pub oracle_price: u64,
    pub base_lots: i64,
    pub notional: u64,
    pub penalty: u64,
    pub insurance_covered: u64,
    pub bad_debt: u64,
    pub user_remaining_collateral: i64,
}
