use anchor_lang::prelude::*;

/// Per-user account (PDA seed `[b"user", owner.key()]`).
///
/// Tracks collateral, positions, funding state, and pending order counts.
/// One account per user across all batches. Zero-copy for efficient settlement.
///
/// Field ordering: i128 fields first (16-byte aligned), then Pubkeys (32B)
/// and u64/i64 (8-byte), then smaller fields at the end. Explicit padding
/// ensures no compiler-generated padding bytes exist.
#[account(zero_copy)]
#[derive(Debug)]
#[repr(C)]
pub struct UserAccount {
    /// Quote-ledger position in signed micro-USDC (spec §7).
    /// `Σ(collateral + quote_position)` is conserved across all users (I-1).
    pub quote_position: i128, // 16 (offset 0)
    /// Last funding index value applied to this user.
    pub funding_snapshot: i128, // 16 (offset 16)
    /// Wallet that owns this account.
    pub owner: Pubkey, // 32 (offset 32)
    /// Deposited collateral in micro-USDC. Adjusted by fees, realized PnL folds.
    /// Can go negative only via bad debt (I-1).
    pub collateral: i64, // 8 (offset 64)
    /// Net position in signed lots. Positive = long, negative = short.
    pub base_position: i64, // 8 (offset 72)
    /// Sum of buy lots in unsettled orders (for worst-case margin).
    pub pending_buy_lots: u64, // 8 (offset 80)
    /// Sum of sell lots in unsettled orders (for worst-case margin).
    pub pending_sell_lots: u64, // 8 (offset 88)
    /// Count of active orders across all open batches.
    pub active_orders: u8, // 1 (offset 96)
    /// Bit flags (e.g., LIQUIDATING).
    pub flags: u8, // 1 (offset 97)
    /// Padding to 8-byte boundary.
    pub _pad: [u8; 6], // 6 (offset 98 -> 104)
    /// Reserved space for future fields.
    pub _reserved: [u8; 64], // 64 (offset 104 -> 168)
    /// Padding to 16-byte alignment boundary (offset 168 -> 176).
    pub _pad2: [u8; 8], // 8 (offset 168 -> 176)
}

/// User flag bits.
#[allow(non_snake_case)]
pub mod UserFlags {
    /// No flags set.
    pub const NONE: u8 = 0;
    /// User is undergoing liquidation.
    pub const LIQUIDATING: u8 = 1;
}

const _: () = {
    assert!(std::mem::size_of::<UserAccount>() < 1024);
    assert!(std::mem::size_of::<UserAccount>() == 176);
    assert!(std::mem::size_of::<UserAccount>() % 16 == 0);
};
