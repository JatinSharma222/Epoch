use crate::errors::EpochError;
use crate::state::constants::{FAUCET_COOLDOWN_SECONDS, MAX_FAUCET_AMOUNT};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

#[account]
#[derive(Default)]
pub struct FaucetRecord {
    pub last_claim_time: i64,
}

#[derive(Accounts)]
pub struct Faucet<'info> {
    /// Mock USDC mint.
    #[account(
        mut,
        seeds = [b"quote_mint"],
        bump
    )]
    pub quote_mint: Account<'info, Mint>,

    /// PDA authority allowed to mint mock USDC.
    /// CHECK: PDA derived with seed [b"mint_authority"].
    #[account(
        seeds = [b"mint_authority"],
        bump
    )]
    pub mint_authority: UncheckedAccount<'info>,

    /// Token account receiving the newly minted tokens.
    #[account(
        mut,
        token::mint = quote_mint,
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    /// PDA tracking last faucet claim time for rate limiting.
    #[account(
        init_if_needed,
        payer = recipient,
        space = 8 + 8,
        seeds = [b"faucet", recipient.key().as_ref()],
        bump
    )]
    pub faucet_record: Account<'info, FaucetRecord>,

    #[account(mut)]
    pub recipient: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn validate_faucet_cooldown(
    last_claim_time: i64,
    current_time: i64,
    cooldown_seconds: i64,
) -> Result<()> {
    if last_claim_time > 0 {
        require!(
            current_time >= last_claim_time.saturating_add(cooldown_seconds),
            EpochError::FaucetCooldownActive
        );
    }
    Ok(())
}

pub fn handle_faucet(ctx: Context<Faucet>, amount: u64) -> Result<()> {
    require!(amount > 0, EpochError::ZeroAmount);
    require!(amount <= MAX_FAUCET_AMOUNT, EpochError::FaucetCapExceeded);

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    validate_faucet_cooldown(
        ctx.accounts.faucet_record.last_claim_time,
        now,
        FAUCET_COOLDOWN_SECONDS,
    )?;
    ctx.accounts.faucet_record.last_claim_time = now;

    let authority_bump = ctx.bumps.mint_authority;
    let seeds = &[b"mint_authority".as_ref(), &[authority_bump]];
    let signer = &[&seeds[..]];

    let cpi_accounts = MintTo {
        mint: ctx.accounts.quote_mint.to_account_info(),
        to: ctx.accounts.recipient_token_account.to_account_info(),
        authority: ctx.accounts.mint_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer,
    );
    token::mint_to(cpi_ctx, amount)?;

    msg!(
        "Faucet minted {} micro-USDC to {}",
        amount,
        ctx.accounts.recipient_token_account.key()
    );

    Ok(())
}
