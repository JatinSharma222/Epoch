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
- **Task T-02 (Zero-Copy Account Layouts):**
  - Designed and verified memory layouts for `Market` (384B, 16B aligned), `UserAccount` (176B, 16B aligned), `Batch` (9,928B, 8B aligned), and `Order` (64B).
  - Explicit padding fields guarantee deterministic byte alignment under `#[repr(C)]`.
- **Task T-03 (Reference Engine in epoch-ref):**
  - Implemented reference clearing engine: cumulative supply/demand vectors, plateau interval, tie-breaking toward center tick, pro-rata allocation, and deterministic remainder dust rule.
- **Task T-04 (Clearing Property Tests):**
  - Extracted shared `midpoint_c` tie-breaking helper and `allocate_order_fills`.
  - Implemented 1,000,000 random-case property test in `crates/epoch-ref` verifying Invariants P-2 to P-7 and P-9.
- **Task T-05 (Market, Faucet, User Creation, Deposit, Withdraw):**
  - Implemented on-chain account lifecycle instructions in `programs/epoch`.
  - Added Flat Position Rule for safe withdrawals and verified Invariant I-1 conservation across user collateral.
- **Task T-06 (Order Intake & Ring Buffer Maintenance):**
  - Implemented `place_order` (in-place upsert, worst-case margin check, tick aggregate maintenance) and `cancel_order`.
  - Added 8-slot batch ring buffer with `[b"batch", &[ring_index]]` PDA addressing and verified Invariant I-8 aggregate consistency over 10,000 random operations.
- **Task T-07 (Compute Unit Spike & Gate G1 Clearance):**
  - Implemented `clear_batch` instruction performing full on-chain auction execution and fill allocation.
  - Added `update_market_params` admin instruction.
  - Measured CU consumption across 10, 32, 64, and 128 orders: `place_order` consumes 10,198 - 11,399 CU (Target $\le 60k$ CU); `clear_batch` consumes 16,174 - 31,092 CU (Target $\le 600k$ CU).
  - Passed Gate G1 with empirical measurements recorded in `evidence/cu.json`.
- **Task T-08 (Program clear_batch Worked Example & VOID Handling):**
  - Enhanced `clear_batch` with `ClearBatchParams` covering oracle price, confidence, timestamp, and posted slot.
  - Implemented automatic VOID state transition for stale oracle (age > `max_oracle_age_secs`), wide confidence (conf / price > `max_conf_bps`), and delayed clearance (`current_slot > close_slot + max_clear_delay_slots`).
  - Added VOID ring slot re-open lifecycle rule in `place_order`.
  - Re-produced the reference worked example on-chain ($i^* = 51$, $Q^* = 30$, price $150.015) with bit-for-bit fill allocation matching `epoch-ref`.
  - Verified 3 VOID edge-case integration tests on local validator.


