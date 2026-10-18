use epoch::errors::EpochError;
use epoch::instructions::faucet::validate_faucet_cooldown;
use epoch::state::constants::FAUCET_COOLDOWN_SECONDS;

#[test]
fn test_faucet_first_claim_succeeds() {
    let last_claim_time = 0i64;
    let now = 1_700_000_000i64;
    let res = validate_faucet_cooldown(last_claim_time, now, FAUCET_COOLDOWN_SECONDS);
    assert!(res.is_ok(), "First claim with no prior history should succeed");
}

#[test]
fn test_faucet_claim_within_cooldown_rejected() {
    let last_claim_time = 1_700_000_000i64;
    let now = 1_700_000_030i64; // only 30s later (cooldown is 60s)
    let res = validate_faucet_cooldown(last_claim_time, now, FAUCET_COOLDOWN_SECONDS);
    assert_eq!(
        res.unwrap_err(),
        EpochError::FaucetCooldownActive.into(),
        "Claim within 60s cooldown must be rejected with FaucetCooldownActive"
    );
}

#[test]
fn test_faucet_claim_after_cooldown_succeeds() {
    let last_claim_time = 1_700_000_000i64;
    let now = 1_700_000_060i64; // exactly 60s later
    let res = validate_faucet_cooldown(last_claim_time, now, FAUCET_COOLDOWN_SECONDS);
    assert!(res.is_ok(), "Claim after 60s cooldown expires must succeed");

    let now_later = 1_700_000_120i64; // 120s later
    let res2 = validate_faucet_cooldown(last_claim_time, now_later, FAUCET_COOLDOWN_SECONDS);
    assert!(res2.is_ok(), "Claim after long period must succeed");
}
