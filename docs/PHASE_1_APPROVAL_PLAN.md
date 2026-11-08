# Epoch Protocol — Phase 1 Architectural Approval Plan & Discrepancy Resolution

**Lead Architect & Engineering Manager:** Lead Agent (`feat/epoch-multi-agent`)  
**Base Commit:** `7eda860`  
**Current Commit:** `a25a915`  
**Target Milestone:** Phase 1 Core Security Hardening & Protocol Reliability  
**Date:** November 2026  

---

## 1. Executive Summary & Approval Framework

Following the receipt and adversarial review of baseline reports from all six specialized engineering worktrees (Security Auditor, QA Engineer, Keeper Engineer, Infrastructure Engineer, Frontend Engineer, and Solana Engineer), this document establishes the **formal Phase 1 Approval Plan**.

### Core Policy Directives:
1. **Independent Verification Over Opinion:** No finding is accepted or dismissed based on agent hierarchy. Every item is arbitrated using source-level code references, execution path proofs, and executable regression test specifications.
2. **Financial Invariant Preservation:** Any change altering user collateral, quote accounting, funding rate accumulation, or liquidation absorption must provide a mathematical proof that Invariants $I-1$ through $I-12$ remain strictly conserved ($0$ micro-USDC drift, $0$ lot drift).
3. **Event Schema Precedence Over Database Infrastructure:** Database tables and indexing services remain gated until event contracts (`FundingAccrued`, `MarketParamsUpdated`, `VaultParamsUpdated`) are specified and implemented on-chain by the Solana Engineer.

---

## 2. Formal Resolution of Technical Discrepancies

### 2.1 [H-1] Funding Residual Accounting (`settle_users.rs` & `expire_and_release.rs`)
- **Security Auditor Position:** CRITICAL vulnerability. Calling `market.fee_pool.checked_sub(neg)` will panic with `MathOverflow` whenever a user who is owed funding settles in a paged transaction without offsetting payers, permanently bricking the batch and ring slot.
- **QA Engineer Position:** VERIFIED. Residual math accumulates payers' ceil minus receivers' floor into `total_funding_residual: i128` and credits `market.fee_pool`.
- **Architectural Investigation & Code Evidence:**
  - Source inspection of `programs/epoch/src/instructions/settle_users.rs` (lines 218–225) reveals:
    ```rust
    } else if total_funding_residual < 0 {
        let neg = u64::try_from(total_funding_residual.checked_abs().ok_or(EpochError::MathOverflow)?)
            .map_err(|_| EpochError::MathOverflow)?;
        market.fee_pool = market
            .fee_pool
            .checked_sub(neg)
            .ok_or(EpochError::MathOverflow)?;
    }
    ```
  - Mechanism Spec §8 proves that across the *entire universe* of positions, ceil on payers minus floor on receivers produces $\sum \text{residuals} \ge 0$.
  - However, Solana transaction compute limits force **paged settlements ($\le 16$ users/tx)**. If page $P$ consists exclusively of funding receivers (e.g., net longs when funding was positive), `total_funding_residual` for that specific transaction is strictly negative.
  - In a nascent or low-volume market, `market.fee_pool` starts at $0$. Executing `0.checked_sub(neg)` returns `None`, throwing `EpochError::MathOverflow` and aborting the transaction.
  - The batch can never transition to `SETTLED`. The ring slot remains permanently blocked with `RingSlotBusy` (error 6007).
- **Ruling & Mathematical Invariant Analysis:**
  - **Verdict:** **Security Auditor Upheld (CRITICAL).** QA's verification tested only whole-universe settlements where payers and receivers were co-located in the same transaction.
  - **Invariant $I-1$ Conservation:** $\sum (C + Q) + \text{fee\_pool} + \text{insurance\_fund} == \text{vault\_balance}$.
  - Debiting `fee_pool` for user quote gains is mathematically incorrect: funding is a peer-to-peer zero-sum transfer between longs and shorts. Rounding residuals are tiny fractional micro-USDC ($< 1$ micro-USDC per position).
  - **Authorized Remediation:** 
    1. Introduce an explicit signed accumulator on `Market` or isolate funding residual crediting.
    2. In `settle_users.rs` and `expire_and_release.rs`, negative funding residuals within a transaction page must NOT directly debit `market.fee_pool` below zero.
    3. Use saturating deduction or accumulate into a dedicated `funding_residual_accum: i128` field, preserving Invariant $I-1$ conservation across pages.

---

### 2.2 [H-2] Early Batch Clearing (`clear_batch.rs`)
- **Security Auditor Position:** HIGH vulnerability. Source code contains an admin bypass clause `|| market.admin == ctx.accounts.cranker.key()`, permitting the admin to prematurely close and clear batches before `close_slot`.
- **QA Engineer Position:** VERIFIED. Closed batch boundary is strictly enforced against `start_slot + (batch_id + 1) * batch_slots`.
- **Architectural Investigation & Code Evidence:**
  - Source inspection of `programs/epoch/src/instructions/clear_batch.rs` (lines 108–111):
    ```rust
    require!(
        current_slot >= close_slot || market.admin == ctx.accounts.cranker.key(),
        EpochError::BatchNotOpen
    );
    ```
  - The disjunction explicitly permits `market.admin` to crank `clear_batch` at any arbitrary slot while `current_slot < close_slot`.
  - QA's test suite (`tests/epoch.ts#L896`) only tested that a *non-admin* caller is rejected before `close_slot`. It did not test or detect that an admin caller successfully bypasses the auction window.
  - Permitting premature clearance allows the admin to observe early orders and snipe the auction before counter-flow enters or before users can cancel orders.
- **Ruling:**
  - **Verdict:** **Security Auditor Upheld (HIGH).** An FBA protocol must be fully deterministic and permissionless.
  - **Authorized Remediation:** Remove `|| market.admin == ctx.accounts.cranker.key()` from `clear_batch.rs`. Enforce `require!(current_slot >= close_slot, EpochError::BatchNotOpen)` unconditionally.

---

### 2.3 [H-3] Batch Expiration Bypass (`expire_and_release.rs`)
- **Security Auditor Position:** HIGH vulnerability. The clause `|| market.admin == ctx.accounts.caller.key()` permits the admin to force-void an active, non-stale batch within the clearing window.
- **QA Engineer Position:** VERIFIED. Batches exceeding `max_clear_delay_slots` transition to `VOID`.
- **Architectural Investigation & Code Evidence:**
  - Source inspection of `programs/epoch/src/instructions/expire_and_release.rs` (lines 64–68):
    ```rust
    if batch.status == BatchStatus::OPEN {
        let is_stale = current_slot > close_slot.saturating_add(max_delay)
            || market.admin == ctx.accounts.caller.key();
        require!(is_stale, EpochError::BatchNotStale);
        batch.status = BatchStatus::VOID;
    ```
  - This grants the protocol admin a "free option": if market price moves adversely against the Backstop Vault, the admin can unilaterally void the batch before clearance, voiding all user orders without execution.
- **Ruling:**
  - **Verdict:** **Security Auditor Upheld (HIGH).**
  - **Authorized Remediation:** Remove `|| market.admin == ctx.accounts.caller.key()` from `expire_and_release.rs`. Only genuine timeout staleness (`current_slot > close_slot + max_delay`) may trigger voiding.

---

### 2.4 [H-4] Vault Liquidation Solvency (`liquidate.rs`)
- **Security Auditor Position:** HIGH vulnerability. `liquidate.rs` transfers underwater positions directly into `vault_user` without checking vault equity against MMR or validating `max_inventory_lots`. Large liquidations can drive the Backstop Vault deeply insolvent.
- **QA Engineer Position:** VERIFIED. Vault quotes with inventory skew, constrained by `max_inventory_lots`.
- **Architectural Investigation & Code Evidence:**
  - Source inspection of `programs/epoch/src/instructions/liquidate.rs` (lines 138–175) confirms that the liquidatee's full base position and mark-to-market notional are transferred into `vault_user` without running `check_margin_requirement` on `vault_user` or checking inventory limits.
  - However, simply checking `vault_user.equity >= MMR` and reverting on failure would create a worse deadlock: unliquidatable accounts would remain open, accumulating catastrophic bad debt during market crashes.
- **Ruling & Invariant Analysis:**
  - **Verdict:** **Nuanced Architectural Resolution.** Both agents identified valid constraints. Unchecked absorption creates insolvency, but aborting liquidation freezes risk mitigation.
  - **Authorized Remediation for Phase 1:**
    1. Check `vault_user` equity post-absorption. If absorption would drive vault equity negative, absorb up to the vault's solvency threshold and socialise/record bad debt via `market.bad_debt` (Invariant $I-11$).
    2. Provide an explicit invariant proof that `collateral_vault` SPL balance equals the sum of solvent collateral, fee pool, and insurance fund minus bad debt.
    3. Defer complex Auto-Deleveraging (ADL) queues to Phase 2.

---

### 2.5 [H-5] Oracle Anchor-Price Window Manipulation (`post_price.rs` / `clear_batch.rs`)
- **Security Auditor Position:** HIGH vulnerability. Discrete 75-slot anchor resets permit back-to-back price boundary stacking ($+30\text{ bps}$ at slot 74, $+30\text{ bps}$ at slot 75 $\implies +60\text{ bps}$ in 1 slot). In Pyth Mode, crankers hold a "free look" selection window.
- **QA Engineer Position:** VERIFIED. Validates feed ID, age $\le 10\text{s}$, and confidence band $\le 20\text{ bps}$.
- **Architectural Investigation & Code Evidence:**
  - Source inspection of `post_price.rs` (lines 80–119) confirms the discrete boundary behavior at `clock.slot - oracle.anchor_slot >= 75`.
  - In `clear_batch.rs` (lines 146–158), any update satisfying `close_slot <= posted_slot <= close_slot + max_delay` is currently valid.
- **Ruling:**
  - **Verdict:** **Security Auditor Upheld (HIGH).**
  - **Authorized Remediation:**
    1. Authority Mode: Smooth the discrete 75-slot anchor or enforce per-slot movement allowances during window rollovers.
    2. Pyth Mode: Enforce deterministic price selection by requiring the cranker to provide the *first available update* landed on or after `close_slot`.

---

### 2.6 [M-1] Ring Slot Reuse Deadlock & Griefing (`place_order.rs`)
- **Security Auditor Position:** HIGH vulnerability. If any order remains unsettled (`settled_orders < num_orders`), `is_reusable` returns false, allowing an attacker or delayed cranker to permanently lock ring slots.
- **QA Engineer Position:** VERIFIED. Slot reuse strictly requires `batch.status == SETTLED` or `VOID` or `num_orders == 0` to prevent dirty overwrites.
- **Architectural Investigation & Code Evidence:**
  - Under normal conditions, `settle_users` and `expire_and_release` are permissionless. Any user or keeper can crank remaining accounts to complete settlement.
  - The catastrophic permanent lock occurs when paired with bug **ADD-1** (which makes `settled_orders == num_orders` unreachable).
- **Ruling:**
  - **Verdict:** **Remediated by Fixing ADD-1 + Adding Timeout Eviction.**
  - **Authorized Remediation:** Once ADD-1 is resolved, orders settle cleanly. Additionally, allow batch reuse if `current_slot > close_slot + (max_clear_delay * 4)` after forcibly cancelling and releasing remaining unsettled dust.

---

### 2.7 [ADD-1] Vault Quote Cancellation Counter Leak (`vault_quote.rs`)
- **Security Auditor Position:** CRITICAL vulnerability. In `vault_quote.rs`, when quotes on disallowed sides are cancelled, `batch.orders[i].status = OrderStatus::CANCELLED;`, but `batch.settled_orders` is **never incremented** and `vault_user.active_orders` is **never decremented**. Because `settle_users` skips cancelled orders, `settled_orders` can never reach `num_orders`, permanently bricking the ring slot with `RingSlotBusy`.
- **Architectural Investigation & Code Evidence:**
  - Source inspection of `programs/epoch/src/instructions/vault_quote.rs` (lines 185–206):
    ```rust
    if is_match {
        if side == OrderSide::BUY && !allow_bids {
            batch.bid_qty[tick] = batch.bid_qty[tick].saturating_sub(lots);
            vault_user.pending_buy_lots = vault_user.pending_buy_lots.saturating_sub(lots);
            batch.orders[i].status = OrderStatus::CANCELLED;
        } else if side == OrderSide::SELL && !allow_asks {
            batch.ask_qty[tick] = batch.ask_qty[tick].saturating_sub(lots);
            vault_user.pending_sell_lots = vault_user.pending_sell_lots.saturating_sub(lots);
            batch.orders[i].status = OrderStatus::CANCELLED;
        }
    }
    ```
  - In `cancel_order.rs` (lines 74–77), user cancellations perform:
    ```rust
    order.status = OrderStatus::CANCELLED;
    user.active_orders = user.active_orders.saturating_sub(1);
    batch.settled_orders = batch.settled_orders.saturating_add(1);
    ```
  - `vault_quote.rs` completely omits `settled_orders` increment and `active_orders` decrement!
  - In `settle_users.rs` line 108:
    ```rust
    if order.status == OrderStatus::SETTLED || order.status == OrderStatus::CANCELLED {
        continue;
    }
    ```
  - Result: `batch.settled_orders` can **never reach `num_orders`**. When the ring wraps at batch $B + 8$, `place_order` fails with `RingSlotBusy` for eternity.
- **Ruling:**
  - **Verdict:** **Security Auditor Upheld (CRITICAL Priority 1).**
  - **Authorized Remediation:** Add `batch.settled_orders = batch.settled_orders.saturating_add(1)` and `vault_user.active_orders = vault_user.active_orders.saturating_sub(1)` inside `vault_quote.rs`.

---

## 3. Investigation of Rust Test Count Discrepancies (43 vs 37 vs 105)

### Root Cause Analysis:
- **Discrepancy Origin:**
  - QA reported **37 passed tests** (`cargo test --workspace`).
  - Prior documentation / auditor notes referenced **43 passed tests**.
  - Direct execution of `cargo test --workspace` across the actual codebase executes **105 tests** (or **112 tests** with `--features authority-oracle`).

### Mathematical Breakdown:
1. **Core Parameter & Functional Integration Tests (37 Tests):**
   - `test_parameter_bounds.rs`: 17 tests
   - `test_safe_conversions.rs`: 4 tests
   - `test_spec_6_1_clearing_ladder.rs`: 4 tests
   - `test_zero_volume_funding.rs`: 2 tests
   - `test_order_buffer_griefing.rs`: 2 tests
   - `test_orphan_pending_orders.rs`: 2 tests
   - `test_token_mint_constraints.rs`: 1 test
   - `test_funding_accrual_seconds.rs`: 5 tests
   - **Subtotal = Exactly 37 tests.** QA's execution filter targeted this specific functional regression group.
2. **Oracle Selection Expansion (43 Tests):**
   - Adding `test_oracle_selection_and_staleness.rs` (6 tests) to the 37 functional tests yields:
     $$37 + 6 = \mathbf{43\text{ tests}}.$$
3. **Full Comprehensive Workspace (105 / 112 Tests):**
   - `programs/epoch/src/lib.rs` (Unit tests): 23 tests
   - `crates/epoch-ref/src/lib.rs` (Reference engine & 1M permutation fuzz test): 14 tests
   - `tests/property_invariants.rs`: 4 tests
   - `tests/differential.rs` (10k randomized batches): 2 tests
   - `tests/test_expire_and_release_security.rs`: 4 tests
   - `tests/test_oracle_trust.rs`: 7 tests
   - `tests/test_initialize_batch_security.rs`: 4 tests
   - `tests/test_faucet_cooldown.rs`: 3 tests
   - `tests/export_golden_vectors.rs`: 1 test
   - Plus the 43 functional/oracle tests above = **105 tests total**!
   - Compiling with `--features authority-oracle` adds `test_authority_oracle_mode.rs` (7 tests) = **112 tests total**.

---

## 4. Standardized Test & Execution Commands

To prevent test execution failures due to missing tools (e.g. `vitest`), the canonical commands across all components are standardized as follows:

| Component | Standardized Command | Environment / Runner | Current Pass Rate |
| :--- | :--- | :--- | :--- |
| **Rust Smart Contracts** | `cargo test --workspace` | Native Rust Cargo 1.89+ | **105 / 105 (100%)** |
| **Authority Oracle Feature**| `cargo test --workspace --features authority-oracle` | Native Rust Cargo | **112 / 112 (100%)** |
| **Frontend Web Terminal** | `cd app && bun test` | Bun Test Runner (Native) | **2 / 2 (100%)** |
| **Keeper Cranker Daemon** | `cd keeper && bun test` | Bun Test Runner (Native) | **4 / 4 (100%)** |
| **Anchor Integration** | `anchor test` | Localnet Validator + ts-mocha | **30 tests (Unblocking below)**|

### Anchor Test Suite Unblocking Requirements:
1. `Anchor.toml`: Add `bind_address = "127.0.0.1"` under `[test.validator]`.
2. `tests/epoch.ts:133`: Prefix `Keypair.generate()` to `anchor.web3.Keypair.generate()` or import `Keypair` from `@solana/web3.js`.
3. Keypair Sync: Align `target/deploy/epoch-keypair.json` with `epoch.config.json`.

---

## 5. Agent Scope & Task Authorization (Phase 1)

### 5.1 Solana Engineer (`agent/solana-engineer`) — AUTHORIZED
1. **[ADD-1 Fix]:** Implement counter updates (`settled_orders += 1`, `active_orders -= 1`) in `vault_quote.rs`.
2. **[H-1 Fix]:** Rework funding residual accounting in `settle_users.rs` and `expire_and_release.rs` to eliminate `fee_pool` underflow during partial user settlement pages.
3. **[H-2 & H-3 Fix]:** Remove administrative bypass conditions (`|| market.admin == ...`) from `clear_batch.rs` and `expire_and_release.rs`.
4. **[H-4 Hardening]:** Implement Backstop Vault equity guard in `liquidate.rs` with Invariant $I-11$ bad-debt accounting.
5. **[Event Contracts]:** Emit `FundingAccrued`, `MarketParamsUpdated`, and `VaultParamsUpdated` events to unblock Infrastructure.

### 5.2 Keeper Engineer (`agent/keeper-engineer`) — AUTHORIZED
1. **[Operational Hygiene]:** Remove keeper keypair and third-party credentials from repository tracking; add `.dockerignore`.
2. **[RPC Optimization]:** Replace broad `getProgramAccounts` polling with targeted account subscription on ring buffer PDAs.
3. **[Execution Safety]:** Add local transaction simulation before submission (`preflightCommitment`) to avoid fee burning on stale batches.
4. **[Dual-Mode Oracle]:** Stream Pyth Hermes updates and enforce fresh price account generation.

### 5.3 Frontend Engineer (`agent/frontend-engineer`) — AUTHORIZED
1. **[PnL Display Fix]:** In `BottomLedger.tsx:275`, wrap `position.sizeLots` with `Math.abs()` to eliminate negative percentage PnL on profitable short positions.
2. **[Slot vs. Second Header Fix]:** In `Header.tsx:158`, correct `{slotsRemaining}s` label to slots or duration based on measured slot time.
3. **[WASM Engine Synchronization]:** Verify `clearingEngine.ts` and `epoch_ref.wasm` client parity against updated Anchor program IDL.

### 5.4 Infrastructure Engineer (`agent/infrastructure-engineer`) — PARTIALLY GATED
1. **AUTHORIZED:** Docker configuration hardening (`bun.Dockerfile`, `.dockerignore`, removing deploy key defaults).
2. **GATED:** PostgreSQL indexer database implementation and REST/WS API servers remain gated until Solana Engineer emits the agreed event contracts.

### 5.5 QA Engineer (`agent/qa-engineer`) — AUTHORIZED
1. Apply Anchor test suite unblocking fixes in `tests/epoch.ts` and `Anchor.toml`.
2. Author regression test suites for all Phase 1 fixes:
   - `test_vault_quote_cancellation_settled_orders` (ADD-1).
   - `test_partial_page_negative_funding_settlement` (H-1).
   - `test_clear_batch_rejects_admin_before_close_slot` (H-2).
   - `test_expire_and_release_rejects_admin_in_clearing_window` (H-3).
3. Execute end-to-end localnet lifecycle validation.

### 5.6 Security Auditor (`agent/security-audit`) — AUTHORIZED
1. Review code diffs for ADD-1, H-1, H-2, H-3, and H-4.
2. Verify Invariant $I-1$ through $I-12$ preservation across all patch implementations.
3. Deliver Phase 1 Final Audit Sign-Off.

---

## 6. Release Gating Criteria (Phase 1)

Before any code merge into `main` or public Devnet deployment:
- [ ] `cargo test --workspace` passes 100% (all 105+ tests).
- [ ] `cd app && bun test` passes 100%.
- [ ] `cd keeper && bun test` passes 100%.
- [ ] `anchor test` executes cleanly (all 30+ tests passing on local validator).
- [ ] Invariant $I-1$ ($\Delta C = 0$) and $I-4$ ($\sum \text{base} = 0$) verified with zero micro-USDC drift across 10,000 differential batches.
- [ ] All committed keypairs, credentials, and secrets expunged.
- [ ] Formal sign-off by Lead Architect and Security Auditor.
