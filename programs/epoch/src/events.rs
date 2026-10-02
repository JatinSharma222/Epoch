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
