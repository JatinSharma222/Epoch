# Epoch Architecture Decisions & Gate Records

## Initial Gate Records

### Gate G0: Toolchain & Environment (2026-10-01)
- **Status:** PASSED [MEASURED]
- **Toolchain:** Rust 1.93.1 (system) / SBF rustc 1.84.1-dev, Solana CLI 3.0.15 (Agave), Anchor 0.32.0, Bun 1.3.11.
- **Crate Resolution Fixes:** Pinned `proc-macro-crate` to 3.2.0, `zeroize` to 1.8.1, `indexmap` to 2.7.0, and `unicode-segmentation` to 1.12.0 in `Cargo.lock` to avoid `edition2024` incompatibilities with SBF Cargo 1.84.0.
- **Zero-Copy Account:** Program compiles a 9,936-byte zero-copy `Batch` account (fits within Anchor's 10,240-byte initialization ceiling with 304 bytes margin).
- **Test:** `anchor test` passed on local validator (101ms).
- **Oracle Verification:** Pyth devnet SOL/USD price feed (`7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`) verified on-chain.

### Gate G1: Compute Unit Spike & Clearing Viability (2026-10-01)
- **Status:** PASSED [MEASURED]
- **Evidence File:** `evidence/cu.json`
- **Measured Results on Local Validator Runtime:**
  - `place_order` (empty batch): **10,198 CU** (Target: $\le 60,000$ CU, Margin: 83.0%) `[MEASURED]`
  - `place_order` (near-full batch, 128th order): **11,399 CU** (Target: $\le 60,000$ CU, Margin: 81.0%) `[MEASURED]`
  - `clear_batch` ($N=10$ orders, $K=101$ ticks): **16,174 CU** (Target: $\le 600,000$ CU) `[MEASURED]`
  - `clear_batch` ($N=32$ orders, $K=101$ ticks): **21,692 CU** (Target: $\le 600,000$ CU) `[MEASURED]`
  - `clear_batch` ($N=64$ orders, $K=101$ ticks): **22,520 CU** (Target: $\le 600,000$ CU) `[MEASURED]`
  - `clear_batch` ($N=128$ orders, $K=101$ ticks, full capacity): **31,092 CU** (Target: $\le 600,000$ CU, Margin: 94.8%) `[MEASURED]`
- **Analysis:**
  - Full auction clearance ($K=101$ cumulative supply/demand scan, plateau detection, midpoint tie-breaking, uniform clearing price rounding, two-pass pro-rata allocation with dust remainder rule, and funding rate accrual) takes only 31,092 CU at max batch capacity ($N=128$).
  - This is ~15.5% of the standard Solana 200,000 CU transaction limit and ~5.2% of the Gate G1 600,000 CU ceiling, leaving abundant headroom for Pyth price update CPI in the same transaction.
- **Decision:** Gate G1 APPROVED. Proceed to Task T-08 (Program clear_batch & VOID Handling).

### Gate G2: Differential Test Parity (2026-10-02)
- **Status:** PASSED [MEASURED]
- **Evidence File:** `evidence/diff.json`
- **Measured Results on Differential Harness:**
  - Total Batches Tested: **10,000 batches** (2,000 adversarial edge cases + 8,000 broad distributions) `[MEASURED]`
  - Total Orders Processed: **647,981 orders** `[MEASURED]`
  - Total Lots Matched: **701,746,163 lots** `[MEASURED]`
  - Crossing Trade Batches: **9,476** | Zero-Trade Batches: **524** `[MEASURED]`
  - Mismatches: **0** across all batches, clearing parameters, and order-level fills `[MEASURED]`
  - Harness Runtime: **0.89s** for 10,000 full auction executions `[MEASURED]`
- **Analysis:**
  - Bit-for-bit parity confirmed between on-chain contract code (`programs/epoch/src/instructions/clear_batch.rs::execute_batch_auction`) and the standalone Rust reference engine (`crates/epoch-ref`).
  - All handwritten edge cases (Worked Example §6, single order, empty book, zero-trade disjoint books, single tick crossing, symmetric plateau midpoint, odd volume rounding, dust remainder allocations) pass identically.
  - Across 10,000 randomized batches, uniform clearing price, volume maximization, and deterministic pro-rata allocations with remainder distribution are fully verified.
- **Decision:** Gate G2 APPROVED. Proceed to Task T-10 (`settle_users` & Paged Ring Lifecycle).

## Architecture Decision Records (Summary from Design Review)

| ID | Title | Status | Rationale |
|---|---|---|---|
| ADR-01 | Solana-only runtime, devnet target | DECIDED | Colosseum Solana Track scope and $0 devnet cost. |
| ADR-02 | Batch window defined by slot height | DECIDED | Program has no sub-slot clock; `Clock::get()?.slot` is strictly deterministic. |
| ADR-03 | On-chain clearing from tick aggregates | DECIDED | Solver-verification cannot verify omitted orders; on-chain clearing is trustless. |
| ADR-04 | Oracle-relative price grid in basis points | DECIDED | Quotes stay valid as oracle moves, mitigating multi-slot landing delay. |
| ADR-05 | Good-for-one-batch orders | DECIDED | Automatic expiry eliminates stale resting quotes and cancels. |
| ADR-06 | Price priority + pro-rata + deterministic dust | DECIDED | Uniform clearing with transparent FIFO dust rule. |
| ADR-07 | Quote-ledger position accounting | DECIDED | Guarantees exact conservation invariant $I_1$ without rounding loss. |
| ADR-08 | Mock USDC on devnet with faucet | DECIDED | Frictionless demo without reliance on external devnet faucets. |
| ADR-09 | No Hyperliquid runtime dependency | DECIDED | Eliminates cross-chain bridging failure points. |
| ADR-10 | Oracle mark price for margin and liquidations | DECIDED | Immune to intra-batch clearing price skew. |
| ADR-11 | Ring of 8 batch accounts, lookahead L=3 | DECIDED | Predictable rent, constant PDA addressing. |
| ADR-12 | Grid of K=101 ticks, 1 bp step, ±50 bps band | DECIDED | Sufficient depth for SOL perps while fitting compute budget. |
| ADR-13 | Keeper in TypeScript, reference engine in Rust | DECIDED | Fast Pyth pull SDK integration; independent Rust reference model. |
| ADR-14 | Postgres + Indexer + Read-only API | DECIDED | Non-authoritative history store; trading functions without it. |
| ADR-15 | Docker `epoch` prefix everywhere | DECIDED | Prevents resource collisions on local and test environments. |
| ADR-16 | Native toolchain with Docker services | DECIDED | High performance on Apple Silicon; Docker for off-chain services. |
| ADR-17 | Funding residual routing to fee_pool and flat PnL folding | DECIDED | Spec §8 requires payers round up and receivers round down, routing the non-negative residual to `market.fee_pool`. Realized PnL is folded into collateral only when position is flat (`base_position == 0`), guaranteeing Invariant I-1 conservation at all times. |
