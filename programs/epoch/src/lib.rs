use anchor_lang::prelude::*;

pub mod state;
use state::*;

declare_id!("CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap");

#[program]
pub mod epoch {
    use super::*;

    pub fn initialize_batch(ctx: Context<InitializeBatch>, batch_id: u64) -> Result<()> {
        let mut batch = ctx.accounts.batch.load_init()?;
        batch.batch_id = batch_id;
        batch.status = BatchStatus::OPEN;
        batch.num_orders = 0;
        batch.settled_orders = 0;
        msg!("Epoch batch account initialized: id={}", batch_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeBatch<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<Batch>(),
    )]
    pub batch: AccountLoader<'info, Batch>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
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
        assert!(market_size < 1024, "Market must be < 1024 bytes");
    }
}
