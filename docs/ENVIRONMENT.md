# Epoch Environment & Pinned Toolchain

Status: PINNED & MEASURED (Task T-00, 2026-10-01).

## 1. System & Runtime Versions

| Tool | Version | Verification Command | Notes |
|---|---|---|---|
| **OS** | macOS (Darwin 24.3.0, arm64) | `uname -smpr` | Apple Silicon (M-series) |
| **Rust (Host)** | `rustc 1.93.1 (01f6ddf75 2026-02-11)` | `rustc --version` | Host compiler |
| **Cargo (Host)** | `cargo 1.93.1 (083ac5135 2025-12-15)` | `cargo --version` | Host package manager |
| **Solana / Agave CLI** | `solana-cli 3.0.15 (feat:3604001754, client:Agave)` | `solana --version` | Target cluster: devnet |
| **SBF Rustc** | `rustc 1.84.1-dev` | via `cargo build-sbf` | Bundled with Solana toolchain |
| **Anchor CLI** | `anchor-cli 0.32.0` | `anchor --version` | Anchor framework |
| **Bun** | `1.3.11` | `bun --version` | TS runtime & package manager |
| **Node.js** | `v22.16.0` | `node --version` | Compatibility runtime |
| **Docker** | Docker version 28.0.4 | `docker --version` | Container runtime |
| **Postgres** | `16.4-alpine` | `docker-compose.yml` | History database |

## 2. Pinned Crate Versions & Incompatibility Fixes (Cargo.lock)

Due to SBF Cargo running an older internal toolchain (1.84.0), several newly published crates trigger compile errors requiring unstable feature `edition2024` or newer `rustc 1.85.0`. The following crates are pinned in `Cargo.lock`:

| Crate | Pinned Version | Problematic Latest Version | Reason / Error Resolved |
|---|---|---|---|
| `proc-macro-crate` | `3.2.0` | `3.5.0` | 3.5.0 pulls `toml_edit v0.25` and `toml_datetime v1.1.1` requiring `edition2024` |
| `zeroize` | `1.8.1` | `1.9.0` | 1.9.0 requires `edition2024` |
| `indexmap` | `2.7.0` | `2.14.2` | 2.14.2 requires `edition2024` |
| `unicode-segmentation` | `1.12.0` | `1.13.3` | 1.13.3 requires `rustc 1.85.0` (SBF compiler is 1.84.1-dev) |
| `bytemuck` | `1.25.2` | `1.25.2` | Configured with `["derive", "min_const_generics"]` for arbitrary array bounds |
| `anchor-lang` | `0.32.2` | `0.32.2` | Core on-chain framework |

## 3. Measured Anchor Zero-Copy Account Layout (Task T-00)

- **Account:** `Batch` (`programs/epoch/src/lib.rs`)
- **Order Struct Size:** 64 bytes (`[MEASURED]`, compile-time asserted)
- **Batch Account Data Size:** 9,928 bytes (`[MEASURED]`)
- **Total Account Size (with 8-byte discriminator):** **9,936 bytes** (`[MEASURED]`)
- **Anchor Init Ceiling:** 10,240 bytes
- **Safety Margin:** **304 bytes remaining** (`[MEASURED]`)
- **Integration Test:** `anchor test` passed on local validator (initializes 9,936-byte zero-copy account in 101ms, tx signature `5LNZSk2Swg4ZA6ahMeRnFBUyAF6soqQKAdeKG5r8CJ3zfe73ZU1tSUZSHa1STbkLJmedvZv4PBu4od5p7bDLL2jx`).

## 4. Pyth Devnet SOL/USD Oracle Feed Verification (Task T-00)

Measured on-chain via `scripts/verify_pyth.ts` against Solana devnet:

- **Feed ID:** `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`
- **Price Feed Account (Shard 0):** `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`
- **Receiver Program ID:** `rec5EKMGg6vugBhfhNxWmsAcqqnTDe2akhWBwbxCDWu`
- **Account Type:** Pyth `PriceUpdateV2` (length: 134 bytes)
- **Status:** **VERIFIED [MEASURED]**
- **Observed Price:** `$117.5387 USD`
- **Confidence Interval:** `±$0.0196` (1.67 bps)
- **Exponent:** `-8`
- **Observed Posted Slot:** `506233481` (active real-time updates on devnet)

## 5. Verification Commands

To verify the entire environment from a clean setup:

```bash
# 1. Run all checks (format, clippy, unit tests, localnet anchor test)
make check

# 2. Verify Pyth devnet feed directly on-chain
bun run scripts/verify_pyth.ts

# 3. Test Docker environment and migrations
docker compose -p epoch config
docker compose -p epoch up -d epoch-postgres
docker compose -p epoch down
```
