# Independent Security Audit Review: Phase 2 Remediation & Production Verification (Commit `440b28a`)

**Auditor:** Security Auditor (`agent/security-audit`)  
**Worktree:** `../Epoch-security`  
**Date:** 2026-11-09  
**Target Commit:** `440b28a2d12ef987bc39c8cd5af50848148b30fa` (Branch `agent/solana-engineer`)  
**Audit Scope:**
1. **H-4 Remediation:** ADL opposing direction validation, comprehensive remaining-account security checks, deterministic protocol ranking, double-entry transaction-level settlement, and actual Anchor instruction test suite (`test_h4_anchor_instruction.rs`).
2. **H-5 Remediation:** Cumulative movement bounds across repeated outage cycles, dual AND window expiration (`window_slots >= 150 && time_elapsed >= 60`), checked arithmetic, alternating movement defense, and adversarial governor test suite (`test_h5_governor_remediation.rs`).

---

## 1. H-4 Audit: Liquidation, ADL Validation & Anchor Instruction Conformance

### 1.1 ADL Counterparty Direction Validation
The auditor verified `apply_adl_counterparty` (lines 154–160 of `liquidate.rs`):
- Explicit opposing position check is strictly enforced:
  - If bankrupt is long (`bankrupt_is_long == true`), counterparty MUST hold a short position (`cp.base_position < 0`).
  - If bankrupt is short (`bankrupt_is_long == false`), counterparty MUST hold a long position (`cp.base_position > 0`).
  - If counterparty holds a same-direction position or flat position, the call immediately rejects with `EpochError::InvalidAdlCounterparty`.
- Fully verified across all 4 direction combinations in `test_h4_adl_direction_validation_combinations`:
  - Long bankrupt + Long counterparty: **REJECTED** (`InvalidAdlCounterparty`)
  - Short bankrupt + Short counterparty: **REJECTED** (`InvalidAdlCounterparty`)
  - Flat counterparty: **REJECTED** (`InvalidAdlCounterparty`)
  - Long bankrupt + Short counterparty: **SUCCESS**
  - Short bankrupt + Long counterparty: **SUCCESS**

### 1.2 Remaining-Account Validation & Deterministic Protocol Ranking
The auditor verified `process_liquidate_with_accounts` (lines 600–660 of `liquidate.rs`):
1. **Privilege & Ownership:**
   - Requires `acc_info.is_writable` (returns `Unauthorized` if false).
   - Requires `*acc_info.owner == crate::ID` (returns `Unauthorized` if false).
2. **PDA Derivation Verification:**
   - Derives `expected_pda = Pubkey::find_program_address(&[b"user", cp.owner.as_ref()], &crate::ID)`.
   - Requires `acc_info.key() == expected_pda` (returns `Unauthorized` on forged or arbitrary accounts).
3. **Duplicate Rejection:**
   - Tracks unique keys in `seen_accounts: BTreeSet<Pubkey>`. Duplicate accounts immediately reject with `EpochError::DuplicateUserAccount`.
4. **Self & Vault Protection:**
   - Rejects `acc_info.key() == user.key()` and `acc_info.key() == vault_user.key()` with `EpochError::InvalidUserAccount`.
5. **Deterministic Protocol Ranking:**
   - Calculates ADL score: $\text{score} = (\text{uPnL} \times 1,000,000) / \text{equity}$.
   - Sorts candidate accounts descending by score (`b.score.cmp(&a.score)`), with deterministic tie-breaking on `b.key.cmp(&a.key)`.
   - The caller's account order is completely ignored; the protocol guarantees that the counterparty with the highest leverage and profit is auto-deleveraged first.
   - Verified in `test_anchor_instruction_deterministic_protocol_ranking`: an adversarial caller supplying `[cp_low, cp_high]` is reordered so `cp_high` absorbs the liquidation first and `cp_low` is spared.

### 1.3 Complete Settlement & Accounting Reconciliation
The auditor verified `test_h4_hybrid_vault_and_adl_bankruptcy_reconciliation_long` and `test_h4_hybrid_vault_and_adl_bankruptcy_reconciliation_short`:
- Liquidatee position is completely zeroed out (base = 0, quote = 0, collateral = 0, flags cleared).
- Vault absorbs up to available headroom at $P_{\text{bk}}$ / oracle price.
- Remaining bankrupt lots are matched against opposing counterparties via ADL at $P_{\text{bk}}$.
- Insurance fund absorbs uncovered cash deficit up to available balance; remaining uncovered deficit increments `market.bad_debt`.
- Invariant I-1 ($\sum Q_i \equiv 0$) and Invariant I-11 (Vault Token Balance $\equiv \sum C_i + \text{FeePool} + \text{InsuranceFund} - \text{BadDebt}$) reconcile to **0 micro-USDC error**.

### 1.4 Actual Anchor Instruction Tests
The auditor verified `test_h4_anchor_instruction.rs` (7 / 7 passed):
- Executes `process_liquidate_with_accounts` directly on real 16-byte aligned binary memory via Anchor `AccountLoader` and `AccountInfo`.
- Exercises deposit curing via `apply_deposit_curing`: an undercollateralized user quarantined under `UserFlags::LIQUIDATING` is cured and un-quarantined only when a deposit restores equity $\ge \text{MMR}$.

---

## 2. H-5 Audit: Rate Governor Remediation & Adversarial Bounds

### 2.1 Mathematical Bound Across Repeated Outage Cycles
The auditor mathematically analyzed and verified `test_h5_cumulative_movement_bounded_across_repeated_outage_cycles`:
- **Attacker Model:** An attacker triggers 10 consecutive outages of 150 slots and 60 seconds, submitting a $+50\%$ price jump each cycle.
- **Mathematical Bound:**
  Each cycle requires $\Delta s \ge 150\text{ slots}$ and $\Delta t \ge 60\text{ seconds}$.
  In each cycle, the accepted price move is capped by the Tier 2 anchor deviation bound:
  $$|\Delta P_k| \le 30\text{ bps} \times P_{\text{anchor}}$$
  Across 10 cycles ($T = 600\text{ seconds} = 10\text{ minutes}$):
  $$\text{Total Price Drift} \le 300\text{ bps} \implies \text{Average Velocity} \le \frac{300\text{ bps}}{10\text{ min}} = 30\text{ bps/min} \le 60\text{ bps/min}$$
- Repeated outages **cannot** accelerate price movements; they restrict velocity to half of the normal continuous allowance ($30\text{ bps/min}$ vs $60\text{ bps/min}$).

### 2.2 Dual AND Window Expiration (`window_slots >= 150 && time_elapsed >= 60`)
The auditor verified lines 130–137 of `post_price.rs`:
- The velocity window resets **ONLY** when **BOTH** conditions are satisfied:
  $$\Delta s \ge 150 \quad \mathbf{AND} \quad \Delta t \ge 60\text{ seconds}$$
- **Fast Slot Protection:** If 150 slots execute in <60 seconds (cluster acceleration), the window cannot reset until 60 wall-clock seconds pass, preserving the $\le 60\text{ bps/minute}$ cap.
- **Congested Slot Protection:** If 60 seconds pass in <150 slots (cluster congestion), the window cannot reset until 150 slots pass, preserving the $\le 0.4\text{ bps/slot}$ density cap.
- Verified in `test_h5_repeated_window_resets_require_both_slots_and_time`.

### 2.3 Alternating Movement Defense & Microstructure Resilience
The auditor verified lines 145–175 of `post_price.rs`:
- The accumulator tracks net directional drift from `velocity_window_start_price`:
  $$\text{actual\_drift\_bps} = \frac{|P_t - P_{\text{start}}| \times 10,000}{P_{\text{start}}} \le 60\text{ bps}$$
- Bidirectional price fluctuations ($+15\text{ bps}, -15\text{ bps}$) return net displacement to $0\text{ bps}$ and do **NOT** exhaust the velocity budget or freeze the oracle.
- Verified in `test_h5_alternating_movements_do_not_freeze_oracle`: 50 alternating updates execute cleanly with $\text{velocity\_accumulator\_bps} \le 15$.

### 2.4 Arithmetic Safety & Monotonic Monopolies
- All multiplications and additions in `compute_continuous_ema` and `process_price_update` are safely widened to `u128` with `saturating_add`, `saturating_sub`, and `abs_diff`. Zero overflow or panic on extreme prices ($u64::\text{MAX} / 2$).
- Verified monotonic slot and timestamp enforcement: same-slot updates, past-slot updates, and timestamp regressions are strictly rejected with `EpochError::OracleStale`.
- Continuous EMA smoothing factor $\alpha$ is capped at $7,500\text{ bps}$ ($75\%$), ensuring the EMA anchor preserves memory across outages and cannot be hijacked in a single recovery update.

---

## 3. Production Oracle Validation Integrity

The auditor confirmed that:
- Production Pyth oracle validation in `oracle.rs` (`verify_price_update_strict_with_market`, `parse_and_validate_pyth_price_update`) remains **100% UNTOUCHED**.
- Pyth Receiver Program ID (`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`), discriminator check, `VerificationLevel::Full` quorum check, feed ID verification, and clear window bounds remain strictly enforced.

---

## 4. Final Security Auditor Verdict

The on-chain implementations in commit `440b28a2d12ef987bc39c8cd5af50848148b30fa` fully resolve all issues raised in the code review without defect or regression:
1. ADL counterparty direction validation rejects non-opposing positions across all combinations.
2. Remaining-account validation enforces ownership, writable privileges, PDA derivation, and duplicate rejection.
3. Deterministic protocol ranking guarantees protocol-governed ADL order independent of caller input.
4. Transaction-level balance sheet reconciliation verified for both long and short bankruptcies.
5. Actual Anchor instruction test suite passes 7/7 tests on aligned binary memory.
6. Repeated outage cycles are mathematically proved to be bounded by $\le 30\text{ bps/minute}$.
7. Dual AND window expiration (`window_slots >= 150 && time_elapsed >= 60`) prevents slot jitter bypass.
8. Alternating movements execute cleanly across 50 updates without oracle freeze.
9. All 148 workspace tests pass with 0 failures.

**VERDICT: APPROVED.**
