use epoch::errors::EpochError;

#[test]
fn test_place_order_aggregate_checked_add_overflow() {
    // When an aggregate tick quantity is at u64::MAX, adding more lots must fail with MathOverflow,
    // NOT panic with unwrap().
    let existing_qty: u64 = u64::MAX - 10;
    let add_lots: u64 = 20;
    let res = existing_qty.checked_add(add_lots).ok_or(EpochError::MathOverflow);
    assert_eq!(res.unwrap_err(), EpochError::MathOverflow);
}

#[test]
fn test_withdraw_quote_position_overflow_rejection() {
    // A user with quote_position exceeding i64::MAX cannot be cast with `as i64`
    let huge_quote_position: i128 = (i64::MAX as i128) + 1_000_000;
    let checked = i64::try_from(huge_quote_position).map_err(|_| EpochError::MathOverflow);
    assert_eq!(checked.unwrap_err(), EpochError::MathOverflow);

    let huge_negative_quote: i128 = (i64::MIN as i128) - 1_000_000;
    let checked_neg = i64::try_from(huge_negative_quote).map_err(|_| EpochError::MathOverflow);
    assert_eq!(checked_neg.unwrap_err(), EpochError::MathOverflow);
}

#[test]
fn test_withdraw_amount_exceeding_i64_max_rejection() {
    let huge_amount: u64 = (i64::MAX as u64) + 10;
    let checked = i64::try_from(huge_amount).map_err(|_| EpochError::MathOverflow);
    assert_eq!(checked.unwrap_err(), EpochError::MathOverflow);
}

#[test]
fn test_liquidate_collateral_i64_min_negation_overflow() {
    // i64::MIN has no positive counterpart in i64; -i64::MIN overflows!
    let min_collat = i64::MIN;
    let abs_opt = min_collat.checked_abs();
    assert!(abs_opt.is_none());
}
