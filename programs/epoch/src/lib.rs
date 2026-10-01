use anchor_lang::prelude::*;

declare_id!("CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap");

pub const MAX_ORDERS: usize = 128;
pub const K_TICKS: usize = 101;

#[program]
pub mod epoch {
    use super::*;

    pub fn initialize_batch(ctx: Context<InitializeBatch>, batch_id: u64) -> Result<()> {
        let mut batch = ctx.accounts.batch.load_init()?;
        batch.batch_id = batch_id;
        batch.status = 1; // 1 = OPEN
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

#[zero_copy]
#[derive(Debug, PartialEq, Eq)]
#[repr(C)]
pub struct Order {
    pub user_pda: Pubkey,   // 32
    pub lots: u64,          // 8
    pub filled_lots: u64,   // 8
    pub tick: u16,          // 2
    pub side: u8,           // 1
    pub slot_id: u8,        // 1
    pub status: u8,         // 1
    pub flags: u8,          // 1
    pub _padding: [u8; 10], // 10 -> Total 64 bytes
}

#[account(zero_copy)]
#[derive(Debug)]
#[repr(C)]
pub struct Batch {
    pub batch_id: u64,               // 8
    pub status: u8,                  // 1
    pub _pad0: [u8; 7],              // 7
    pub num_orders: u16,             // 2
    pub settled_orders: u16,         // 2
    pub clearing_tick: u16,          // 2
    pub _pad1: [u8; 2],              // 2
    pub oracle_price: u64,           // 8
    pub oracle_conf: u64,            // 8
    pub oracle_posted_slot: u64,     // 8
    pub clearing_price: u64,         // 8
    pub matched_lots: u64,           // 8
    pub bid_marginal_tick: u16,      // 2
    pub _pad2: [u8; 6],              // 6
    pub bid_marginal_alloc: u64,     // 8
    pub bid_marginal_total: u64,     // 8
    pub ask_marginal_tick: u16,      // 2
    pub _pad3: [u8; 6],              // 6
    pub ask_marginal_alloc: u64,     // 8
    pub ask_marginal_total: u64,     // 8
    pub bid_qty: [u64; K_TICKS],     // 808
    pub ask_qty: [u64; K_TICKS],     // 808
    pub orders: [Order; MAX_ORDERS], // 8192
}

const _: () = {
    assert!(std::mem::size_of::<Order>() == 64);
    assert!(8 + std::mem::size_of::<Batch>() <= 10240);
};

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
}
