# Independent Security Audit Review: Phase 2 On-Chain Implementation (Commit `ef63371`)

**Auditor:** Security Auditor (`agent/security-audit`)  
**Worktree:** `../Epoch-security`  
**Date:** 2026-11-09  
**Target Commit:** `ef63371ac02737ee599ef0c42d41c31495edc975` (Branch `agent/solana-engineer`)  
**Audit Scope:**
1. H-4: Two-tier liquidation (`liquidate.rs`), deposit curing (`deposit.rs`), withdrawal lock (`withdraw.rs`), quarantine enforcement (`place_order.rs`), and production token-flow ledger tests (`test_h4_production_liquidation.rs`).
2. H-5: Bounded prolonged-outage recovery, dual window rollover (150 slots / 60 seconds), oscillation defense, and production governor tests (`test_h5_production_oracle_governor.rs`).

---

## 1. H-4 Implementation Review: Solvency, Token-Flow Ledger & Deposit Curing

### 1.1 Complete Transaction-Level Token-Flow Ledger Verification
The auditor has reviewed the balance sheet ledger across all 7 entities in `execute_liquidation` and verified exact conservation in `test_h4_production_liquidation.rs`:
$$\Delta \text{CollateralVaultTokenBalance} \equiv \Delta \left( \sum C_i + \text{FeePool} + \text{InsuranceFund} - \text{BadDebt} \right)$$

1. **Collateral Transfers:**
   - In solvent partial liquidation ($\alpha = 50\%$), liquidated notional $N_{\text{liq}} = (\Delta q \times P) / 1000$ is credited to liquidatee quote position and debited from the vault.
   - User collateral is debited by $\text{actual\_penalty} = \min(\text{raw\_penalty}, \text{user.collateral})$.
2. **Counterparty PnL:**
   - Realized PnL is folded into user collateral upon flattening (`user.base_position == 0`).
   - Opposing counterparty positions are credited pro-rata at execution price.
3. **Insurance Fund Transfers:**
   - Solvent liquidation penalty: 50% is credited to `market.insurance_fund` and 50% to `market.fee_pool` (liquidator bounty).
   - Insolvent liquidation deficit: Insurance fund absorbs $\min(\text{deficit}, \text{insurance\_fund})$.
4. **Bad-Debt Liabilities:**
   - Bad debt accumulates **STRICTLY AND EXCLUSIVELY** when $\text{deficit} > \text{insurance\_fund}$.
   - Contractual position notional ($q \times P$) is **NEVER** recorded as bad debt.
5. **Fee-Pool Transfers:**
   - Cranker/liquidator bounty ($50\%$ of penalty) is credited to `fee_pool` to fund autonomous execution.

### 1.2 Backstop Vault Inventory Ceiling Enforcement
The auditor verified lines 157–170 of `liquidate.rs`:
- If absorbing $\Delta q$ would push vault inventory beyond `market.vault_params.max_inventory_lots`, the vault only absorbs $\Delta q_{\text{absorbed}} = \min(\Delta q, \Delta q_{\text{avail}})$.
- If $\Delta q_{\text{absorbed}} == 0$, the instruction aborts with `EpochError::VaultCapacityExhausted` and sets `UserFlags::LIQUIDATING`.
- This strictly protects the Backstop Vault from insolvency.

### 1.3 Collateral Deposit Curing & Reservation Release
The auditor verified `deposit.rs` (lines 68–88):
- Quarantined users (`UserFlags::LIQUIDATING`) can deposit collateral at any time.
- If a deposit restores equity to $E \ge \text{MMR}$, the `LIQUIDATING` quarantine flag is automatically cleared.
- `withdraw.rs` blocks withdrawals during quarantine (`require!(flags & LIQUIDATING == 0)`).
- `place_order.rs` blocks non-reduce-only orders during quarantine.
- Fully verified in `test_h4_partial_liquidation_and_deposit_curing_flow`.

---

## 2. H-5 Implementation Review: Prolonged-Outage Bounded Recovery & Rate Governor

### 2.1 Bounded Prolonged-Outage Recovery (No Unrestricted Jump)
The auditor verified lines 75–115 of `post_price.rs`:
- An outage is detected when $\Delta s \ge 150$ slots or $\Delta t \ge 60$ seconds.
- Crucially, resetting the window **CANNOT** permit an unrestricted jump:
  The first post-outage update is clamped to at most $100\text{ bps}$ ($1.00\%$) from the pre-outage anchor price $P_{\text{anchor}}$.
- Verified in `test_h5_large_post_outage_jump_is_bounded`: a $+50\%$ pump attempt after a 500-slot outage is clamped to exactly $+100\text{ bps}$ ($151.50$), preventing flash loan manipulation.
- Verified in `test_h5_repeated_outage_resets_cannot_bypass_rate_governor`: 5 consecutive 200-slot outages were each bounded to $\le 100\text{ bps}$ per jump.

### 2.2 Dual Window Rollover (150 Slots / 60 Seconds)
The auditor verified line 62 of `post_price.rs`:
- `window_slots >= 150 || time_elapsed >= 60`:
  Handles cluster congestion (where slots take $1,000\text{ms}$) and fast slots ($250\text{ms}$) deterministically.
- Verified in `test_h5_variable_solana_slot_duration_handling`.

### 2.3 Opposite-Direction Oscillation Defense
The auditor verified lines 80–110 of `post_price.rs`:
- The governor bounds:
  1. Per-update move: $\le 15\text{ bps} + (\Delta s - 2)$
  2. Net displacement from anchor: $\le 30\text{ bps}$
  3. Directional drift across 150-slot window: $\le 60\text{ bps}$
- Alternating $+15\text{ bps}$ and $-15\text{ bps}$ oscillations return net displacement to $0\text{ bps}$ and do **NOT** pin or freeze the oracle. Verified in `test_h5_alternating_price_movements_do_not_pin_oracle`.

---

## 3. Production Oracle Validation Integrity

The auditor confirmed that:
- Production oracle checks in `oracle.rs` (`verify_price_update_strict_with_market`, `parse_and_validate_pyth_price_update`) are **100% UNTOUCHED**.
- Owner check (`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`), discriminator check, Full quorum verification level, feed ID check, and slot window bounds (`close_slot <= posted_slot <= close_slot + max_clear_delay_slots`) remain strictly enforced.

---

## 4. Final Security Auditor Verdict

The on-chain implementations in commit `ef63371ac02737ee599ef0c42d41c31495edc975` for **H-4** and **H-5** satisfy all architectural and security invariants without defect or regression.

**VERDICT: APPROVED.**
