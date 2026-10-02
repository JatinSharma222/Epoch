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
- **Task T-09 (Differential Test Harness & Gate G2 Clearance):**
  - Extracted core auction clearing logic in `programs/epoch` into pure function `execute_batch_auction`.
  - Added `Default` implementations for `Order` and `Batch` for zero-allocation test harnesses.
  - Implemented comprehensive differential test harness in `programs/epoch/tests/differential.rs` running against `crates/epoch-ref`.
  - Evaluated 8 handwritten edge-case corpus batches and 10,000 randomized batches (2,000 adversarial edge cases + 8,000 broad distributions).
  - Passed Gate G2 with 0 mismatches across 647,981 orders and 701,746,163 matched lots in 0.89s, recorded in `evidence/diff.json`.
- **Task T-10 (Program settle_users and Ring Lifecycle):**
  - Implemented `settle_users` permissionless crank instruction with paged settlement across `remaining_accounts`.
  - Implemented quote-ledger updates: `base_position += f`, `quote_position -= notional` for BUY (or vice versa for SELL), and trading fee deduction `fee = ceil(notional * fee_bps / 10000)` into `market.fee_pool`.
  - Applied funding index changes on existing `base_position` before position adjustments per spec §8.
  - Released pending lots and decremented active order counts on settlement.
  - Added duplicate user account rejection (`DuplicateUserAccount`) to prevent double-settlement attacks.
  - Added `BatchStatus::SETTLED` state transition when `settled_orders == num_orders`, enabling ring slot reuse.
  - Added program events: `UserSettled`, `BatchCleared`, and `BatchVoided`.
  - Verified Invariants I-1 (Conservation), I-4 (Volume balance), and I-12 (Completeness), paged settlement across multiple transactions, VOID batch settlement, and ring reuse across 34 passing integration tests.
- **Task T-11 (Fees, Funding, & Realized PnL Folding):**
  - Updated `settle_users` to track cumulative funding payments and credit the rounding residual (payers' round-ups minus receivers' round-downs) directly into `market.fee_pool` per spec §8.
  - Aligned `user.funding_snapshot = market.funding_index` on `withdraw` and on `deposit` when flat.
  - Added comprehensive integration tests covering:
    - Active funding index accrual from clearing price offsets (`offset* != 0`) and settlement with exact Invariant I-1 conservation.
    - Zero-sum funding property verification across long and short positions, showing that difference equals the rounding residual accounted for in `fee_pool`.
    - Withdraw-after-close lifecycle: rejection of withdrawals while a position is open (`PositionNotFlat`), closing position at a profit in a subsequent batch, realized PnL folding from `quote_position` into `collateral`, and flat withdrawal with 100% Invariant I-1 conservation across all accounts.
  - All 37 integration tests passing. All 22 cargo unit & differential tests passing. Clippy clean with 0 warnings.
- **Task T-12 (Permissionless Keeper v1 & Dual-Keeper Idempotency):**
  - Implemented standalone TypeScript keeper service under `keeper/`:
    - `keeper/src/types.ts`: typed configurations, Pyth oracle price records, structured transaction logs, and batch summaries.
    - `keeper/src/logger.ts`: high-performance JSON log writer supporting stdout formatting and append-only `.jsonl` logging (`logs/tx_log.jsonl`) with strict `[MEASURED]` labels.
    - `keeper/src/oracle.ts`: Pyth Solana Receiver integration supporting resilient devnet and localnet price feeds with lazy dynamic imports.
    - `keeper/src/keeper.ts`: `EpochKeeper` engine with ring PDA discovery, lookahead batch state polling, autonomous `clearBatch` clearing crank with oracle parameter construction, and paged `settleUsers` settlement crank.
    - `keeper/src/index.ts`: production-grade executable CLI supporting continuous multi-market loop (`--interval-ms`, `--page-size`) and single-tick verification (`--once`) with graceful SIGINT/SIGTERM handlers.
  - Implemented strict idempotency safeguards against concurrent keeper races: on-chain batch state verification prevents spurious simulation errors if a racing keeper cleared or settled in the same slot.
  - Added full end-to-end integration tests in `tests/epoch.ts`:
    - Keeper instance initialization and ring buffer inspection.
    - Autonomous closed batch clearing with structured logging and empirical compute unit measurement (`clear_batch` consumed 18,728 CU, well within 600,000 limit).
    - Autonomous paged user settlement (`settle_users` consumed 8,184 - 15,873 CU).
    - Dual-keeper race condition test with concurrent `clearBatch` and `settleUsers` verifying seamless idempotency and batch completion to `SETTLED`.
  - All 41 integration tests passing. All 22 cargo unit and differential tests passing. Clippy and rustfmt clean.



