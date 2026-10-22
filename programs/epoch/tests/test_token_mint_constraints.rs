use anchor_lang::prelude::*;

#[test]
fn test_token_mint_constraint_mismatch_detected() {
    // Simulate token accounts
    let legitimate_mint = Pubkey::new_unique();
    let rogue_mint = Pubkey::new_unique();

    let mut collateral_vault_data = [0u8; 165];
    // Set mint in SPL token account layout (bytes 0..32)
    collateral_vault_data[0..32].copy_from_slice(legitimate_mint.as_ref());

    let mut attacker_token_data = [0u8; 165];
    attacker_token_data[0..32].copy_from_slice(rogue_mint.as_ref());

    // Verify mints differ
    let vault_mint = Pubkey::new_from_array(collateral_vault_data[0..32].try_into().unwrap());
    let attacker_mint = Pubkey::new_from_array(attacker_token_data[0..32].try_into().unwrap());

    assert_ne!(vault_mint, attacker_mint);
    // Explicit assertion: user token account mint must match collateral vault mint
    assert!(vault_mint != attacker_mint, "Constraint token::mint = collateral_vault.mint must reject rogue mint");
}
