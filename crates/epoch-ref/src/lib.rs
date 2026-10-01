//! Epoch Reference Engine
//!
//! Independent reference implementation of the Epoch Frequent Batch Auction
//! mechanism for perpetual futures on Solana, as specified in `02-MECHANISM_SPEC.md`.

#![deny(missing_docs)]

/// Placeholder version function for T-00 scaffold
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version() {
        assert_eq!(version(), "0.1.0");
    }
}
