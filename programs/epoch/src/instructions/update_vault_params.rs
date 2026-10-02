use crate::errors::EpochError;
use crate::state::{Market, VaultParams};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct UpdateVaultParamsArgs {
    pub quote_offset_bps: [u16; 3],
    pub quote_lots: [u64; 3],
    pub max_inventory_lots: u64,
    pub skew_bps: u16,
    pub max_conf_bps: u16,
    pub is_active: u8,
}

impl From<UpdateVaultParamsArgs> for VaultParams {
    fn from(args: UpdateVaultParamsArgs) -> Self {
        Self {
            quote_offset_bps: args.quote_offset_bps,
            _pad0: [0; 2],
            quote_lots: args.quote_lots,
            max_inventory_lots: args.max_inventory_lots,
            skew_bps: args.skew_bps,
            max_conf_bps: args.max_conf_bps,
            is_active: args.is_active,
            _pad1: [0; 3],
        }
    }
}

#[derive(Accounts)]
pub struct UpdateVaultParams<'info> {
    #[account(
        mut,
        seeds = [b"market"],
        bump = market.load()?.bump,
        has_one = admin @ EpochError::Unauthorized,
    )]
    pub market: AccountLoader<'info, Market>,

    pub admin: Signer<'info>,
}

pub fn handle_update_vault_params(
    ctx: Context<UpdateVaultParams>,
    new_params: UpdateVaultParamsArgs,
) -> Result<()> {
    let mut market = ctx.accounts.market.load_mut()?;
    market.vault_params = new_params.into();
    msg!(
        "Backstop Vault parameters updated by admin: {}",
        ctx.accounts.admin.key()
    );
    Ok(())
}
