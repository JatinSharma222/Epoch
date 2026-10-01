use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

pub use errors::*;
pub use instructions::*;
pub use state::*;

declare_id!("CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap");

#[program]
pub mod epoch {
    use super::*;

    /// Initialize the global Market account, mock USDC mint, and collateral vault.
    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        args: InitializeMarketArgs,
        oracle_feed_id: [u8; 32],
    ) -> Result<()> {
        handle_initialize_market(ctx, args, oracle_feed_id)
    }

    /// Create a new per-user account for trading and collateral accounting.
    pub fn create_user(ctx: Context<CreateUser>) -> Result<()> {
        handle_create_user(ctx)
    }

    /// Mint mock USDC to caller for testing on devnet / localnet (capped per call).
    pub fn faucet(ctx: Context<Faucet>, amount: u64) -> Result<()> {
        handle_faucet(ctx, amount)
    }

    /// Deposit mock USDC collateral into the protocol vault.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        handle_deposit(ctx, amount)
    }

    /// Withdraw mock USDC collateral from the protocol vault (flat position rule).
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        handle_withdraw(ctx, amount)
    }

    /// Initialize a zero-copy Batch account for a ring slot.
    pub fn initialize_batch(
        ctx: Context<InitializeBatch>,
        ring_index: u8,
        batch_id: u64,
    ) -> Result<()> {
        handle_initialize_batch(ctx, ring_index, batch_id)
    }

    /// Place or replace (upsert) an order targeting a future or current batch.
    pub fn place_order(ctx: Context<PlaceOrder>, args: PlaceOrderArgs) -> Result<()> {
        handle_place_order(ctx, args)
    }

    /// Cancel an active order before its target batch closes.
    pub fn cancel_order(
        ctx: Context<CancelOrder>,
        target_batch: u64,
        ring_index: u8,
        slot_id: u8,
    ) -> Result<()> {
        handle_cancel_order(ctx, target_batch, ring_index, slot_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_batch_account_size() {
        let order_size = std::mem::size_of::<Order>();
        let batch_size = std::mem::size_of::<Batch>();
        let total_size = 8 + batch_size;
        println!("Order size: {} bytes", order_size);
        println!("Batch size (data): {} bytes", batch_size);
        println!("Total size with discriminator: {} bytes", total_size);
        assert_eq!(order_size, 64);
        assert!(
            total_size <= 10240,
            "Batch account must fit within 10,240-byte Anchor init limit"
        );
    }

    #[test]
    fn test_market_params_size() {
        let params_size = std::mem::size_of::<MarketParams>();
        println!("MarketParams size: {} bytes", params_size);
        assert_eq!(params_size, 64);
        assert!(params_size % 8 == 0, "MarketParams must be 8-byte aligned");
    }

    #[test]
    fn test_user_account_size() {
        let user_size = std::mem::size_of::<UserAccount>();
        println!("UserAccount size: {} bytes", user_size);
        assert!(user_size < 1024, "UserAccount must be < 1024 bytes");
        assert!(user_size % 8 == 0, "UserAccount must be 8-byte aligned");
    }

    #[test]
    fn test_market_size() {
        let market_size = std::mem::size_of::<Market>();
        println!("Market size: {} bytes", market_size);
        assert_eq!(market_size, 384);
        assert!(market_size < 1024, "Market must be < 1024 bytes");
    }
}
