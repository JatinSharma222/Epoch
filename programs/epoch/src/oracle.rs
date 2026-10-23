use anchor_lang::prelude::*;
use crate::errors::EpochError;

/// Pyth Solana Receiver Program ID on devnet & mainnet.
pub const PYTH_RECEIVER_PROGRAM_ID: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

/// Verification level representing guardian quorum verification.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum VerificationLevel {
    Partial { num_signatures: u8 },
    Full,
}

/// Raw price feed message embedded in PriceUpdateV2.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct PriceFeedMessage {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub prev_publish_time: i64,
    pub ema_price: i64,
    pub ema_conf: u64,
}

/// Pyth Solana Receiver PriceUpdateV2 account layout.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct PriceUpdateV2 {
    pub write_authority: Pubkey,
    pub verification_level: VerificationLevel,
    pub price_message: PriceFeedMessage,
    pub posted_slot: u64,
}

impl PriceUpdateV2 {
    /// Anchor account discriminator for "account:PriceUpdateV2".
    pub const DISCRIMINATOR: [u8; 8] = [0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd];
}

/// Parsed and cryptographically verified price update data scaled to micro-USDC (6 decimals).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParsedPriceUpdate {
    pub price: u64,
    pub conf: u64,
    pub publish_time: i64,
    pub posted_slot: u64,
}

/// Deserializes and validates a Pyth Solana Receiver `PriceUpdateV2` account.
///
/// Enforces:
/// 1. Owner matches `PYTH_RECEIVER_PROGRAM_ID`.
/// 2. Discriminator matches `PriceUpdateV2::DISCRIMINATOR`.
/// 3. Verification level is `VerificationLevel::Full` (guardian quorum achieved).
/// 4. Feed ID matches the market's configured `oracle_feed_id`.
/// 5. Price is positive.
/// 6. Scales price and confidence from Pyth's exponent to 6 decimals (micro-USDC).
pub fn parse_and_validate_pyth_price_update(
    price_update_info: &AccountInfo,
    expected_feed_id: &[u8; 32],
) -> Result<ParsedPriceUpdate> {
    // 1. Owner check
    require_keys_eq!(
        *price_update_info.owner,
        PYTH_RECEIVER_PROGRAM_ID,
        EpochError::Unauthorized
    );

    // 2. Discriminator check
    let data = price_update_info.try_borrow_data()?;
    require!(
        data.len() >= 8,
        EpochError::InvalidOracleAccount
    );
    require!(
        data[0..8] == PriceUpdateV2::DISCRIMINATOR,
        EpochError::InvalidOracleAccount
    );

    // 3. Borsh deserialize
    let mut slice: &[u8] = &data[8..];
    let price_update = PriceUpdateV2::deserialize(&mut slice)
        .map_err(|_| EpochError::InvalidOracleAccount)?;

    // 4. Verification level check (must be Full quorum)
    require!(
        price_update.verification_level == VerificationLevel::Full,
        EpochError::OracleVerificationFailed
    );

    // 5. Feed ID check
    require!(
        price_update.price_message.feed_id == *expected_feed_id,
        EpochError::OracleFeedMismatch
    );

    // 6. Positive price check
    let raw_price = price_update.price_message.price;
    require!(raw_price > 0, EpochError::InvalidOraclePrice);

    // 7. Scale to micro-USDC (6 decimals). Pyth typically uses exponent = -8.
    let exponent = price_update.price_message.exponent;
    let target_exp = exponent + 6;
    let (scaled_price, scaled_conf) = if target_exp >= 0 {
        let mult = 10u128.checked_pow(target_exp as u32).ok_or(EpochError::MathOverflow)?;
        (
            (raw_price as u128).checked_mul(mult).ok_or(EpochError::MathOverflow)?,
            (price_update.price_message.conf as u128).checked_mul(mult).ok_or(EpochError::MathOverflow)?,
        )
    } else {
        let div = 10u128.checked_pow((-target_exp) as u32).ok_or(EpochError::MathOverflow)?;
        (
            (raw_price as u128).checked_div(div).ok_or(EpochError::MathOverflow)?,
            (price_update.price_message.conf as u128).checked_div(div).ok_or(EpochError::MathOverflow)?,
        )
    };

    let price = u64::try_from(scaled_price).map_err(|_| EpochError::MathOverflow)?;
    let conf = u64::try_from(scaled_conf).map_err(|_| EpochError::MathOverflow)?;
    require!(price > 0, EpochError::InvalidOraclePrice);

    Ok(ParsedPriceUpdate {
        price,
        conf,
        publish_time: price_update.price_message.publish_time,
        posted_slot: price_update.posted_slot,
    })
}

/// Deserializes and validates an Authority Oracle `AuthorityPriceUpdate` account.
#[cfg(feature = "authority-oracle")]
pub fn parse_and_validate_authority_price_update(
    price_update_info: &AccountInfo,
    market_key: &Pubkey,
) -> Result<ParsedPriceUpdate> {
    require_keys_eq!(
        *price_update_info.owner,
        crate::ID,
        EpochError::Unauthorized
    );

    let (expected_pda, _bump) = Pubkey::find_program_address(
        &[crate::instructions::post_price::AuthorityPriceUpdate::SEED, market_key.as_ref()],
        &crate::ID,
    );
    require_keys_eq!(
        price_update_info.key(),
        expected_pda,
        EpochError::InvalidOracleAccount
    );

    let data = price_update_info.try_borrow_data()?;
    require!(data.len() >= 8, EpochError::InvalidOracleAccount);
    let mut slice: &[u8] = &data[..];
    let account = crate::instructions::post_price::AuthorityPriceUpdate::try_deserialize(&mut slice)
        .map_err(|_| EpochError::InvalidOracleAccount)?;

    require!(account.price > 0, EpochError::InvalidOraclePrice);
    require!(account.conf > 0, EpochError::OracleConfidenceTooLow);

    Ok(ParsedPriceUpdate {
        price: account.price,
        conf: account.conf,
        publish_time: account.publish_time,
        posted_slot: account.posted_slot,
    })
}

/// Single verified-price account parser.
/// Routes based on compile-time feature flag "authority-oracle".
pub fn parse_and_validate_oracle_price_account(
    price_update_info: &AccountInfo,
    expected_feed_id: &[u8; 32],
    market_key: &Pubkey,
) -> Result<ParsedPriceUpdate> {
    #[cfg(feature = "authority-oracle")]
    {
        let _ = expected_feed_id;
        parse_and_validate_authority_price_update(price_update_info, market_key)
    }
    #[cfg(not(feature = "authority-oracle"))]
    {
        let _ = market_key;
        parse_and_validate_pyth_price_update(price_update_info, expected_feed_id)
    }
}

/// Fully validates freshness and confidence interval for strict instructions (e.g. liquidate).
pub fn verify_price_update_strict(
    price_update_info: &AccountInfo,
    expected_feed_id: &[u8; 32],
    max_oracle_age_secs: u16,
    max_conf_bps: u16,
    current_timestamp: i64,
) -> Result<ParsedPriceUpdate> {
    verify_price_update_strict_with_market(
        price_update_info,
        expected_feed_id,
        price_update_info.key,
        max_oracle_age_secs,
        max_conf_bps,
        current_timestamp,
    )
}

/// Fully validates freshness and confidence with explicit market PDA verification.
pub fn verify_price_update_strict_with_market(
    price_update_info: &AccountInfo,
    expected_feed_id: &[u8; 32],
    market_key: &Pubkey,
    max_oracle_age_secs: u16,
    max_conf_bps: u16,
    current_timestamp: i64,
) -> Result<ParsedPriceUpdate> {
    let parsed = parse_and_validate_oracle_price_account(price_update_info, expected_feed_id, market_key)?;

    // Staleness check
    let age = current_timestamp.saturating_sub(parsed.publish_time);
    require!(
        parsed.publish_time <= current_timestamp && age <= max_oracle_age_secs as i64,
        EpochError::OracleStale
    );

    // Confidence check
    let conf_bps = (parsed.conf as u128 * 10_000) / parsed.price as u128;
    require!(
        conf_bps <= max_conf_bps as u128,
        EpochError::OracleConfidenceTooWide
    );

    Ok(parsed)
}
