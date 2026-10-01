use crate::state::{Batch, BatchStatus};
use anchor_lang::prelude::*;

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

pub fn handle_initialize_batch(ctx: Context<InitializeBatch>, batch_id: u64) -> Result<()> {
    let mut batch = ctx.accounts.batch.load_init()?;
    batch.batch_id = batch_id;
    batch.status = BatchStatus::OPEN;
    batch.num_orders = 0;
    batch.settled_orders = 0;
    msg!("Epoch batch account initialized: id={}", batch_id);
    Ok(())
}
