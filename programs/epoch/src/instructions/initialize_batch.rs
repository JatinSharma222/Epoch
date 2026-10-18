use crate::errors::EpochError;
use crate::state::constants::RING_SIZE;
use crate::state::{Batch, BatchStatus, Market, Order, K_TICKS, MAX_ORDERS};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(ring_index: u8)]
pub struct InitializeBatch<'info> {
    #[account(
        seeds = [b"market"],
        bump = market.load()?.bump,
        has_one = admin @ EpochError::Unauthorized,
    )]
    pub market: AccountLoader<'info, Market>,

    #[account(
        init,
        payer = admin,
        space = 8 + std::mem::size_of::<Batch>(),
        seeds = [b"batch".as_ref(), &[ring_index]],
        bump
    )]
    pub batch: AccountLoader<'info, Batch>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_batch(
    ctx: Context<InitializeBatch>,
    ring_index: u8,
    batch_id: u64,
) -> Result<()> {
    require!(ring_index < RING_SIZE, EpochError::InvalidSlotId);
    let expected_ring_index = (batch_id % RING_SIZE as u64) as u8;
    require_eq!(ring_index, expected_ring_index, EpochError::InvalidSlotId);
    require_eq!(batch_id, ring_index as u64, EpochError::InvalidSlotId);

    let mut batch = ctx.accounts.batch.load_init()?;
    batch.batch_id = batch_id;
    batch.status = BatchStatus::OPEN;
    batch.num_orders = 0;
    batch.settled_orders = 0;
    batch.clearing_tick = 0;
    batch.oracle_price = 0;
    batch.oracle_conf = 0;
    batch.oracle_posted_slot = 0;
    batch.clearing_price = 0;
    batch.matched_lots = 0;
    batch.bid_marginal_tick = 0;
    batch.bid_marginal_alloc = 0;
    batch.bid_marginal_total = 0;
    batch.ask_marginal_tick = 0;
    batch.ask_marginal_alloc = 0;
    batch.ask_marginal_total = 0;
    batch.bid_qty = [0; K_TICKS];
    batch.ask_qty = [0; K_TICKS];
    batch.orders = [Order {
        user_pda: Pubkey::default(),
        lots: 0,
        filled_lots: 0,
        tick: 0,
        side: 0,
        slot_id: 0,
        status: 0,
        flags: 0,
        _padding: [0; 10],
    }; MAX_ORDERS];

    msg!(
        "Epoch batch account initialized: ring_index={}, batch_id={}",
        ring_index,
        batch_id
    );
    Ok(())
}
