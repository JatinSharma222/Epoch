use anchor_lang::prelude::*;

use super::constants::{K_TICKS, MAX_ORDERS};

/// Batch state machine values (spec §4, architecture §4).
#[allow(non_snake_case)]
pub mod BatchStatus {
    /// Ring slot is free for reuse.
    pub const EMPTY: u8 = 0;
    /// Accepting orders.
    pub const OPEN: u8 = 1;
    /// Clearing complete, awaiting settlement.
    pub const CLEARED: u8 = 2;
    /// Oracle invalid or clear window missed; no fills.
    pub const VOID: u8 = 3;
    /// All users settled; ready for reuse.
    pub const SETTLED: u8 = 4;
}

/// Order side.
#[allow(non_snake_case)]
pub mod OrderSide {
    /// Buy (long) order.
    pub const BUY: u8 = 0;
    /// Sell (short) order.
    pub const SELL: u8 = 1;
}

/// Order lifecycle status.
#[allow(non_snake_case)]
pub mod OrderStatus {
    /// Active, not yet cleared.
    pub const OPEN: u8 = 0;
    /// Fully filled during clearing.
    pub const FILLED: u8 = 1;
    /// Partially filled at marginal tick.
    pub const PARTIAL: u8 = 2;
    /// Cancelled by user before clearing.
    pub const CANCELLED: u8 = 3;
    /// Expired (batch cleared with no fill for this order).
    pub const EXPIRED: u8 = 4;
    /// Settled to user account.
    pub const SETTLED: u8 = 5;
}

/// Order flag bits (spec §2).
#[allow(non_snake_case)]
pub mod OrderFlags {
    /// No special flags.
    pub const NONE: u8 = 0;
    /// Reduce-only: fill capped so position cannot flip or grow.
    pub const REDUCE_ONLY: u8 = 1 << 0;
    /// Protocol-created liquidation order.
    pub const LIQUIDATION: u8 = 1 << 1;
}

/// Individual order within a Batch (64 bytes, zero-copy).
///
/// Layout: `user_pda(32) + lots(8) + filled_lots(8) + tick(2) + side(1) +
///          slot_id(1) + status(1) + flags(1) + _padding(10) = 64`.
#[zero_copy]
#[derive(Debug, PartialEq, Eq)]
#[repr(C)]
pub struct Order {
    /// PDA of the user who placed this order.
    pub user_pda: Pubkey, // 32
    /// Requested lot quantity.
    pub lots: u64, // 8
    /// Lots filled during clearing (set at settlement).
    pub filled_lots: u64, // 8
    /// Limit tick index in `[0, K-1]`.
    pub tick: u16, // 2
    /// Side: `OrderSide::BUY` or `OrderSide::SELL`.
    pub side: u8, // 1
    /// User's slot index `[0, 8)` for this batch.
    pub slot_id: u8, // 1
    /// Lifecycle status from `OrderStatus`.
    pub status: u8, // 1
    /// Bit flags from `OrderFlags`.
    pub flags: u8, // 1
    /// Padding to 64 bytes.
    pub _padding: [u8; 10], // 10
}

/// Batch account (PDA seed `[b"batch", ring_index]`, zero-copy).
///
/// Contains the tick aggregates, clearing results, and up to `MAX_ORDERS` orders.
/// Size budget: 128 orders × 64 B + 2 × 101 × 8 B + header ≈ 9,936 B ≤ 10,240 B.
#[account(zero_copy)]
#[derive(Debug)]
#[repr(C)]
pub struct Batch {
    /// Batch sequence number.
    pub batch_id: u64, // 8
    /// Current state from `BatchStatus`.
    pub status: u8, // 1
    pub _pad0: [u8; 7], // 7
    /// Number of orders placed in this batch.
    pub num_orders: u16, // 2
    /// Number of orders that have been settled.
    pub settled_orders: u16, // 2
    /// Clearing tick index (i*), set by `clear_batch`.
    pub clearing_tick: u16, // 2
    pub _pad1: [u8; 2], // 2
    /// Oracle price at clear time (micro-USDC per SOL).
    pub oracle_price: u64, // 8
    /// Oracle confidence at clear time (micro-USDC).
    pub oracle_conf: u64, // 8
    /// Slot in which the oracle update was posted.
    pub oracle_posted_slot: u64, // 8
    /// Uniform clearing price (micro-USDC per SOL, multiple of price_tick).
    pub clearing_price: u64, // 8
    /// Total matched lots (Q*).
    pub matched_lots: u64, // 8
    /// Buy-side marginal tick index (t_b).
    pub bid_marginal_tick: u16, // 2
    pub _pad2: [u8; 6], // 6
    /// Buy-side lots allocated at marginal tick (M_b).
    pub bid_marginal_alloc: u64, // 8
    /// Total buy lots at marginal tick (T_b = bid_qty[t_b]).
    pub bid_marginal_total: u64, // 8
    /// Sell-side marginal tick index (t_a).
    pub ask_marginal_tick: u16, // 2
    pub _pad3: [u8; 6], // 6
    /// Sell-side lots allocated at marginal tick (M_a).
    pub ask_marginal_alloc: u64, // 8
    /// Total sell lots at marginal tick (T_a = ask_qty[t_a]).
    pub ask_marginal_total: u64, // 8
    /// Aggregate buy lots at each tick (updated by place/cancel).
    pub bid_qty: [u64; K_TICKS], // 808
    /// Aggregate sell lots at each tick (updated by place/cancel).
    pub ask_qty: [u64; K_TICKS], // 808
    /// Order buffer, indexed by insertion order.
    pub orders: [Order; MAX_ORDERS], // 8192
}

impl Default for Order {
    fn default() -> Self {
        bytemuck::Zeroable::zeroed()
    }
}

impl Default for Batch {
    fn default() -> Self {
        bytemuck::Zeroable::zeroed()
    }
}

impl Batch {
    /// Reset this ring slot for a new batch, clearing all header fields,
    /// tick aggregates, and stale order data from the previous occupant.
    ///
    /// Zeroing the used order slots prevents data leakage across batch cycles
    /// and ensures defensive safety even if iteration guards are bypassed.
    pub fn reset_for_batch(&mut self, target_batch: u64) {
        let old_count = (self.num_orders as usize).min(MAX_ORDERS);
        self.batch_id = target_batch;
        self.status = BatchStatus::OPEN;
        self.num_orders = 0;
        self.settled_orders = 0;
        self.clearing_tick = 0;
        self.oracle_price = 0;
        self.oracle_conf = 0;
        self.oracle_posted_slot = 0;
        self.clearing_price = 0;
        self.matched_lots = 0;
        self.bid_marginal_tick = 0;
        self.bid_marginal_alloc = 0;
        self.bid_marginal_total = 0;
        self.ask_marginal_tick = 0;
        self.ask_marginal_alloc = 0;
        self.ask_marginal_total = 0;
        self.bid_qty.fill(0);
        self.ask_qty.fill(0);
        for i in 0..old_count {
            self.orders[i] = Order::default();
        }
    }
}

// Compile-time layout assertions.
const _: () = {
    assert!(std::mem::size_of::<Order>() == 64);
    assert!(8 + std::mem::size_of::<Batch>() <= 10240);
};
