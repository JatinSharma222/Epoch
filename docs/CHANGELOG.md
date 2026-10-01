# Epoch Changelog

All notable changes to the Epoch codebase are documented here.

## [Unreleased] - Phase 2 Initial Scaffolding (2026-10-01)

### Added
- **Design Review Report:** Completed Phase 1 review and published `research/review/REPORT.md`. No Blocker or High findings identified.
- **Repository Setup:** Initialized git repository with strict `.gitignore` protecting `/context/`, `/research/`, `.env*`, keypairs, and build artifacts. Added remote `origin git@github-222:JatinSharma222/Epoch.git`.
- **Task T-00 (Environment & Toolchain Pinning):**
  - Configured workspace with pinned versions: Solana CLI 3.0.15 (Agave), Anchor 0.32.0, Bun 1.3.11, Rust 1.93.1.
  - Resolved SBF build failures caused by unstable `edition2024` requirements by pinning `proc-macro-crate` (3.2.0), `zeroize` (1.8.1), `indexmap` (2.7.0), and `unicode-segmentation` (1.12.0) in `Cargo.lock`.
  - Implemented 9,936-byte zero-copy `Batch` account in `programs/epoch` meeting Anchor's 10,240-byte initialization ceiling with 304 bytes margin.
  - Verified Pyth devnet SOL/USD price feed on-chain (`7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`) via `scripts/verify_pyth.ts`.
- **Task T-01 (Single-Command Check):**
  - Created `Makefile` with `make check` running `cargo fmt --check`, `clippy -D warnings`, `cargo test`, and `anchor test`.
  - Verified all tests pass green on local validator.
- **Architecture & Scaffolding:**
  - Created empty reference engine crate `crates/epoch-ref`.
  - Created minimal runnable TypeScript/Bun services for `keeper/`, `indexer/`, and `api/`.
  - Created Next.js frontend scaffold in `app/`.
  - Added Docker infrastructure with `docker-compose.yml`, `docker/bun.Dockerfile`, and `.env.example` adhering strictly to `epoch` resource prefix conventions.
  - Added PostgreSQL schema migrations in `db/migrations/001_init.sql` (verified idempotent execution).
  - Created core documentation: `ENVIRONMENT.md`, `DECISIONS.md`, `FUTURE.md`, and public `README.md`.
