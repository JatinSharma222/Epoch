# Epoch Protocol — Multi-Agent Engineering Status & Coordination Board

**Lead Architect & Engineering Manager:** Lead Agent (`feat/epoch-multi-agent`)  
**Base Revision:** `7eda860`  
**Current Revision:** `eb537f0`  
**Timestamp:** 2026-11-08  
**Coordination Protocol:** Git Worktree Multi-Agent Model  

---

## 1. Multi-Agent Team Roster & Worktree Mapping

| Role | Worktree Path | Active Branch | Base Commit | Current Status |
| :--- | :--- | :--- | :--- | :--- |
| **Lead Architect & Engineering Manager** | `.` (Root) | `feat/epoch-multi-agent` | `eb537f0` | **Active** (Revised Authorization Issued; Multi-Agent Coordination) |
| **Security Auditor** | `../Epoch-security` | `agent/security-audit` | `7eda860` | **Active** (Arbitrated Findings; Reviewing Phase 1 Specs) |
| **QA Engineer** | `../Epoch-qa` | `agent/qa-engineer` | `7eda860` | **In Progress** (Unblocking Anchor Test Suite; Regression Suites) |
| **Solana Engineer** | `../Epoch-solana` | `agent/solana-engineer` | `7eda860` | **Authorized for Tier 1** (ADD-1, H-1, H-3, H-2, ADD-2, C-2, Events) |
| **Keeper Engineer** | `../Epoch-keeper` | `agent/keeper-engineer` | `7eda860` | **Authorized for Tier 2** (ADD-6 Credential Expungement, RPC Optimization) |
| **Frontend Engineer** | `../Epoch-frontend` | `agent/frontend-engineer` | `7eda860` | **Authorized for Tier 2** (BottomLedger PnL Bug, Header Countdown) |
| **Infrastructure Engineer** | `../Epoch-infra` | `agent/infrastructure-engineer` | `7eda860` | **Authorized for Tier 2** (ADD-7 Docker Hardening; Indexer Gated) |

---

## 2. Standardized Testing & Execution Matrix

All agents and test scripts must strictly conform to these standardized test commands:

| Layer / Component | Standardized Command | Runner / Environment | Baseline Pass Rate |
| :--- | :--- | :--- | :--- |
| **Rust Smart Contracts** | `cargo test --workspace` | Native Rust Cargo 1.89+ | **105 / 105 (100%)** |
| **Authority Oracle Feature**| `cargo test --workspace --features authority-oracle` | Native Rust Cargo | **107 / 107 (100%)** |
| **Frontend Web Terminal** | `cd app && bun test` | Bun Test Runner (Native) | **2 / 2 (100%)** |
| **Keeper Cranker Daemon** | `cd keeper && bun test` | Bun Test Runner (Native) | **4 / 4 (100%)** |
| **Anchor Integration Suite**| `anchor test` | Localnet Validator + ts-mocha | **30 tests (Unblocking Authorized)**|

> [!IMPORTANT]
> **Toolchain Enforcement:** Vitest is **not** installed in `app/package.json` or `keeper/package.json`. Do **not** run `npx vitest run`. All TypeScript unit and parity tests are natively authored for Bun and executed via `bun test`.

---

## 3. Reconciled Test Surface Across Suites

| Test Metric | Exact Count | Included Test Suites & Scope | Command |
| :--- | :---: | :--- | :--- |
| **Functional Tests** | **37** | Bounds (17), safe conversions (4), clearing ladder (4), zero volume (2), order buffer (2), orphan pending (2), token mint (1), funding seconds (5). | Targeted Cargo test run |
| **Oracle Selection Group** | **43** | Functional group (37) + `test_oracle_selection_and_staleness.rs` (6). | Targeted Cargo test run |
| **Default Workspace Total** | **105** | Full workspace default: 23 unit (`epoch`), 14 unit (`epoch-ref`), 68 integration across all 18 test harnesses. | `cargo test --workspace` |
| **Authority Oracle Workspace**| **107** | Workspace with `--features authority-oracle`: 105 - 5 (Pyth specific) + 7 (`test_authority_oracle_mode`) = 107. | `cargo test --workspace --features authority-oracle` |
| **Total Test Function Surface** | **112** | All unique test functions implemented in the Rust codebase (105 default + 7 authority oracle). | Complete source inspection |

---

## 4. Phase 1 Implementation Scopes & Authorization Status

### 4.1 Tier 1: Authorized Immediate Core Fixes (Solana Worktree)
- [ ] **ADD-1 (P1 Hotfix):** Implement idempotent counter updates (`settled_orders += 1`, `active_orders -= 1`) in `vault_quote.rs`. Release pending reservations on cancelled quotes.
- [ ] **H-1:** Eliminate negative fee pool deduction during partial settlement pages in `settle_users.rs` and `expire_and_release.rs`.
- [ ] **H-3:** Remove administrative expiration bypass (`|| market.admin == ...`) from `expire_and_release.rs`.
- [ ] **H-2:** Remove administrative early clearing bypass (`|| market.admin == ...`) from `clear_batch.rs` as defense in depth.
- [ ] **ADD-2:** Enforce monotonic update `market.next_batch_to_clear = market.next_batch_to_clear.max(batch_id + 1)`.

### 4.2 Tier 2: Authorized Security Hygiene & Parameter Hardening
- [ ] **ADD-6:** Expunge hardcoded Helius API key from `docs/KEEPER_RUNBOOK.md` (lines 117 & 177). Replace with `<HELIUS_API_KEY>`.
- [ ] **ADD-7:** Add `.dockerignore` excluding `.git/`, `.env`, keypairs, and `target/`. Remove deploy key fallback in `docker-compose.yml`.
- [ ] **C-2:** Enforce parameter immutability on `batch_slots`, `base_lot`, `k_ticks` in `update_market_params.rs`. Cap `liq_penalty_bps <= 500`, `funding_cap_bps <= 500`, `fee_bps <= 50`.
- [ ] **Frontend Fixes:** Wrap `position.sizeLots` with `Math.abs()` in `BottomLedger.tsx:275`. Correct countdown labeling in `Header.tsx:158`.
- [ ] **Anchor Test Unblocking:** Fix `tests/epoch.ts:133` (`anchor.web3.Keypair`) and `Anchor.toml` (`bind_address = "127.0.0.1"`).

### 4.3 Tier 3: Restricted Architectural Specifications (Code Implementation GATED)
- [ ] **H-4 Bad-Debt & Liquidation Solvency Spec:** Author formal mathematical specification covering partial liquidation, remaining obligations, vault capacity, insurance absorption, and Invariant $I-1$ conservation.
- [ ] **H-5 Oracle Hardening Design:** Author design covering continuous sliding window (EMA) smoothing for Authority Mode, outage recovery formula, and Pyth deterministic price selection.
- [ ] **M-1 Safe Recovery Mechanism Design:** Author non-destructive permissionless recovery mechanism (no-discard rule).

### 4.4 Event Contracts & Gated Indexer
- [ ] **Solana Engineer:** Compile and emit standardized events: `FundingAccrued`, `MarketParamsUpdated`, `VaultParamsUpdated`.
- [ ] **Infrastructure Engineer:** PostgreSQL indexer database and REST/WS API servers remain **GATED** until event contracts are live.

---

## 5. Multi-Agent Git Workflow Protocol

Each engineering agent must:
1. Work only within its assigned worktree and branch (`agent/*`).
2. Run `git status` prior to modifying files.
3. Keep changes tightly scoped to authorized items.
4. Run standardized tests before staging.
5. Review `git diff --cached` before committing.
6. Commit using conventional commit format.
7. **Never run `git push` or `git push --force`.** Remote pushes are handled exclusively by the Lead Architect / User.
