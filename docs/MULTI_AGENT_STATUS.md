# Epoch Protocol — Multi-Agent Engineering Status & Coordination Board

**Lead Architect & Engineering Manager:** Lead Agent (`feat/epoch-multi-agent`)  
**Base Revision:** `7eda860`  
**Current Revision:** `7d78d93` (Main Coordinator)  
**Timestamp:** 2026-11-09  
**Coordination Protocol:** Git Worktree Multi-Agent Architecture  

---

## 1. Multi-Agent Team Roster, Worktree Mapping & Commit Tracking

| Role | Worktree Path | Active Branch | Latest 40-Char Commit Hash | Commit Summary | Current Workstream Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Lead Architect & Engineering Manager** | `.` (Root) | `feat/epoch-multi-agent` | `7d78d93630998df6dc1c9aae2af769488c2b3c0f` | `docs: update multi-agent coordination board with Phase 2 adversarial proofs, 40-char hashes, and security sign-off` | **Active** (Phase 2 On-Chain Implementation & Production Verification Review Complete) |
| **Solana Engineer** | `../Epoch-solana` | `agent/solana-engineer` | `ef63371ac02737ee599ef0c42d41c31495edc975` | `feat(solana): implement production two-tier partial liquidation, deposit curing, and bounded prolonged-outage oracle rate governor` | **Verified & Isolated** (**135 / 135 Passed**; Production On-Chain Instructions Implemented; Gated from Main) |
| **QA Engineer** | `../Epoch-qa` | `agent/qa-engineer` | `0878357b52651fc115ae2a2eaef339e805ca1c4f` | `chore(qa): update measured compute unit benchmarks in cu.json` | **Active** (Harness Parity Formulated; 117/117 Regression Tests Passing) |
| **Security Auditor** | `../Epoch-security` | `agent/security-audit` | `4c71d14965cb2f304a7a40531cfc442ea23246e5` | `docs(audit): sign independent security verdict for Phase 2 on-chain implementations (commit ef63371)` | **Completed** (Full Independent Written Review & Sign-Off Signed for Commit `ef63371`) |
| **Keeper Engineer** | `../Epoch-keeper` | `agent/keeper-engineer` | `8cb6016d7d0c8c5284e39505509cc033efbf9282` | `docs(keeper): commit Phase 2 keeper compatibility audit for H-4, H-5, and RPC failover` | **Completed** (Phase 2 Compatibility & RPC Failover Audit Complete; 4/4 Tests Passing) |
| **Infrastructure Engineer** | `../Epoch-infra` | `agent/infrastructure-engineer` | `633efb0edbf274f64584561341b16b42119e3991` | `feat(infra): implement idempotent event processor, migration history, and replay tests` | **Completed** (Idempotent Processor, DB Schema & Replay Tests Passing 5/5) |
| **Frontend Engineer** | `../Epoch-frontend` | `agent/frontend-engineer` | `7317c755c56bca22f6fbccab80fd03838d8b965e` | `fix(frontend): align gate_g1_budget_targets with cu.json and resolve MarketStats venueCount` | **Completed** (PnL Parity, Headroom & Gate G1 Alignments Passing 2/2) |

---

## 2. Standardized Testing & Execution Matrix

All agents strictly execute standardized test commands. Below are the verified test results and exact execution outputs:

| Layer / Component | Standardized Command | Runner / Environment | Executed Test Count | Status | Notes |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **Solana On-Chain Test Suite** | `cargo test --workspace` (in `../Epoch-solana`) | Native Rust Cargo 1.89+ | **135 / 135 passed** | **PASSED** | 23 unit (`epoch`), 14 unit (`epoch-ref`), 98 integration tests across 22 test harnesses |
| **H-4 Production Liquidation Suite** | `cargo test --test test_h4_production_liquidation` | Native Rust Cargo | **3 / 3 passed** | **PASSED** | Token-flow ledger, deposit curing, capacity saturation |
| **H-5 Production Oracle Governor** | `cargo test --test test_h5_production_oracle_governor` | Native Rust Cargo | **5 / 5 passed** | **PASSED** | Bounded outage recovery, dual rollover, oscillation defense, 60-bps window |
| **H-4 / H-5 Adversarial Property Suites** | `cargo test --test test_h4_liquidation_adversarial --test test_h5_ema_adversarial` | Native Rust Cargo | **10 / 10 passed** | **PASSED** | First-principles $P_{\text{bk}}$, ADL ranking, 60-bps mathematical counterexample proof |
| **QA Extended Regression Suite** | `cargo test --workspace` (in `../Epoch-qa`) | Native Rust Cargo | **117 / 117 passed** | **PASSED** | 105 base + 7 security reproduction tests + 5 remediation proof tests |
| **Localnet Authority Oracle E2E** | `EPOCH_RPC_URL=http://127.0.0.1:8899 bun run scripts/test_local_e2e.ts` | Local Validator + Reference Engine | **11 / 11 passed** | **PASSED** | Real on-chain trades, vault sweeps, reference engine parity, outage tests |
| **PostgreSQL Event Indexer** | `cd indexer && bun test` (in `../Epoch-infra`) | Bun Test Runner (Native) | **5 / 5 passed** | **PASSED** | Idempotency, sequence ordering, crash recovery, and parameter replay tests |
| **Keeper Cranker Daemon** | `cd keeper && bun test` (in `../Epoch-keeper`) | Bun Test Runner (Native) | **4 / 4 passed** | **PASSED** | Orderbook indexing, RPC failover, same-slot compliance, and partial liquidation |
| **Frontend Web Terminal** | `cd app && bun test` (in `../Epoch-frontend`) | Bun Test Runner (Native) | **2 / 2 passed** | **PASSED** | `BottomLedger` PnL formatting and calculation parity tests |

---

## 3. Discrepancy & Issue Resolutions (Prompt 11 Directives)

### 3.1 H-4: Complete Transaction-Level Token-Flow Ledger
- **Token-Flow Distinction:** Explicit balance sheet tracking strictly separates:
  - Collateral transfers: User collateral adjusted by realized PnL folds and penalty deductions.
  - Counterparty PnL: Winning traders credited full profit at execution price.
  - Insurance transfers: 50% of solvent penalty credited to `insurance_fund`; deficit absorbed up to available reserves.
  - Bad-debt liabilities: Recorded strictly and exclusively when $\text{deficit} > \text{insurance\_fund}$.
  - Fee-pool transfers: 50% of solvent penalty credited to `fee_pool` for liquidator / cranker bounties.
- **Verification:** Verified to 0 micro-USDC error across all 7 entities in `test_h4_production_liquidation.rs`.

### 3.2 H-4: Bad Debt Recorded ONLY for Actual Uncovered Obligations
- **Rule:** Under no circumstances is contractual position notional ($q \times P$) converted into bad debt.
- **Proof:** Bad debt accumulates strictly as $\max(0, -E_{\text{user}} - \text{InsuranceFund})$. Verified in `test_h4_full_bankruptcy_liquidation_and_bad_debt_recording`.

### 3.3 H-4: Partial Liquidation Execution & Collateral Deposit Curing
- **Two-Tier Architecture:**
  - Solvent undercollateralized accounts ($0 \le E < \text{MMR}$) undergo partial liquidation ($\alpha = 50\%$, minimum 100 lots).
  - Unabsorbed lots leave the account in `UserFlags::LIQUIDATING` quarantine.
  - Quarantined accounts cannot withdraw collateral (`withdraw.rs`) and cannot place risk-increasing orders (`place_order.rs`).
  - Subsequent collateral deposit (`deposit.rs`) automatically evaluates post-deposit equity against MMR; if $E \ge \text{MMR}$, the quarantine flag is cleared.
- **Verification:** Verified on production instructions in `test_h4_partial_liquidation_and_deposit_curing_flow`.

### 3.4 H-5: Bounded Prolonged-Outage Recovery (No Unrestricted Jump)
- **Redesign:** An outage is detected when $\Delta s \ge 150$ slots or $\Delta t \ge 60$ seconds.
- **Ceiling:** The first update post-outage CANNOT execute an unrestricted jump. It is strictly clamped to at most $100\text{ bps}$ ($1.00\%$) from the pre-outage anchor price $P_{\text{anchor}}$.
- **Verification:** A $+50\%$ jump attempt after a 500-slot outage is clamped to $+100\text{ bps}$ ($151.50$); 5 repeated 200-slot outages each clamp to $\le 100\text{ bps}$. Verified in `test_h5_large_post_outage_jump_is_bounded` and `test_h5_repeated_outage_resets_cannot_bypass_rate_governor`.

### 3.5 H-5: Dual Window Rollover (150 Slots / 60 Seconds)
- **Clarification:** Solana slots are variable (400ms nominal, but 600ms–1,000ms during congestion).
- **Enforcement:** The governor rolls the velocity window when **$\Delta s \ge 150\text{ slots}$ OR $\Delta t \ge 60\text{ seconds}$**.
- **Verification:** Verified with 1,000ms congested slots and 250ms fast slots in `test_h5_variable_solana_slot_duration_handling`.

### 3.6 H-5: Rolling-Window Accumulator & Oscillation Defense
- **Clamped Prices:** Clamped prices feed into the oracle state and velocity accumulator without throwing instruction errors.
- **Opposite-Direction Movements:** Net displacement from anchor ($|P_t - P_{\text{anchor}}| \le 30\text{ bps}$) and directional drift from window start ($|P_t - P_{\text{window\_start}}| \le 60\text{ bps}$) prevent alternating oscillations ($+15, -15\text{ bps}$) from exhausting the budget or pinning the oracle.
- **Verification:** 20 alternating updates run cleanly without oracle freeze in `test_h5_alternating_price_movements_do_not_pin_oracle`.

---

## 4. Worktree Commit Summary & Gate Checklist

| Worktree | Branch | Full 40-Char Commit Hash | Status |
| :--- | :--- | :--- | :--- |
| **Coordinator (`.`)** | `feat/epoch-multi-agent` | `7d78d93630998df6dc1c9aae2af769488c2b3c0f` | Clean, Ahead of origin by 3 commits (no push) |
| **Solana (`../Epoch-solana`)** | `agent/solana-engineer` | `ef63371ac02737ee599ef0c42d41c31495edc975` | Clean, 135/135 tests passing, isolated |
| **QA (`../Epoch-qa`)** | `agent/qa-engineer` | `0878357b52651fc115ae2a2eaef339e805ca1c4f` | Clean, 117/117 regression tests passing |
| **Security (`../Epoch-security`)** | `agent/security-audit` | `4c71d14965cb2f304a7a40531cfc442ea23246e5` | Clean, Signed review for commit `ef63371` |
| **Keeper (`../Epoch-keeper`)** | `agent/keeper-engineer` | `8cb6016d7d0c8c5284e39505509cc033efbf9282` | Clean, Phase 2 keeper audit signed, 4/4 passing |
| **Infra (`../Epoch-infra`)** | `agent/infrastructure-engineer` | `633efb0edbf274f64584561341b16b42119e3991` | Clean, Idempotent processor passing 5/5 |
| **Frontend (`../Epoch-frontend`)** | `agent/frontend-engineer` | `7317c755c56bca22f6fbccab80fd03838d8b965e` | Clean, Gate G1 budget & UI parity passing 2/2 |

---

## 5. Protocols & Boundaries Maintained

1. **Strict Worktree Isolation:** `agent/solana-engineer` changes remain isolated in `../Epoch-solana`. No merges were made into `feat/epoch-multi-agent`.
2. **Zero Remote Pushes:** No `git push` was executed.
3. **Zero Weakening of Production Oracle Checks:** All production Pyth checks (`owner`, `discriminator`, `VerificationLevel::Full`, `feed_id`, slot window delay) remain 100% active.
4. **M-1 Status:** M-1 remains gated from production implementation.
