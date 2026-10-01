use anchor_lang::prelude::*;

/// Epoch program error codes.
#[error_code]
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
}
