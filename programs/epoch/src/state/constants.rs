//! Epoch program constants.
//!
//! Central source of truth for all numeric constants used across account layouts
//! and program logic. Matches the values specified in `02-MECHANISM_SPEC.md` §1
//! and `01-ARCHITECTURE.md` §5.

/// Maximum number of orders per batch account.
pub const MAX_ORDERS: usize = 128;

/// Number of price ticks in the oracle-relative grid (must be odd).
pub const K_TICKS: usize = 101;

/// Center tick index (offset = 0 bps). `c = (K-1)/2`.
pub const CENTER_TICK: usize = (K_TICKS - 1) / 2; // 50

/// Fixed-point scaling factor for the funding index (10^9).
pub const F_SCALE: i128 = 1_000_000_000;

/// Price granularity in micro-USDC. Every clearing price is a multiple of this.
pub const PRICE_TICK: u64 = 1000;

/// Maximum concurrent order slots per user per batch.
pub const MAX_SLOTS_PER_USER: u8 = 8;

/// Number of batch account slots in the ring buffer.
pub const RING_SIZE: u8 = 8;

/// Maximum mock USDC allowed per faucet request: $10,000 (in micro-USDC).
pub const MAX_FAUCET_AMOUNT: u64 = 10_000_000_000;

/// Initial oracle price on market initialization (micro-USDC: $150.00).
pub const INITIAL_ORACLE_PRICE: u64 = 150_000_000;
