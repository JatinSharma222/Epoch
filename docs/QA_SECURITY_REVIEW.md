# Adversarial Protocol Verification & Security Audit Review: Epoch Protocol

**Author:** Principal QA / Protocol Verification Engineer  
**Date:** 2026-11-08  
**Scope:** Independent Adversarial Verification of Security Audit Findings (`H-1`, `H-2`, `H-3`, `H-4`, `H-5`, `M-1`, `ADD-1`) and Test Pipeline Diagnoses  
**Repository Branch:** `agent/qa-engineer`  
**Classification:** Confirmed Findings, Adversarial Proofs, and Architectural Review  

---

## Executive Summary & Findings Scorecard

An independent, adversarial review of the Security Auditor's findings was conducted against the on-chain SBF instructions, account state machines, and mathematical conservation invariants of the Epoch Protocol.

Unlike baseline test execution, this exercise actively modeled hostile admin signatures, asymmetric integer truncations, partial page settlements, multi-slot oracle stalls, extreme inventory dumps, and abandoned orders.

### Auditor Findings Verification Matrix

| Vulnerability ID | Auditor Title | QA Verdict | Verified Severity | Exact Source Reference | Key Proof / Reason |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **H-1** | `fee_pool` Underflow in Negative Funding Residual Paths | **Confirmed vulnerability** | **CRITICAL** | `settle_users.rs:89-95`, `settle_users.rs:218-225`, `expire_and_release.rs:185-191` | When funding-receiving users are settled in a page without offsetting payers, `total_funding_residual < 0`. If `fee_pool < abs(residual)`, `checked_sub` reverts with `MathOverflow`, freezing settlement and permanently locking ring slots. |
| **H-2** | Admin Bypass in `clear_batch` Timing Validation | **Partially valid** | **MEDIUM** | `clear_batch.rs:108-111`, `clear_batch.rs:148-157` | The bypass clause `current_slot >= close_slot \|\| market.admin == cranker` exists in Step 2, but early clearance cannot execute because Step 4 strictly enforces `oracle_posted_slot >= close_slot` and `oracle_posted_slot <= current_slot`, which cannot be satisfied when `current_slot < close_slot`. |
| **H-3** | Admin Bypass in `expire_and_release` | **Confirmed vulnerability** | **HIGH** | `expire_and_release.rs:65-68` | `is_stale = current_slot > close_slot + max_delay \|\| market.admin == caller` allows the admin to unilaterally void an active, open batch at slot 0 mid-auction, providing an unfair cancellation free option with 0 fills. |
| **H-4** | Missing Vault Margin Validation During Liquidation | **Confirmed vulnerability** | **HIGH** | `liquidate.rs:138-175` | `liquidate.rs` transfers 100% of liquidatee base and notional quote to `vault_user` with zero margin checks and zero inventory checks. Absorbing large positions can push vault equity negative, bankrupting the Backstop Vault. |
| **H-5** | Oracle Anchor Window Manipulation & Stalling | **Confirmed vulnerability** | **HIGH** | `post_price.rs:85-119`, `clear_batch.rs:146-158` | 1) Layer B discrete 75-slot anchor resets to old price and hard-reverts on moves >30 bps, permanently deadlocking the oracle after network pauses >75 slots. 2) In Pyth mode, cranker has a free-look option across all updates within the clearing window. |
| **M-1** | Ring Slot Reuse Deadlock & Griefing | **Confirmed vulnerability** | **HIGH** | `place_order.rs:128-139`, `vault_quote.rs:156-167` | An abandoned or stuck batch where `settled_orders < num_orders` returns `is_reusable = false`. Ring slot $r$ cannot be reused for batch $r+8$, allowing an attacker with 8 small orders to permanently halt protocol order intake. |
| **ADD-1** | Silent Ring Slot Bricking in `vault_quote.rs` | **Confirmed vulnerability** | **CRITICAL** | `vault_quote.rs:185-206`, `settle_users.rs:108-110` | Disallowed-side quotes are marked `CANCELLED` without incrementing `batch.settled_orders` or decrementing `vault_user.active_orders`. Because `settle_users` skips `CANCELLED` orders, `settled_orders` never reaches `num_orders`. Ring slot is permanently bricked with `RingSlotBusy`. |

---

## 1. Adversarial Deep-Dive: Security Audit Findings

---

### [H-1] `fee_pool` Underflow in Negative Funding Residual Paths
- **Classification:** **Confirmed vulnerability**
- **Severity:** **CRITICAL (Protocol Halting)**
- **Source References:**
  - `programs/epoch/src/instructions/settle_users.rs:89-96`, `settle_users.rs:218-225`
  - `programs/epoch/src/instructions/expire_and_release.rs:185-191`

#### Detailed Mechanism & Account State Transitions
In `settle_users.rs`, when a user holds an open position and the funding index moves:
```rust
let delta = funding_index - user.funding_snapshot;
let prod = user.base_position as i128 * delta;
let payment = if prod > 0 {
    (prod + F_SCALE - 1) / F_SCALE // User pays funding
} else {
    prod / F_SCALE                 // User receives funding (negative integer)
};
user.quote_position = user.quote_position.checked_sub(payment).ok_or(EpochError::MathOverflow)?;
total_funding_residual = total_funding_residual.checked_add(payment).ok_or(EpochError::MathOverflow)?;
```
At the end of processing the page of users:
```rust
if total_funding_residual > 0 {
    let residual_u64 = u64::try_from(total_funding_residual)...;
    market.fee_pool = market.fee_pool.checked_add(residual_u64)?;
} else if total_funding_residual < 0 {
    let neg = u64::try_from(total_funding_residual.checked_abs()...)?;
    market.fee_pool = market.fee_pool.checked_sub(neg).ok_or(EpochError::MathOverflow)?;
}
```

#### Constructing the Adversarial Edge Case
1. **Partial Page Settlement:** A Solana transaction can settle at most 16 accounts. In an asynchronous environment, user settlements are split across transactions. If Transaction 1 settles only short positions during a period where longs pay shorts (`prod < 0`), every user in that transaction has `payment < 0`.
2. **Gross vs Residual Confusion:** The code mistakenly accumulates `payment` (the entire gross funding payment) into `total_funding_residual`, NOT just the integer rounding residual `payment - prod / F_SCALE`!
3. **Empty / Fresh Fee Pool:** On a fresh market, or when accrued trading fees have been swept, `market.fee_pool == 0`.
4. **Execution Failure:** `market.fee_pool.checked_sub(neg)` attempts `0 - neg`, returning `None`. The instruction reverts with `EpochError::MathOverflow`.
5. **Ring Slot Deadlock:** The batch can never reach `BatchStatus::SETTLED` (`settled_orders` remains `< num_orders`). The ring index cannot be reused by `place_order`.

#### Reproducible Test Evidence
- **Regression Test:** `programs/epoch/tests/test_security_audit_regressions.rs::test_h1_fee_pool_underflow_negative_funding_residual`
- **Result:** **PASSED (Reproduced underflow panic)**
- **Remediation:**
  1. Remove deductions from `market.fee_pool` during user settlement. Funding is peer-to-peer across users' quote balances.
  2. If tracking true rounding residuals, subtract only `payment - prod / F_SCALE` and use `saturating_sub` rather than reverting.

---

### [H-2] Admin Bypass in `clear_batch` Timing Validation
- **Classification:** **Partially valid**
- **Severity:** **MEDIUM (Architectural Code Smell / Redundant Backdoor)**
- **Source References:**
  - `programs/epoch/src/instructions/clear_batch.rs:108-111`
  - `programs/epoch/src/instructions/clear_batch.rs:148-157`

#### Detailed Mechanism & Account State Transitions
In Step 2 of `clear_batch.rs`:
```rust
require!(
    current_slot >= close_slot || market.admin == ctx.accounts.cranker.key(),
    EpochError::BatchNotOpen
);
```
The auditor correctly identified that this boolean expression evaluates to `true` for `market.admin` even if `current_slot < close_slot`.

#### Constructing the Adversarial Edge Case & Why It Fails
Suppose the admin attempts to clear an open batch at slot `current_slot = 105` where `close_slot = 110`.
1. Step 2 (`require!(current_slot >= close_slot || market.admin == cranker)`) succeeds.
2. In Step 4 (`clear_batch.rs:148-157`), the contract validates the oracle update:
   ```rust
   require!(oracle_posted_slot >= close_slot, EpochError::OraclePostedBeforeClose);
   require!(oracle_posted_slot <= current_slot, EpochError::InvalidOracleAccount);
   ```
3. To clear, there must exist an `oracle_posted_slot` such that:
   $$\text{close\_slot} \le \text{oracle\_posted\_slot} \le \text{current\_slot}$$
4. Since `current_slot = 105 < close_slot = 110`, this inequality becomes:
   $$110 \le \text{oracle\_posted\_slot} \le 105$$
   This is mathematically impossible.
   - If `oracle_posted_slot < 110`: reverts with `OraclePostedBeforeClose`.
   - If `oracle_posted_slot >= 110`: reverts with `InvalidOracleAccount`.

#### Verdict Rationale
**Partially valid.** The admin bypass clause at line 109 is real and violates the pure permissionless specification, but it is currently non-exploitable for premature auction clearance because the downstream oracle window strictly prevents execution when `current_slot < close_slot`. It should nonetheless be removed to prevent future regression.

#### Reproducible Test Evidence
- **Regression Test:** `programs/epoch/tests/test_security_audit_regressions.rs::test_h2_admin_early_clear_bypass_and_oracle_window_conflict`
- **Result:** **PASSED (Proves oracle selection blocks early clear)**

---

### [H-3] Admin Bypass in `expire_and_release`
- **Classification:** **Confirmed vulnerability**
- **Severity:** **HIGH (Unilateral Free Cancellation Option)**
- **Source References:**
  - `programs/epoch/src/instructions/expire_and_release.rs:65-68`

#### Detailed Mechanism & Account State Transitions
In `expire_and_release.rs`:
```rust
if batch.status == BatchStatus::OPEN {
    let is_stale = current_slot > close_slot.saturating_add(max_delay)
        || market.admin == ctx.accounts.caller.key();
    require!(is_stale, EpochError::BatchNotStale);

    batch.status = BatchStatus::VOID;
    batch.clearing_tick = CENTER_TICK as u16;
    batch.clearing_price = market.last_oracle_price;
    batch.matched_lots = 0;
```
Unlike `clear_batch.rs`, `expire_and_release.rs` performs **no oracle timestamp or slot validation**.

#### Adversarial Impact & Attack Scenario
1. An open batch is actively receiving user orders against the Backstop Vault ladder.
2. An external market shock occurs that would execute vault liquidity at an adverse price.
3. The admin invokes `expire_and_release(batch_id, ring_index)` at `current_slot < close_slot`.
4. The batch is instantly forced into `BatchStatus::VOID`. `matched_lots` is forced to 0.
5. All genuine trader matches are canceled with 0 fills.
6. This provides the protocol operator an unfair, unilateral "kill switch" to void unprofitable auctions.

#### Reproducible Test Evidence
- **Regression Test:** `programs/epoch/tests/test_security_audit_regressions.rs::test_h3_admin_unilateral_premature_void_free_option`
- **Result:** **PASSED (Admin unilaterally voids in-window batch; regular user rejected)**
- **Remediation:** Remove `|| market.admin == ctx.accounts.caller.key()`.

---

### [H-4] Missing Vault Margin Validation During Liquidation
- **Classification:** **Confirmed vulnerability**
- **Severity:** **HIGH (Cascading Protocol Insolvency)**
- **Source References:**
  - `programs/epoch/src/instructions/liquidate.rs:138-175`

#### Detailed Mechanism & Account State Transitions
When an underwater user is liquidated:
```rust
vault_user.base_position = vault_user.base_position.checked_add(old_user_base)?;
vault_user.quote_position = vault_user.quote_position.checked_sub(notional as i128)?;
```
1. `liquidate.rs` does not call `check_margin_requirement` on `vault_user`.
2. `liquidate.rs` does not verify `vault_user.base_position <= market.vault_params.max_inventory_lots`.

#### Adversarial Impact & Insolvency Scenario
1. A whale trader with a 10,000-lot long position is liquidated.
2. The Backstop Vault currently has only 1 USDC of collateral and 0 position.
3. The 10,000 lots are transferred to `vault_user`.
4. If the price moves adversely by 5% ($5/SOL), `vault_user` suffers a -$50.00 loss (-50,000,000 micro-USDC).
5. The Backstop Vault's equity becomes -$49.00 USDC, rendering the vault deeply underwater.
6. When future batches clear, the vault has negative margin and cannot cover further liquidations or user fills.

#### Reproducible Test Evidence
- **Regression Test:** `programs/epoch/tests/test_security_audit_regressions.rs::test_h4_missing_vault_margin_validation_during_liquidation`
- **Result:** **PASSED (Vault equity drops below -$40,000,000 micro-USDC; inventory breaches limits by 20x)**
- **Remediation:** Verify that post-liquidation vault equity satisfies maintenance margin and initiate auto-deleveraging (ADL) if vault capacity is exceeded.

---

### [H-5] Oracle Anchor Window Manipulation & Stalling
- **Classification:** **Confirmed vulnerability**
- **Severity:** **HIGH (Denial of Service / Unfair Price Selection)**
- **Source References:**
  - `programs/epoch/src/instructions/post_price.rs:85-119`
  - `programs/epoch/src/instructions/clear_batch.rs:146-158`

#### Detailed Mechanism & Account State Transitions
In `post_price.rs`:
```rust
// Layer B: Cumulative Anchor Bound (75-slot window)
if oracle.anchor_price == 0 {
    oracle.anchor_price = oracle.price;
    oracle.anchor_slot = clock.slot;
} else if clock.slot.saturating_sub(oracle.anchor_slot) >= 75 {
    oracle.anchor_price = oracle.price; // Resets to last stored price
    oracle.anchor_slot = clock.slot;
}

let anchor_delta = (price as i128 - oracle.anchor_price as i128).unsigned_abs();
let anchor_move_bps = (anchor_delta * 10_000) / oracle.anchor_price as u128;
require!(anchor_move_bps <= 30u128, EpochError::OraclePriceJumpTooLarge);
```

#### Adversarial Analysis
1. **Persistent Lockout After Outage:** If the oracle experiences a transient delay of >75 slots (e.g. RPC blip of ~30 seconds), external market price may have moved by 45 bps.
   - Layer A correctly expands tolerance (+1 bps per slot elapsed).
   - Layer B resets `anchor_price` to `oracle.price` (the stale pre-outage price) and strictly requires `anchor_move_bps <= 30`.
   - Any transaction with the true market price reverts with `OraclePriceJumpTooLarge`.
   - Because the transaction reverts, `anchor_slot` is never updated. On slot 76, 77, 78..., the contract remains anchored to the pre-outage price. The oracle is deadlocked until artificial stepped updates are posted.
2. **Cranker Selection Option:** In Pyth mode, any price update satisfying `close_slot <= posted_slot <= close_slot + max_clear_delay_slots` is valid. A cranker holding orders in the batch can choose whichever Pyth price update within the window maximizes their fill profitability.

#### Reproducible Test Evidence
- **Regression Test:** `programs/epoch/tests/test_security_audit_regressions.rs::test_h5_oracle_anchor_price_window_stalling_and_boundary_stacking`
- **Result:** **PASSED (Proves 45 bps move after 80 slots reverts and locks oracle)**
- **Remediation:** Use an exponential moving average (EMA) or scale Layer B tolerance with elapsed slots. In `clear_batch.rs`, enforce strict determinism by requiring the *first* valid price update.

---

### [M-1] Ring Slot Reuse Deadlock & Griefing
- **Classification:** **Confirmed vulnerability**
- **Severity:** **HIGH (Denial of Service Griefing)**
- **Source References:**
  - `programs/epoch/src/instructions/place_order.rs:128-139`

#### Detailed Mechanism
In `place_order.rs`:
```rust
let is_reusable = batch.status == BatchStatus::EMPTY
    || batch.status == BatchStatus::SETTLED
    || batch.num_orders == 0
    || (batch.settled_orders >= batch.num_orders);

if is_reusable {
    batch.reset_for_batch(target_batch);
} else {
    return err!(EpochError::RingSlotBusy);
}
```
If batch 0 has 1 order and clears, but that order is not settled, `settled_orders == 0 < num_orders == 1`.
When batch 8 arrives, `is_reusable` evaluates to `false`, and `place_order` fails with `RingSlotBusy`.

#### Adversarial Impact
An attacker can submit 1 minimal order into each of the 8 ring buffer slots. If settlement of those orders is delayed, uncranked, or blocked by H-1, all 8 ring buffer slots become `RingSlotBusy`. No trader can place orders in any future batch.

#### Reproducible Test Evidence
- **Regression Test:** `programs/epoch/tests/test_security_audit_regressions.rs::test_m1_ring_slot_reuse_deadlock_unsettled_batch`
- **Result:** **PASSED (Confirmed ring slot 0 blocks batch 8)**

---

### [ADD-1] Silent Ring Slot Bricking in `vault_quote.rs` Quote Cancellation
- **Classification:** **Confirmed vulnerability**
- **Severity:** **CRITICAL (Permanent Silent Bricking of Ring Buffer)**
- **Source References:**
  - `programs/epoch/src/instructions/vault_quote.rs:185-206`
  - `programs/epoch/src/instructions/settle_users.rs:108-110`

#### Detailed Mechanism & The Missing Accounting
In `vault_quote.rs`, when inventory skew disallows bids:
```rust
if side == OrderSide::BUY && !allow_bids {
    batch.bid_qty[tick] = batch.bid_qty[tick].saturating_sub(lots);
    vault_user.pending_buy_lots = vault_user.pending_buy_lots.saturating_sub(lots);
    batch.orders[i].status = OrderStatus::CANCELLED;
}
```
Notice:
1. `batch.settled_orders` is **NOT incremented**.
2. `vault_user.active_orders` is **NOT decremented**.

When `settle_users.rs` processes the batch:
```rust
if order.status == OrderStatus::SETTLED || order.status == OrderStatus::CANCELLED {
    continue;
}
```
`settle_users` explicitly skips `OrderStatus::CANCELLED` orders!

#### The Permanent Bricking Cascade
1. Batch has 6 orders (3 buy, 3 sell).
2. Vault inventory changes; `vault_quote` cancels 3 buy orders. `batch.settled_orders` remains 0.
3. Batch clears. `settle_users` settles the 3 sell orders. `batch.settled_orders` becomes 3.
4. `settle_users` skips the 3 cancelled orders. `batch.settled_orders` stops at 3.
5. `batch.num_orders` is 6. `batch.settled_orders >= batch.num_orders` is **false**.
6. `batch.status` will **never** transition to `BatchStatus::SETTLED`.
7. When the next epoch targets this ring index ($B+8$):
   `is_reusable` checks `(batch.settled_orders >= batch.num_orders)`. It returns `false`.
8. The ring slot is **permanently bricked with `RingSlotBusy` for the rest of eternity**.

#### Reproducible Test Evidence
- **Regression Test:** `programs/epoch/tests/test_security_audit_regressions.rs::test_add1_vault_quote_silent_ring_bricking`
- **Result:** **PASSED (Reproduced exact permanent ring bricking)**
- **Remediation:** In `vault_quote.rs:199, 203`, add:
  ```rust
  batch.settled_orders = batch.settled_orders.saturating_add(1);
  vault_user.active_orders = vault_user.active_orders.saturating_sub(1);
  ```

---

## 2. Test Pipeline & Operational Diagnoses

### 2.1 Investigation: Why `cargo test` Reports Different Test Counts Across Agents

| Test Execution Command | Test Scope | Reported Count | Reason for Variance |
| :--- | :--- | :---: | :--- |
| `cargo test -p epoch` | `programs/epoch` (default features) | **91 tests** | Tests unit tests + integration tests. Skips `epoch-ref` crate and skips `authority-oracle` tests. |
| `cargo test -p epoch --features authority-oracle` | `programs/epoch` (authority-oracle) | **97 tests** | Enables `test_authority_oracle_mode.rs` (adds 6 tests guarded by `#![cfg(feature = "authority-oracle")]`). |
| `cargo test -p epoch-ref` | `crates/epoch-ref` | **14 tests** | Pure Rust reference clearing engine tests (including 1M permutation fuzz test). |
| `cargo test --workspace` (Baseline) | Both workspace crates (default features) | **105 tests** | 91 (`epoch`) + 14 (`epoch-ref`). Skips authority-oracle tests. |
| `cargo test --workspace --features authority-oracle` | Both crates (authority-oracle) | **111 tests** | 97 (`epoch`) + 14 (`epoch-ref`). |
| `cargo test --workspace` (With new QA suite) | Workspace + `test_security_audit_regressions.rs` | **112 tests** | Baseline 105 tests + 7 new adversarial regression tests. |

**Conclusion:** The test count discrepancy observed across agents was caused by differences in:
1. Workspace vs package flags (`--workspace` vs `-p epoch`).
2. Feature flags (`--features authority-oracle` enabling 6 conditional tests).
3. Anchor test runner invoking `cargo test` only on `programs/epoch` (91 tests).

---

### 2.2 Investigation: Local Validator Bind-Address Issue in `Anchor.toml`
- **Root Cause:** Anchor CLI 0.32.0 passes `--bind-address 0.0.0.0` by default when spawning `solana-test-validator`. In Agave/Solana CLI 3.0.15 on macOS, gossip node initialization panics with:
  ```text
  thread 'main' panicked at gossip/src/node.rs:259:59:
  called `Result::unwrap()` on an `Err` value: UnspecifiedIpAddr(0.0.0.0)
  ```
- **Safe Repair:** Add `bind_address = "127.0.0.1"` under `[test.validator]` in `Anchor.toml`.
  ```toml
  [test.validator]
  bind_address = "127.0.0.1"
  url = "https://api.devnet.solana.com"
  ```
  Verified: When `solana-test-validator` is passed `--bind-address 127.0.0.1`, it boots cleanly in under 2 seconds.

---

### 2.3 Investigation: Missing `Keypair` Import in `tests/epoch.ts`
- **Root Cause:** Line 133 of `tests/epoch.ts` calls `const oracleAuthKeypair = Keypair.generate();`.
- However, `Keypair` is not imported from `@solana/web3.js` at line 3.
- Across all other lines (48, 49, 824, 2167, 2525, 3100), the file uses `anchor.web3.Keypair.generate()`.
- **Safe Repair:** Change line 133 to:
  ```typescript
  const oracleAuthKeypair = anchor.web3.Keypair.generate();
  ```
  This unblocks Test 1 (`initializeMarket`), allowing the Market and Quote Mint PDA to initialize on-chain and preventing 29 downstream cascading failures.

---

### 2.4 Investigation: Program ID Keypair Synchronization
- **Root Cause:** `programs/epoch/src/lib.rs:15` specifies:
  ```rust
  declare_id!("ER8SSfvp7roW6asG429Uv3mHY1aEd1jxGBdigLu27284");
  ```
- Fresh builds create a random deploy keypair in `target/deploy/epoch-keypair.json`.
- When Anchor deploys this random keypair, transaction execution fails with `DeclaredProgramIdMismatch (4100)`.
- **Safe Repair:** Copy `~/.config/solana/epoch-v1-keys/epoch-program-keypair.json` to `target/deploy/epoch-keypair.json` prior to running `anchor test`.

---

### 2.5 Verification of Bun Test Runner for TypeScript Tests
Per instructions, Bun was used natively for all TypeScript unit tests:
- `cd app && bun test`: **2 passed, 0 failed [150ms]**
- `cd keeper && bun test`: **4 passed, 0 failed [112ms]**

Both test suites execute natively without Vitest or npm network dependencies.

---

## 3. Prioritized Remediation Roadmap for Solana Engineers

1. **Fix `ADD-1` & `H-1` Immediately:**
   - In `vault_quote.rs`, increment `batch.settled_orders` and decrement `vault_user.active_orders` when cancelling quotes.
   - In `settle_users.rs` and `expire_and_release.rs`, remove the fee pool deduction for negative funding payouts.
2. **Remove Backdoors (`H-3` & `H-2`):**
   - Remove `|| market.admin == ctx.accounts.caller.key()` from `expire_and_release.rs`.
   - Remove `|| market.admin == ctx.accounts.cranker.key()` from `clear_batch.rs`.
3. **Add Vault Risk Guards (`H-4`):**
   - In `liquidate.rs`, verify `vault_user` maintenance margin post-absorption and enforce `max_inventory_lots`.
4. **Fix Oracle Anchor Lockout (`H-5`):**
   - Scale Layer B anchor tolerance dynamically with elapsed slots to prevent permanent oracle lockout after delays >75 slots.
5. **Repair Anchor Test Configuration:**
   - Add `bind_address = "127.0.0.1"` in `Anchor.toml`.
   - Fix `tests/epoch.ts:133` to use `anchor.web3.Keypair.generate()`.

---

## 4. Certification & Sign-off

As Principal QA / Protocol Verification Engineer, I confirm that the 7 security findings have been rigorously investigated and mathematically verified through automated adversarial tests in [`programs/epoch/tests/test_security_audit_regressions.rs`](file:///Users/jatinsharma/Projects/Solana-Hackathon/Colosseum/Epoch-qa/programs/epoch/tests/test_security_audit_regressions.rs). Production code remains untouched and in read-only state.
