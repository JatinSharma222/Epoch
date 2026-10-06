use anchor_lang::prelude::*;

/// Epoch program error codes.
#[error_code]
#[derive(PartialEq, Eq)]
pub enum EpochError {
    /// Caller is not authorized for this operation.
    #[msg("Unauthorized")]
    Unauthorized,

    /// Amount must be greater than zero.
    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    /// Requested amount exceeds the per-call faucet limit.
    #[msg("Faucet limit exceeded")]
    FaucetCapExceeded,

    /// Cannot withdraw while having open/pending orders.
    #[msg("Cannot withdraw with pending orders")]
    HasPendingOrders,

    /// Withdraw currently requires a flat position (base_position == 0).
    #[msg("Position must be flat to withdraw")]
    PositionNotFlat,

    /// Insufficient available collateral for withdrawal.
    #[msg("Insufficient collateral")]
    InsufficientCollateral,

    /// Math operation resulted in arithmetic overflow.
    #[msg("Arithmetic overflow")]
    MathOverflow,

    /// Ring slot is currently in use and cannot be overwritten.
    #[msg("Ring slot is busy with an unsettled batch")]
    RingSlotBusy,

    /// Target batch is already closed for new orders.
    #[msg("Batch has already closed")]
    BatchClosed,

    /// Batch is not open for orders.
    #[msg("Batch is not open")]
    BatchNotOpen,

    /// Target batch is in the past.
    #[msg("Target batch is in the past")]
    BatchInPast,

    /// Target batch is beyond the lookahead window.
    #[msg("Target batch is beyond lookahead window")]
    BatchTooFarAhead,

    /// Batch order buffer is full (max 128 orders).
    #[msg("Batch order buffer is full")]
    BatchFull,

    /// Order slot id must be in [0, 8).
    #[msg("Invalid order slot id")]
    InvalidSlotId,

    /// Order limit tick must be in [0, K).
    #[msg("Invalid tick index")]
    InvalidTick,

    /// Order side must be 0 (BUY) or 1 (SELL).
    #[msg("Invalid order side")]
    InvalidSide,

    /// Order not found in batch buffer.
    #[msg("Order not found")]
    OrderNotFound,

    /// Order size in lots is below min_order_lots.
    #[msg("Order quantity below minimum lots")]
    OrderTooSmall,

    /// Order notional value is below min_order_notional.
    #[msg("Order notional below minimum")]
    OrderNotionalTooSmall,

    /// Insufficient equity for margin requirement and slippage reserve.
    #[msg("Insufficient margin")]
    InsufficientMargin,

    /// Batch is not cleared or void yet.
    #[msg("Batch is not cleared or void")]
    BatchNotCleared,

    /// Batch is already fully settled.
    #[msg("Batch is already settled")]
    BatchAlreadySettled,

    /// Batch ID does not match target batch.
    #[msg("Batch ID mismatch")]
    BatchIdMismatch,

    /// Duplicate user account provided in settlement page.
    #[msg("Duplicate user account in settlement")]
    DuplicateUserAccount,

    /// Oracle price update is stale.
    #[msg("Oracle price is stale")]
    OracleStale,

    /// Oracle confidence interval is too wide.
    #[msg("Oracle confidence interval is too wide")]
    OracleConfidenceTooWide,

    /// Position is not liquidatable (equity satisfies maintenance margin requirement).
    #[msg("Position is not liquidatable")]
    NotLiquidatable,

    /// Position is flat; nothing to liquidate.
    #[msg("Position is flat")]
    PositionFlat,

    /// Cannot liquidate vault against itself.
    #[msg("Cannot liquidate vault against itself")]
    SelfLiquidation,

    /// Reduce-only order exceeds current opposite position.
    #[msg("Reduce-only order exceeds current opposite position")]
    ReduceOnlyExceedsPosition,

    /// Batch is not stale yet and cannot be expired.
    #[msg("Batch is not stale yet")]
    BatchNotStale,

    /// Cannot expire a batch that has already been cleared; use settle_users instead.
    #[msg("Cannot expire a cleared batch with matched trades")]
    CannotExpireClearedBatch,

    /// User account does not match any unsettled order in the batch.
    #[msg("User account does not match any unsettled order in batch")]
    InvalidUserAccount,
}
