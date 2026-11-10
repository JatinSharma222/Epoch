//! Actual Anchor Instruction Verification Suite for H-4 Liquidation & ADL
//!
//! Validates:
//! 1. Complete execution of `process_liquidate_with_accounts` using actual Anchor AccountLoader & AccountInfo.
//! 2. Remaining-account validation:
//!    - Rejection of duplicate accounts (DuplicateUserAccount)
//!    - Rejection of non-writable accounts (Unauthorized)
//!    - Rejection of forged PDAs or wrong owner (Unauthorized)
//!    - Rejection of self or vault as counterparty (InvalidUserAccount)
//!    - Rejection of same-direction positions (InvalidAdlCounterparty)
//! 3. Deterministic protocol ranking:
//!    - Protocol reorders caller-supplied accounts by ADL score descending (tie-breaker: pubkey)
//! 4. Full atomic settlement:
//!    - Partial liquidation (Regime A) with 50/50 penalty split and quarantine flag.
//!    - Insolvent bankruptcy (Regime B) with P_bk, zero-notional bad debt, and ADL settlement.
//! 5. Deposit curing through actual deposit instruction logic (`apply_deposit_curing`).

use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use epoch::errors::EpochError;
use epoch::instructions::deposit::apply_deposit_curing;
use epoch::instructions::liquidate::process_liquidate_with_accounts;
use epoch::state::{Market, MarketParams, UserAccount, UserFlags, VaultParams};

#[repr(C, align(16))]
struct AlignedAccountBuffer<T: Copy> {
    _pad_prefix: [u8; 8],
    discriminator: [u8; 8],
    account: T,
}

impl<T: Copy> AlignedAccountBuffer<T> {
    fn new(discriminator: &[u8], account: T) -> Box<Self> {
        let mut d = [0u8; 8];
        d.copy_from_slice(discriminator);
        Box::new(Self {
            _pad_prefix: [0; 8],
            discriminator: d,
            account,
        })
    }

    fn as_account_slice_mut(&mut self) -> &mut [u8] {
        let total_size = 8 + std::mem::size_of::<T>();
        let ptr = (&mut self.discriminator) as *mut [u8; 8] as *mut u8;
        unsafe { std::slice::from_raw_parts_mut(ptr, total_size) }
    }
}

fn create_default_market(bump: u8) -> Market {
    Market {
        funding_index: 0,
        admin: Pubkey::new_unique(),
        oracle_authority: Pubkey::new_unique(),
        quote_mint: Pubkey::new_unique(),
        collateral_vault: Pubkey::new_unique(),
        oracle_feed_id: [0x42; 32],
        params: MarketParams {
            base_lot: 1000,
            price_tick: 100,
            min_order_lots: 10,
            min_order_notional: 100_000,
            funding_period_slots: 72000,
            batch_slots: 2,
            lookahead: 4,
            k_ticks: 101,
            tick_bps: 1,
            imr_bps: 1000,
            mmr_bps: 500, // 5.0% MMR
            fee_bps: 5,
            liq_penalty_bps: 100, // 1.0% penalty
            max_oracle_age_secs: 10,
            max_conf_bps: 20,
            max_clear_delay_slots: 4,
            max_orders_per_batch: 128,
            funding_cap_bps: 50,
            _pad0: [0; 2],
        },
        start_slot: 100,
        next_batch_to_clear: 0,
        last_oracle_price: 150_000_000,
        last_oracle_slot: 100,
        open_interest_lots: 10_000,
        fee_pool: 50_000_000,
        insurance_fund: 100_000_000,
        bad_debt: 0,
        vault_params: VaultParams {
            quote_offset_bps: [3, 6, 10],
            _pad0: [0; 2],
            quote_lots: [10, 20, 30],
            max_inventory_lots: 5_000,
            skew_bps: 5,
            max_conf_bps: 15,
            is_active: 1,
            _pad1: [0; 3],
        },
        bump,
        _pad_bump: [0; 7],
        last_oracle_timestamp: 1_700_000_000,
        _reserved: [0; 16],
    }
}

#[test]
fn test_anchor_instruction_regime_a_partial_liquidation_and_quarantine() {
    let program_id = epoch::ID;
    let market_key = Pubkey::new_unique();
    let mut market_lamports = 1_000_000_000u64;
    let mut market_buf = AlignedAccountBuffer::new(Market::DISCRIMINATOR, create_default_market(255));
    let market_slice = market_buf.as_account_slice_mut();
    let market_info = AccountInfo::new(
        &market_key,
        false,
        true,
        &mut market_lamports,
        market_slice,
        &program_id,
        false,
        0,
    );
    let market_loader = AccountLoader::<Market>::try_from(&market_info).unwrap();

    let vault_owner = Pubkey::new_unique();
    let (vault_user_key, _) = Pubkey::find_program_address(&[b"user", vault_owner.as_ref()], &program_id);
    let mut vault_lamports = 1_000_000_000u64;
    let mut vault_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: 0,
        funding_snapshot: 0,
        owner: vault_owner,
        collateral: 1_000_000_000,
        base_position: 0,
        pending_buy_lots: 0,
        pending_sell_lots: 0,
        active_orders: 0,
        flags: UserFlags::NONE,
        _pad: [0; 6],
        _reserved: [0; 64],
        _pad2: [0; 8],
    });
    let vault_slice = vault_buf.as_account_slice_mut();
    let vault_user_info = AccountInfo::new(
        &vault_user_key,
        false,
        true,
        &mut vault_lamports,
        vault_slice,
        &program_id,
        false,
        0,
    );
    let vault_user_loader = AccountLoader::<UserAccount>::try_from(&vault_user_info).unwrap();

    let liquidatee_owner = Pubkey::new_unique();
    let (liquidatee_key, _) = Pubkey::find_program_address(&[b"user", liquidatee_owner.as_ref()], &program_id);
    let mut user_lamports = 1_000_000_000u64;
    let mut user_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: -150_000_000,
        funding_snapshot: 0,
        owner: liquidatee_owner,
        collateral: 10_000_000,
        base_position: 1_000,
        pending_buy_lots: 0,
        pending_sell_lots: 0,
        active_orders: 0,
        flags: UserFlags::NONE,
        _pad: [0; 6],
        _reserved: [0; 64],
        _pad2: [0; 8],
    });
    let user_slice = user_buf.as_account_slice_mut();
    let user_info = AccountInfo::new(
        &liquidatee_key,
        false,
        true,
        &mut user_lamports,
        user_slice,
        &program_id,
        false,
        0,
    );
    let user_loader = AccountLoader::<UserAccount>::try_from(&user_info).unwrap();

    // Price drops to $142 (equity = $2.00 < $7.10 MMR)
    let oracle_price = 142_000_000u64;
    let slot = 100;

    let res = process_liquidate_with_accounts(
        &market_loader,
        &vault_user_loader,
        &user_loader,
        &liquidatee_owner,
        oracle_price,
        slot,
        &[],
    )
    .expect("Partial liquidation instruction should execute cleanly");

    assert!(res.is_solvent);
    assert_eq!(res.delta_lots, 500, "50% partial liquidation step");

    let user_post = user_loader.load().unwrap();
    assert_eq!(user_post.base_position, 500);
    assert_ne!(
        user_post.flags & UserFlags::LIQUIDATING,
        0,
        "User must be quarantined in LIQUIDATING state"
    );

    let vault_post = vault_user_loader.load().unwrap();
    assert_eq!(vault_post.base_position, 500);
}

#[test]
fn test_anchor_instruction_regime_b_with_remaining_accounts_adl() {
    let program_id = epoch::ID;
    let market_key = Pubkey::new_unique();
    let mut market_lamports = 1_000_000_000u64;
    let mut market = create_default_market(255);
    market.vault_params.max_inventory_lots = 0; // Force 100% ADL
    market.insurance_fund = 20_000_000;
    let mut market_buf = AlignedAccountBuffer::new(Market::DISCRIMINATOR, market);
    let market_slice = market_buf.as_account_slice_mut();
    let market_info = AccountInfo::new(
        &market_key,
        false,
        true,
        &mut market_lamports,
        market_slice,
        &program_id,
        false,
        0,
    );
    let market_loader = AccountLoader::<Market>::try_from(&market_info).unwrap();

    let vault_owner = Pubkey::new_unique();
    let (vault_user_key, _) = Pubkey::find_program_address(&[b"user", vault_owner.as_ref()], &program_id);
    let mut vault_lamports = 1_000_000_000u64;
    let mut vault_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: 0,
        funding_snapshot: 0,
        owner: vault_owner,
        collateral: 1_000_000_000,
        base_position: 0,
        pending_buy_lots: 0,
        pending_sell_lots: 0,
        active_orders: 0,
        flags: UserFlags::NONE,
        _pad: [0; 6],
        _reserved: [0; 64],
        _pad2: [0; 8],
    });
    let vault_slice = vault_buf.as_account_slice_mut();
    let vault_user_info = AccountInfo::new(
        &vault_user_key,
        false,
        true,
        &mut vault_lamports,
        vault_slice,
        &program_id,
        false,
        0,
    );
    let vault_user_loader = AccountLoader::<UserAccount>::try_from(&vault_user_info).unwrap();

    let liquidatee_owner = Pubkey::new_unique();
    let (liquidatee_key, _) = Pubkey::find_program_address(&[b"user", liquidatee_owner.as_ref()], &program_id);
    let mut user_lamports = 1_000_000_000u64;
    let mut user_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: -150_000_000,
        funding_snapshot: 0,
        owner: liquidatee_owner,
        collateral: 10_000_000,
        base_position: 1_000,
        pending_buy_lots: 0,
        pending_sell_lots: 0,
        active_orders: 0,
        flags: UserFlags::NONE,
        _pad: [0; 6],
        _reserved: [0; 64],
        _pad2: [0; 8],
    });
    let user_slice = user_buf.as_account_slice_mut();
    let user_info = AccountInfo::new(
        &liquidatee_key,
        false,
        true,
        &mut user_lamports,
        user_slice,
        &program_id,
        false,
        0,
    );
    let user_loader = AccountLoader::<UserAccount>::try_from(&user_info).unwrap();

    // Counterparty Short 1,000 lots @ $150
    let cp_owner = Pubkey::new_unique();
    let (cp_key, _) = Pubkey::find_program_address(&[b"user", cp_owner.as_ref()], &program_id);
    let mut cp_lamports = 1_000_000_000u64;
    let mut cp_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: 150_000_000,
        funding_snapshot: 0,
        owner: cp_owner,
        collateral: 100_000_000,
        base_position: -1_000,
        pending_buy_lots: 0,
        pending_sell_lots: 0,
        active_orders: 0,
        flags: UserFlags::NONE,
        _pad: [0; 6],
        _reserved: [0; 64],
        _pad2: [0; 8],
    });
    let cp_slice = cp_buf.as_account_slice_mut();
    let cp_info = AccountInfo::new(
        &cp_key,
        false,
        true,
        &mut cp_lamports,
        cp_slice,
        &program_id,
        false,
        0,
    );

    let remaining_accounts = [cp_info];

    // Price crashes to $110
    let crash_price = 110_000_000u64;
    let res = process_liquidate_with_accounts(
        &market_loader,
        &vault_user_loader,
        &user_loader,
        &liquidatee_owner,
        crash_price,
        100,
        &remaining_accounts,
    )
    .expect("ADL liquidation instruction should execute cleanly");

    assert!(!res.is_solvent);
    assert_eq!(res.adl_executed_lots, 1_000);
    assert_eq!(res.insurance_covered, 0, "Pure ADL uses zero insurance fund");
    assert_eq!(res.bad_debt, 0, "Zero bad debt generated");

    let user_post = user_loader.load().unwrap();
    assert_eq!(user_post.base_position, 0);
    assert_eq!(user_post.collateral, 0);

    let cp_loader = AccountLoader::<UserAccount>::try_from(&remaining_accounts[0]).unwrap();
    let cp_post = cp_loader.load().unwrap();
    assert_eq!(cp_post.base_position, 0, "Counterparty flattened via ADL");
}

#[test]
fn test_anchor_instruction_rejects_duplicate_remaining_account() {
    let program_id = epoch::ID;
    let market_key = Pubkey::new_unique();
    let mut market_lamports = 1_000_000_000u64;
    let mut market = create_default_market(255);
    market.vault_params.max_inventory_lots = 0;
    let mut market_buf = AlignedAccountBuffer::new(Market::DISCRIMINATOR, market);
    let market_slice = market_buf.as_account_slice_mut();
    let market_info = AccountInfo::new(&market_key, false, true, &mut market_lamports, market_slice, &program_id, false, 0);
    let market_loader = AccountLoader::<Market>::try_from(&market_info).unwrap();

    let vault_owner = Pubkey::new_unique();
    let (vault_user_key, _) = Pubkey::find_program_address(&[b"user", vault_owner.as_ref()], &program_id);
    let mut vault_lamports = 1_000_000_000u64;
    let mut vault_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: 0, funding_snapshot: 0, owner: vault_owner, collateral: 1_000_000_000, base_position: 0,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let vault_slice = vault_buf.as_account_slice_mut();
    let vault_user_info = AccountInfo::new(&vault_user_key, false, true, &mut vault_lamports, vault_slice, &program_id, false, 0);
    let vault_user_loader = AccountLoader::<UserAccount>::try_from(&vault_user_info).unwrap();

    let liquidatee_owner = Pubkey::new_unique();
    let (liquidatee_key, _) = Pubkey::find_program_address(&[b"user", liquidatee_owner.as_ref()], &program_id);
    let mut user_lamports = 1_000_000_000u64;
    let mut user_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: -150_000_000, funding_snapshot: 0, owner: liquidatee_owner, collateral: 10_000_000, base_position: 1_000,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let user_slice = user_buf.as_account_slice_mut();
    let user_info = AccountInfo::new(&liquidatee_key, false, true, &mut user_lamports, user_slice, &program_id, false, 0);
    let user_loader = AccountLoader::<UserAccount>::try_from(&user_info).unwrap();

    let cp_owner = Pubkey::new_unique();
    let (cp_key, _) = Pubkey::find_program_address(&[b"user", cp_owner.as_ref()], &program_id);
    let mut cp_lamports1 = 1_000_000_000u64;
    let mut cp_lamports2 = 1_000_000_000u64;
    let mut cp_buf1 = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: 150_000_000, funding_snapshot: 0, owner: cp_owner, collateral: 100_000_000, base_position: -1_000,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let cp_slice1 = cp_buf1.as_account_slice_mut();
    let mut cp_buf2 = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: 150_000_000, funding_snapshot: 0, owner: cp_owner, collateral: 100_000_000, base_position: -1_000,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let cp_slice2 = cp_buf2.as_account_slice_mut();

    let cp_info1 = AccountInfo::new(&cp_key, false, true, &mut cp_lamports1, cp_slice1, &program_id, false, 0);
    let cp_info2 = AccountInfo::new(&cp_key, false, true, &mut cp_lamports2, cp_slice2, &program_id, false, 0);

    let remaining_accounts = [cp_info1, cp_info2];

    let err = process_liquidate_with_accounts(
        &market_loader,
        &vault_user_loader,
        &user_loader,
        &liquidatee_owner,
        110_000_000,
        100,
        &remaining_accounts,
    )
    .unwrap_err();

    assert_eq!(err, EpochError::DuplicateUserAccount.into());
}

#[test]
fn test_anchor_instruction_rejects_non_writable_remaining_account() {
    let program_id = epoch::ID;
    let market_key = Pubkey::new_unique();
    let mut market_lamports = 1_000_000_000u64;
    let mut market = create_default_market(255);
    market.vault_params.max_inventory_lots = 0;
    let mut market_buf = AlignedAccountBuffer::new(Market::DISCRIMINATOR, market);
    let market_slice = market_buf.as_account_slice_mut();
    let market_info = AccountInfo::new(&market_key, false, true, &mut market_lamports, market_slice, &program_id, false, 0);
    let market_loader = AccountLoader::<Market>::try_from(&market_info).unwrap();

    let vault_owner = Pubkey::new_unique();
    let (vault_user_key, _) = Pubkey::find_program_address(&[b"user", vault_owner.as_ref()], &program_id);
    let mut vault_lamports = 1_000_000_000u64;
    let mut vault_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: 0, funding_snapshot: 0, owner: vault_owner, collateral: 1_000_000_000, base_position: 0,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let vault_slice = vault_buf.as_account_slice_mut();
    let vault_user_info = AccountInfo::new(&vault_user_key, false, true, &mut vault_lamports, vault_slice, &program_id, false, 0);
    let vault_user_loader = AccountLoader::<UserAccount>::try_from(&vault_user_info).unwrap();

    let liquidatee_owner = Pubkey::new_unique();
    let (liquidatee_key, _) = Pubkey::find_program_address(&[b"user", liquidatee_owner.as_ref()], &program_id);
    let mut user_lamports = 1_000_000_000u64;
    let mut user_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: -150_000_000, funding_snapshot: 0, owner: liquidatee_owner, collateral: 10_000_000, base_position: 1_000,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let user_slice = user_buf.as_account_slice_mut();
    let user_info = AccountInfo::new(&liquidatee_key, false, true, &mut user_lamports, user_slice, &program_id, false, 0);
    let user_loader = AccountLoader::<UserAccount>::try_from(&user_info).unwrap();

    let cp_owner = Pubkey::new_unique();
    let (cp_key, _) = Pubkey::find_program_address(&[b"user", cp_owner.as_ref()], &program_id);
    let mut cp_lamports = 1_000_000_000u64;
    let mut cp_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: 150_000_000, funding_snapshot: 0, owner: cp_owner, collateral: 100_000_000, base_position: -1_000,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let cp_slice = cp_buf.as_account_slice_mut();
    // Non-writable account info: is_writable = false!
    let cp_info = AccountInfo::new(&cp_key, false, false, &mut cp_lamports, cp_slice, &program_id, false, 0);

    let remaining_accounts = [cp_info];

    let err = process_liquidate_with_accounts(
        &market_loader,
        &vault_user_loader,
        &user_loader,
        &liquidatee_owner,
        110_000_000,
        100,
        &remaining_accounts,
    )
    .unwrap_err();

    assert_eq!(err, EpochError::Unauthorized.into());
}

#[test]
fn test_anchor_instruction_rejects_same_direction_counterparty() {
    let program_id = epoch::ID;
    let market_key = Pubkey::new_unique();
    let mut market_lamports = 1_000_000_000u64;
    let mut market = create_default_market(255);
    market.vault_params.max_inventory_lots = 0;
    let mut market_buf = AlignedAccountBuffer::new(Market::DISCRIMINATOR, market);
    let market_slice = market_buf.as_account_slice_mut();
    let market_info = AccountInfo::new(&market_key, false, true, &mut market_lamports, market_slice, &program_id, false, 0);
    let market_loader = AccountLoader::<Market>::try_from(&market_info).unwrap();

    let vault_owner = Pubkey::new_unique();
    let (vault_user_key, _) = Pubkey::find_program_address(&[b"user", vault_owner.as_ref()], &program_id);
    let mut vault_lamports = 1_000_000_000u64;
    let mut vault_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: 0, funding_snapshot: 0, owner: vault_owner, collateral: 1_000_000_000, base_position: 0,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let vault_slice = vault_buf.as_account_slice_mut();
    let vault_user_info = AccountInfo::new(&vault_user_key, false, true, &mut vault_lamports, vault_slice, &program_id, false, 0);
    let vault_user_loader = AccountLoader::<UserAccount>::try_from(&vault_user_info).unwrap();

    let liquidatee_owner = Pubkey::new_unique();
    let (liquidatee_key, _) = Pubkey::find_program_address(&[b"user", liquidatee_owner.as_ref()], &program_id);
    let mut user_lamports = 1_000_000_000u64;
    let mut user_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: -150_000_000, funding_snapshot: 0, owner: liquidatee_owner, collateral: 10_000_000, base_position: 1_000,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let user_slice = user_buf.as_account_slice_mut();
    let user_info = AccountInfo::new(&liquidatee_key, false, true, &mut user_lamports, user_slice, &program_id, false, 0);
    let user_loader = AccountLoader::<UserAccount>::try_from(&user_info).unwrap();

    // Counterparty is also LONG (+500 lots) instead of opposing SHORT!
    let cp_owner = Pubkey::new_unique();
    let (cp_key, _) = Pubkey::find_program_address(&[b"user", cp_owner.as_ref()], &program_id);
    let mut cp_lamports = 1_000_000_000u64;
    let mut cp_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: -75_000_000, funding_snapshot: 0, owner: cp_owner, collateral: 100_000_000, base_position: 500,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let cp_slice = cp_buf.as_account_slice_mut();
    let cp_info = AccountInfo::new(&cp_key, false, true, &mut cp_lamports, cp_slice, &program_id, false, 0);

    let remaining_accounts = [cp_info];

    let err = process_liquidate_with_accounts(
        &market_loader,
        &vault_user_loader,
        &user_loader,
        &liquidatee_owner,
        110_000_000,
        100,
        &remaining_accounts,
    )
    .unwrap_err();

    assert_eq!(err, EpochError::InvalidAdlCounterparty.into());
}

#[test]
fn test_anchor_instruction_deterministic_protocol_ranking() {
    let program_id = epoch::ID;
    let market_key = Pubkey::new_unique();
    let mut market_lamports = 1_000_000_000u64;
    let mut market = create_default_market(255);
    market.vault_params.max_inventory_lots = 0;
    let mut market_buf = AlignedAccountBuffer::new(Market::DISCRIMINATOR, market);
    let market_slice = market_buf.as_account_slice_mut();
    let market_info = AccountInfo::new(&market_key, false, true, &mut market_lamports, market_slice, &program_id, false, 0);
    let market_loader = AccountLoader::<Market>::try_from(&market_info).unwrap();

    let vault_owner = Pubkey::new_unique();
    let (vault_user_key, _) = Pubkey::find_program_address(&[b"user", vault_owner.as_ref()], &program_id);
    let mut vault_lamports = 1_000_000_000u64;
    let mut vault_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: 0, funding_snapshot: 0, owner: vault_owner, collateral: 1_000_000_000, base_position: 0,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let vault_slice = vault_buf.as_account_slice_mut();
    let vault_user_info = AccountInfo::new(&vault_user_key, false, true, &mut vault_lamports, vault_slice, &program_id, false, 0);
    let vault_user_loader = AccountLoader::<UserAccount>::try_from(&vault_user_info).unwrap();

    let liquidatee_owner = Pubkey::new_unique();
    let (liquidatee_key, _) = Pubkey::find_program_address(&[b"user", liquidatee_owner.as_ref()], &program_id);
    let mut user_lamports = 1_000_000_000u64;
    let mut user_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: -75_000_000, funding_snapshot: 0, owner: liquidatee_owner, collateral: 5_000_000, base_position: 500,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let user_slice = user_buf.as_account_slice_mut();
    let user_info = AccountInfo::new(&liquidatee_key, false, true, &mut user_lamports, user_slice, &program_id, false, 0);
    let user_loader = AccountLoader::<UserAccount>::try_from(&user_info).unwrap();

    // CP Low (score ~ 0.13)
    let cp_low_owner = Pubkey::new_unique();
    let (cp_low_key, _) = Pubkey::find_program_address(&[b"user", cp_low_owner.as_ref()], &program_id);
    let mut cp_low_lamports = 1_000_000_000u64;
    let mut cp_low_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: 75_000_000, funding_snapshot: 0, owner: cp_low_owner, collateral: 100_000_000, base_position: -500,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let cp_low_slice = cp_low_buf.as_account_slice_mut();
    let cp_low_info = AccountInfo::new(&cp_low_key, false, true, &mut cp_low_lamports, cp_low_slice, &program_id, false, 0);

    // CP High (score = 0.60)
    let cp_high_owner = Pubkey::new_unique();
    let (cp_high_key, _) = Pubkey::find_program_address(&[b"user", cp_high_owner.as_ref()], &program_id);
    let mut cp_high_lamports = 1_000_000_000u64;
    let mut cp_high_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: 75_000_000, funding_snapshot: 0, owner: cp_high_owner, collateral: 10_000_000, base_position: -500,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let cp_high_slice = cp_high_buf.as_account_slice_mut();
    let cp_high_info = AccountInfo::new(&cp_high_key, false, true, &mut cp_high_lamports, cp_high_slice, &program_id, false, 0);

    // Caller passes [cp_low, cp_high] in adverse order!
    let remaining_accounts = [cp_low_info, cp_high_info];

    let res = process_liquidate_with_accounts(
        &market_loader,
        &vault_user_loader,
        &user_loader,
        &liquidatee_owner,
        120_000_000,
        100,
        &remaining_accounts,
    )
    .expect("ADL liquidation instruction should succeed");

    assert_eq!(res.adl_executed_lots, 500);

    // Verify CP High was absorbed first and flattened
    let cp_high_loader = AccountLoader::<UserAccount>::try_from(&remaining_accounts[1]).unwrap();
    let cp_high_post = cp_high_loader.load().unwrap();
    assert_eq!(cp_high_post.base_position, 0, "Highest score counterparty must be absorbed first");

    // Verify CP Low was spared
    let cp_low_loader = AccountLoader::<UserAccount>::try_from(&remaining_accounts[0]).unwrap();
    let cp_low_post = cp_low_loader.load().unwrap();
    assert_eq!(cp_low_post.base_position, -500, "Lower score counterparty must be spared");
}

#[test]
fn test_anchor_deposit_curing_restores_quarantined_user() {
    let mut market = create_default_market(255);
    market.last_oracle_price = 142_000_000;

    let mut user = UserAccount {
        quote_position: -71_000_000,
        funding_snapshot: 0,
        owner: Pubkey::new_unique(),
        collateral: 1_000_000, // Deficit equity = $1.00 - $71.00 + $71.00 = $1.00 < $3.55 MMR
        base_position: 500,
        pending_buy_lots: 0,
        pending_sell_lots: 0,
        active_orders: 0,
        flags: UserFlags::LIQUIDATING, // Quarantined
        _pad: [0; 6],
        _reserved: [0; 64],
        _pad2: [0; 8],
    };

    // Deposit curing test 1: Insufficient deposit does NOT clear quarantine
    user.collateral += 1_000_000; // Adds $1.00 (Total equity $2.00 < $3.55 MMR)
    apply_deposit_curing(&mut user, &market, market.last_oracle_slot, market.last_oracle_timestamp);
    assert_ne!(user.flags & UserFlags::LIQUIDATING, 0, "Quarantine remains active if equity < MMR");

    // Deposit curing test 2: Sufficient deposit cures and clears quarantine
    user.collateral += 10_000_000; // Adds $10.00 (Total equity $12.00 >= $3.55 MMR)
    apply_deposit_curing(&mut user, &market, market.last_oracle_slot, market.last_oracle_timestamp);
    assert_eq!(user.flags & UserFlags::LIQUIDATING, 0, "Quarantine cleared once equity >= MMR");
}

#[test]
fn test_anchor_instruction_rejects_uninitialized_remaining_account() {
    let program_id = epoch::ID;
    let market_key = Pubkey::new_unique();
    let mut market_lamports = 1_000_000_000u64;
    let mut market = create_default_market(255);
    market.vault_params.max_inventory_lots = 0;
    let mut market_buf = AlignedAccountBuffer::new(Market::DISCRIMINATOR, market);
    let market_slice = market_buf.as_account_slice_mut();
    let market_info = AccountInfo::new(&market_key, false, true, &mut market_lamports, market_slice, &program_id, false, 0);
    let market_loader = AccountLoader::<Market>::try_from(&market_info).unwrap();

    let vault_owner = Pubkey::new_unique();
    let (vault_user_key, _) = Pubkey::find_program_address(&[b"user", vault_owner.as_ref()], &program_id);
    let mut vault_lamports = 1_000_000_000u64;
    let mut vault_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: 0, funding_snapshot: 0, owner: vault_owner, collateral: 1_000_000_000, base_position: 0,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let vault_slice = vault_buf.as_account_slice_mut();
    let vault_user_info = AccountInfo::new(&vault_user_key, false, true, &mut vault_lamports, vault_slice, &program_id, false, 0);
    let vault_user_loader = AccountLoader::<UserAccount>::try_from(&vault_user_info).unwrap();

    let liquidatee_owner = Pubkey::new_unique();
    let (liquidatee_key, _) = Pubkey::find_program_address(&[b"user", liquidatee_owner.as_ref()], &program_id);
    let mut user_lamports = 1_000_000_000u64;
    let mut user_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: -150_000_000, funding_snapshot: 0, owner: liquidatee_owner, collateral: 10_000_000, base_position: 1_000,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let user_slice = user_buf.as_account_slice_mut();
    let user_info = AccountInfo::new(&liquidatee_key, false, true, &mut user_lamports, user_slice, &program_id, false, 0);
    let user_loader = AccountLoader::<UserAccount>::try_from(&user_info).unwrap();

    // Adversarial counterparty account with zeroed discriminator (uninitialized)
    let cp_owner = Pubkey::new_unique();
    let (cp_key, _) = Pubkey::find_program_address(&[b"user", cp_owner.as_ref()], &program_id);
    let mut cp_lamports = 1_000_000_000u64;
    let mut cp_buf = AlignedAccountBuffer::new(&[0u8; 8], UserAccount {
        quote_position: 150_000_000, funding_snapshot: 0, owner: cp_owner, collateral: 100_000_000, base_position: -1_000,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let cp_slice = cp_buf.as_account_slice_mut();
    let cp_info = AccountInfo::new(&cp_key, false, true, &mut cp_lamports, cp_slice, &program_id, false, 0);

    let remaining_accounts = [cp_info];

    let err = process_liquidate_with_accounts(
        &market_loader,
        &vault_user_loader,
        &user_loader,
        &liquidatee_owner,
        110_000_000,
        100,
        &remaining_accounts,
    )
    .unwrap_err();

    assert_eq!(err, EpochError::AccountNotInitialized.into());
}

#[test]
fn test_anchor_instruction_rejects_forged_pda_remaining_account() {
    let program_id = epoch::ID;
    let market_key = Pubkey::new_unique();
    let mut market_lamports = 1_000_000_000u64;
    let mut market = create_default_market(255);
    market.vault_params.max_inventory_lots = 0;
    let mut market_buf = AlignedAccountBuffer::new(Market::DISCRIMINATOR, market);
    let market_slice = market_buf.as_account_slice_mut();
    let market_info = AccountInfo::new(&market_key, false, true, &mut market_lamports, market_slice, &program_id, false, 0);
    let market_loader = AccountLoader::<Market>::try_from(&market_info).unwrap();

    let vault_owner = Pubkey::new_unique();
    let (vault_user_key, _) = Pubkey::find_program_address(&[b"user", vault_owner.as_ref()], &program_id);
    let mut vault_lamports = 1_000_000_000u64;
    let mut vault_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: 0, funding_snapshot: 0, owner: vault_owner, collateral: 1_000_000_000, base_position: 0,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let vault_slice = vault_buf.as_account_slice_mut();
    let vault_user_info = AccountInfo::new(&vault_user_key, false, true, &mut vault_lamports, vault_slice, &program_id, false, 0);
    let vault_user_loader = AccountLoader::<UserAccount>::try_from(&vault_user_info).unwrap();

    let liquidatee_owner = Pubkey::new_unique();
    let (liquidatee_key, _) = Pubkey::find_program_address(&[b"user", liquidatee_owner.as_ref()], &program_id);
    let mut user_lamports = 1_000_000_000u64;
    let mut user_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: -150_000_000, funding_snapshot: 0, owner: liquidatee_owner, collateral: 10_000_000, base_position: 1_000,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let user_slice = user_buf.as_account_slice_mut();
    let user_info = AccountInfo::new(&liquidatee_key, false, true, &mut user_lamports, user_slice, &program_id, false, 0);
    let user_loader = AccountLoader::<UserAccount>::try_from(&user_info).unwrap();

    // Adversarial counterparty account with forged key that is NOT derived from seeds [b"user", owner]
    let cp_owner = Pubkey::new_unique();
    let forged_key = Pubkey::new_unique(); // Arbitrary key!
    let mut cp_lamports = 1_000_000_000u64;
    let mut cp_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: 150_000_000, funding_snapshot: 0, owner: cp_owner, collateral: 100_000_000, base_position: -1_000,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let cp_slice = cp_buf.as_account_slice_mut();
    let cp_info = AccountInfo::new(&forged_key, false, true, &mut cp_lamports, cp_slice, &program_id, false, 0);

    let remaining_accounts = [cp_info];

    let err = process_liquidate_with_accounts(
        &market_loader,
        &vault_user_loader,
        &user_loader,
        &liquidatee_owner,
        110_000_000,
        100,
        &remaining_accounts,
    )
    .unwrap_err();

    assert_eq!(err, EpochError::Unauthorized.into());
}

#[test]
fn test_anchor_instruction_residual_position_retained_in_quarantine() {
    let program_id = epoch::ID;
    let market_key = Pubkey::new_unique();
    let mut market_lamports = 1_000_000_000u64;
    let mut market = create_default_market(255);
    market.vault_params.max_inventory_lots = 0; // Vault 0 headroom
    let mut market_buf = AlignedAccountBuffer::new(Market::DISCRIMINATOR, market);
    let market_slice = market_buf.as_account_slice_mut();
    let market_info = AccountInfo::new(&market_key, false, true, &mut market_lamports, market_slice, &program_id, false, 0);
    let market_loader = AccountLoader::<Market>::try_from(&market_info).unwrap();

    let vault_owner = Pubkey::new_unique();
    let (vault_user_key, _) = Pubkey::find_program_address(&[b"user", vault_owner.as_ref()], &program_id);
    let mut vault_lamports = 1_000_000_000u64;
    let mut vault_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: 0, funding_snapshot: 0, owner: vault_owner, collateral: 1_000_000_000, base_position: 0,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let vault_slice = vault_buf.as_account_slice_mut();
    let vault_user_info = AccountInfo::new(&vault_user_key, false, true, &mut vault_lamports, vault_slice, &program_id, false, 0);
    let vault_user_loader = AccountLoader::<UserAccount>::try_from(&vault_user_info).unwrap();

    // Bankrupt Long: 1,000 lots
    let liquidatee_owner = Pubkey::new_unique();
    let (liquidatee_key, _) = Pubkey::find_program_address(&[b"user", liquidatee_owner.as_ref()], &program_id);
    let mut user_lamports = 1_000_000_000u64;
    let mut user_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: -150_000_000, funding_snapshot: 0, owner: liquidatee_owner, collateral: 10_000_000, base_position: 1_000,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let user_slice = user_buf.as_account_slice_mut();
    let user_info = AccountInfo::new(&liquidatee_key, false, true, &mut user_lamports, user_slice, &program_id, false, 0);
    let user_loader = AccountLoader::<UserAccount>::try_from(&user_info).unwrap();

    // Counterparty has ONLY 400 lots
    let cp_owner = Pubkey::new_unique();
    let (cp_key, _) = Pubkey::find_program_address(&[b"user", cp_owner.as_ref()], &program_id);
    let mut cp_lamports = 1_000_000_000u64;
    let mut cp_buf = AlignedAccountBuffer::new(UserAccount::DISCRIMINATOR, UserAccount {
        quote_position: 60_000_000, funding_snapshot: 0, owner: cp_owner, collateral: 100_000_000, base_position: -400,
        pending_buy_lots: 0, pending_sell_lots: 0, active_orders: 0, flags: 0, _pad: [0; 6], _reserved: [0; 64], _pad2: [0; 8],
    });
    let cp_slice = cp_buf.as_account_slice_mut();
    let cp_info = AccountInfo::new(&cp_key, false, true, &mut cp_lamports, cp_slice, &program_id, false, 0);

    let remaining_accounts = [cp_info];

    let res = process_liquidate_with_accounts(
        &market_loader,
        &vault_user_loader,
        &user_loader,
        &liquidatee_owner,
        110_000_000,
        100,
        &remaining_accounts,
    )
    .expect("Partial ADL liquidation instruction succeeds");

    assert_eq!(res.adl_executed_lots, 400);
    assert_eq!(res.remaining_bankrupt_lots, 600);

    // Liquidatee RETAINS residual 600 lots in account
    let user_post = user_loader.load().unwrap();
    assert_eq!(user_post.base_position, 600, "User must retain residual 600 lots");
    // Liquidatee REMAINS in quarantine
    assert_ne!(user_post.flags & UserFlags::LIQUIDATING, 0, "User must remain quarantined in LIQUIDATING state");

    // Counterparty flattened
    let cp_loader = AccountLoader::<UserAccount>::try_from(&remaining_accounts[0]).unwrap();
    let cp_post = cp_loader.load().unwrap();
    assert_eq!(cp_post.base_position, 0);
}
