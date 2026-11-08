# Epoch Protocol — Phase 1 Architectural Approval Plan & Execution Roadmap

**Lead Architect & Engineering Manager:** Lead Agent (`feat/epoch-multi-agent`)  
**Base Revision:** `7eda860`  
**Latest Revision:** `eb537f0`  
**Current Milestone:** Phase 1 Execution (Revised Authorization)  
**Date:** November 2026  

---

## 1. Executive Summary & Policy Directives

Following the formal evaluation of the baseline findings from all six specialized engineering worktrees (Security Auditor, QA Engineer, Keeper Engineer, Infrastructure Engineer, Frontend Engineer, and Solana Engineer), this document defines the **final approved Phase 1 implementation scope**.

### Core Policy Directives:
1. **Tiered Execution:**
   - **Tier 1 (Immediate Fixes Authorized):** ADD-1, H-1, H-3, H-2, and ADD-2.
   - **Tier 2 (Security Hygiene & Parameter Hardening Authorized):** ADD-6, ADD-7, and C-2.
   - **Tier 3 (Restricted Architectural Work):** H-4, H-5, and M-1 require formal specifications approved by the Lead Architect before any code changes.
2. **Financial Invariant Preservation:** Any change touching collateral, quotes, funding, or liquidation must verify that Invariants $I-1$ through $I-12$ hold with $0$ micro-USDC drift and $0$ lot drift.
3. **Event Schema Precedence:** Database indexing and schema implementations remain **gated** until event contracts (`FundingAccrued`, `MarketParamsUpdated`, `VaultParamsUpdated`) are implemented on-chain by the Solana Engineer.

---

## 2. Technical Discrepancy Arbitration & Source-Level Evidence

### 2.1 [H-1] Funding Residual Accounting (`settle_users.rs#L211-L225` & `expire_and_release.rs#L179-L191`)
- **Security Auditor Position:** CRITICAL vulnerability. Calling `market.fee_pool.checked_sub(neg)` will panic with `MathOverflow` whenever a user who is owed funding settles in a paged transaction without offsetting payers, permanently bricking the batch and ring slot.
- **QA Engineer Position:** VERIFIED. Residual math accumulates payers' ceil minus receivers' floor into `total_funding_residual: i128` and credits `market.fee_pool`.
- **Architectural Reality:** **Security Auditor Upheld (CRITICAL).**
  - In `settle_users.rs` line 223, `market.fee_pool.checked_sub(neg)` fails with `MathOverflow` whenever a single settlement page ($\le 16$ users) has net funding owed to traders while `fee_pool == 0`.
  - The batch cannot transition to `SETTLED`, leaving the ring slot permanently occupied with `RingSlotBusy` (error 6007).
- **Authorized Remediation:** Eliminate negative fee pool deductions during partial user settlement pages. Isolate funding residual crediting to non-negative amounts, protecting `market.fee_pool`.

### 2.2 [H-2 & H-3] Removal of Administrative Timing Bypasses
- **Source References:** `clear_batch.rs#L108-L111` and `expire_and_release.rs#L64-L68`
- **Security Auditor Position:** HIGH vulnerabilities. Admin bypass clauses (`|| market.admin == ...`) permit early clearing and premature voiding of active batches.
- **QA Engineer Position:** VERIFIED. Boundary slots are enforced on non-admin callers.
- **Architectural Reality:** **Security Auditor Upheld (HIGH).**
  - `clear_batch.rs` line 109 and `expire_and_release.rs` line 66 grant administrative bypasses that violate the deterministic guarantees of a Frequent Batch Auction.
- **Authorized Remediation:**
  - In `clear_batch.rs`, remove `|| market.admin == ctx.accounts.cranker.key()`. Clearing strictly requires `current_slot >= close_slot`.
  - In `expire_and_release.rs`, remove `|| market.admin == ctx.accounts.caller.key()`. Voiding strictly requires `current_slot > close_slot + max_clear_delay_slots`.

### 2.3 [H-4] Vault Liquidation Solvency — RESTRICTED ARCHITECTURAL WORK
- **Decision:** **Do NOT implement code changes yet.** First produce a formal bad-debt accounting specification.
- **Required Specification Components:**
  1. Partial liquidation formula restoring equity to MMR.
  2. Handling of remaining user obligations when vault capacity is constrained.
  3. Vault capacity limits ($\text{max\_inventory\_lots}$ and available equity).
  4. Insurance fund absorption and bad-debt accounting ($I-11$).
  5. Mathematical proof of Invariant $I-1$ collateral conservation under bad debt.

### 2.4 [H-5] Oracle Window Manipulation — RESTRICTED ARCHITECTURAL WORK
- **Decision:** **Do NOT implement code changes yet.** First produce a detailed oracle remediation design.
- **Required Specification Components:**
  1. Authority Mode: continuous sliding window or exponential moving average (EMA) to eliminate boundary stacking at the 75-slot anchor boundary.
  2. Bounded catchup formula for prolonged network outages.
  3. Pyth Mode: deterministic selection requiring the earliest valid update on or after `close_slot`.

### 2.5 [M-1] Safe Permissionless Ring-Buffer Recovery — RESTRICTED ARCHITECTURAL WORK
- **Decision:** **Timeout-based eviction that discards unsettled user obligations is STRICTLY PROHIBITED.**
- **Required Specification Components:**
  1. Design a safe, non-destructive permissionless recovery mechanism.
  2. Cranker fee incentives for settling abandoned user orders.
  3. Safe batch rollover that preserves settled state and unreleased collateral.

### 2.6 [ADD-1] Idempotent Vault Quote Cancellation Accounting (P1 HOTFIX)
- **Target File:** `programs/epoch/src/instructions/vault_quote.rs#L185-L206`
- **Security Auditor Discovery:** CRITICAL Priority 1 Flaw.
- **Architectural Reality:** `vault_quote.rs` cancels quotes without incrementing `batch.settled_orders` or decrementing `vault_user.active_orders`. Because `settle_users` skips cancelled orders, `batch.settled_orders` can never reach `num_orders`, permanently bricking ring slots upon wrap-around.
- **Authorized Remediation:**
  1. Set `batch.orders[i].status = OrderStatus::CANCELLED;`.
  2. Increment `batch.settled_orders = batch.settled_orders.saturating_add(1);` exactly once per cancelled order.
  3. Decrement `vault_user.active_orders = vault_user.active_orders.saturating_sub(1);` exactly once per cancelled order.
  4. Release pending lot reservations and decrement tick aggregate arrays.
  5. Ensure idempotency: execute only on `OrderStatus::OPEN` orders.

### 2.7 [ADD-2] Monotonic Clearance Counter (`clear_batch.rs`)
- **Target File:** `programs/epoch/src/instructions/clear_batch.rs#L180`
- **Requirement:** Update `market.next_batch_to_clear` monotonically:
  ```rust
  market.next_batch_to_clear = market.next_batch_to_clear.max(batch_id + 1);
  ```

---

## 3. Additional Security Findings Authorized for Phase 1

### 3.1 [ADD-6] Credential Sanitization & Rotation
- **Owner:** Keeper Engineer & Infrastructure Engineer
- **Scope:** Expunge committed Helius API key from `docs/KEEPER_RUNBOOK.md` (lines 117 & 177). Replace with `<HELIUS_API_KEY>` environment variable reference. Request key rotation in Helius portal.

### 3.2 [ADD-7] Docker Build-Context Hardening
- **Owner:** Infrastructure Engineer
- **Scope:** Add `.dockerignore` excluding `.git/`, `.env`, keypairs, and `target/`. Remove default keypair fallback from `docker-compose.yml`.

### 3.3 [C-2] Structural Market Parameter Immutability & Safety Bounds
- **Target File:** `programs/epoch/src/instructions/update_market_params.rs`
- **Owner:** Solana Engineer
- **Scope:**
  - Freeze structural parameters as immutable once initialized (`batch_slots`, `base_lot`, `k_ticks`).
  - Enforce upper safety caps: `liq_penalty_bps <= 500` (5%), `funding_cap_bps <= 500` (5%), `fee_bps <= 50` (0.5%).

---

## 4. Test Verification & Exact Count Reconciliation

### Reconciled Test Surface Across All Suites:
| Test Metric | Exact Count | Included Suites & Environment | Command |
| :--- | :---: | :--- | :--- |
| **Functional Tests** | **37** | Bounds (17), safe conversions (4), clearing ladder (4), zero volume (2), order buffer (2), orphan pending (2), token mint (1), funding seconds (5). | Targeted Cargo test run |
| **Oracle Selection Group** | **43** | Functional group (37) + `test_oracle_selection_and_staleness.rs` (6). | Targeted Cargo test run |
| **Default Workspace Total** | **105** | Full workspace default: 23 unit (`epoch`), 14 unit (`epoch-ref`), 68 integration across all 18 test harnesses. | `cargo test --workspace` |
| **Authority Oracle Workspace**| **107** | Workspace with `--features authority-oracle`: 105 - 5 (Pyth specific) + 7 (`test_authority_oracle_mode`) = 107. | `cargo test --workspace --features authority-oracle` |
| **Total Test Function Surface** | **112** | All unique test functions implemented in the Rust codebase (105 default + 7 authority oracle). | Complete source inspection |

### Standardized Execution Commands:
- **Rust Contracts:** `cargo test --workspace`
- **Authority Mode:** `cargo test --workspace --features authority-oracle`
- **Frontend Terminal:** `cd app && bun test`
- **Keeper Daemon:** `cd keeper && bun test`
- **Anchor Integration:** `anchor test` (unblocked via QA fixes in `tests/epoch.ts:133` and `Anchor.toml`).

---

## 5. Event Architecture Coordination (Solana & Infrastructure)

### Standardized Event Naming: `FundingAccrued`
`FundingAccrued` is officially adopted (rejecting `FundingUpdated`).

### Standardized Event Payloads:
```rust
#[event]
pub struct FundingAccrued {
    pub batch_id: u64,
    pub slot: u64,
    pub clearing_price: u64,
    pub oracle_price: u64,
    pub offset_bps: i16,
    pub funding_rate_bps: i16,
    pub funding_index: i128,
    pub accrual_amount: i128,
}

#[event]
pub struct MarketParamsUpdated {
    pub admin: Pubkey,
    pub slot: u64,
    pub old_params: MarketParams,
    pub new_params: MarketParams,
}

#[event]
pub struct VaultParamsUpdated {
    pub admin: Pubkey,
    pub slot: u64,
    pub old_params: VaultParams,
    pub new_params: VaultParams,
}
```

> [!IMPORTANT]
> **Database Gating:** PostgreSQL indexer implementation and REST/WS API servers remain **explicitly gated** until the Solana Engineer compiles and emits these standardized events.

---

## 6. Multi-Agent Git Workflow Protocol

Each engineering agent must:
1. Work only within its assigned worktree and branch (`agent/*`).
2. Run `git status` prior to modifying files.
3. Keep changes tightly scoped to authorized items.
4. Run standardized tests before staging.
5. Review `git diff --cached` before committing.
6. Commit using conventional commit format.
7. **Never run `git push` or `git push --force`.** Remote pushes are handled exclusively by the Lead Architect / User.
