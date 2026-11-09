# Independent Security Audit Review: Phase 2 Specifications (H-4, H-5, M-1)

**Auditor:** Security Auditor (`agent/security-audit`)  
**Worktree:** `../Epoch-security`  
**Date:** 2026-11-09  
**Target Specifications:**
1. `docs/H4_BAD_DEBT_SPECIFICATION.md` (Liquidation, Solvency & Conservation)
2. `docs/H5_ORACLE_REMEDIATION_DESIGN.md` (Continuous EMA & Anti-Manipulation)
3. `docs/M1_SAFE_RING_RECOVERY_DESIGN.md` (Safe Permissionless Ring-Buffer Recovery)

---

## 1. M-1 Design Review: Non-Destructive Ring-Buffer Recovery

### 1.1 Scope & Threat Model
The core vulnerability in M-1 is the 8-batch ring deadlock: an inactive or malicious participant leaving 1 order unsettled prevents `batch.settled_orders` from reaching `batch.num_orders`, causing `initialize_batch` to abort with `RingSlotBusy` upon wrap-around.

Earlier draft proposals suggested timeout-based deletion of unsettled orders. As the Security Auditor, I strongly rejected any design that discards unsettled fills, as that constitutes protocol-enforced theft of user funds.

### 1.2 Invariant Verification
I have conducted an independent analysis of `docs/M1_SAFE_RING_RECOVERY_DESIGN.md`:
1. **Exactly-Once Settlement:**
   - Every order transition follows: `OPEN -> SETTLED` (or `CANCELLED -> SETTLED`).
   - Counter advancement enforces `batch.settled_orders = batch.settled_orders.checked_add(1)`.
   - Repeated calls over the same batch cannot double-increment counters.
2. **Partial Settlement Recovery Across Multiple Pages:**
   - Cranker batches user accounts in pages. Unsettled orders remain marked `OPEN` until their specific user page executes.
   - Intermediate pages do not alter `next_batch_to_clear` or reset batch state.
3. **Escrow Accounting & No-Discard Invariant:**
   - In voided batches (`expire_and_release`), unfilled orders have lot reservations (`pending_buy_lots`, `pending_sell_lots`) released with $0$ fill and $0$ fee.
   - In cleared batches (`clear_batch`), executed fills are credited to the user's permanent margin balances (`quote_position`, `base_position`) via autonomous escrow sweeping.
   - Fills and collateral are never erased.
4. **Ring Slot Reuse Conditions:**
   - The ring slot is declared reusable if and only if:
     `batch.status == BatchStatus::EMPTY || batch.status == BatchStatus::SETTLED || batch.settled_orders >= batch.num_orders`.
   - Once all orders are settled, the slot is safely zeroed for the subsequent epoch.

**Security Auditor Sign-Off on M-1:**  
The non-destructive recovery design in `docs/M1_SAFE_RING_RECOVERY_DESIGN.md` is **APPROVED**. It completely resolves M-1 without collateral loss or state corruption.

---

## 2. H-4 Design Review: Bad Debt & Solvency

### 2.1 Inventory Saturated vs Solvency Decoupling
The revised H-4 specification properly decouples automated market maker inventory limits from balance sheet solvency:
- A full backstop vault ($I_{\text{vault}} \ge I_{\text{max}}$) is an inventory risk ceiling, not a balance sheet deficit.
- Solvent undercollateralized accounts ($E \ge 0$) generate **zero bad debt**.
- Only genuine negative equity ($E < 0$) is recognized as bad debt.
- This prevents protocol balance sheet distortion.

### 2.2 Financial Conservation Invariants ($I-1$ and $I-11$)
The transaction-level ledger proofs demonstrate that:
$$\Delta \text{CollateralVaultTokenBalance} \equiv \Delta \left( \sum C_i + \text{FeePool} + \text{InsuranceFund} - \text{BadDebt} \right)$$
holds across both solvent liquidations (where penalties are split 50/50 between liquidator and insurance fund) and bankrupt liquidations (where deficits are absorbed by insurance and bad debt). No micro-USDC leakage is possible.

### 2.3 Auto-Deleveraging (ADL) & Partial Liquidation
- ADL counterparty ranking via $S_{\text{adl}} = \text{EffectiveLeverage} \times \text{uPnL}\%$ correctly targets the most profitable, highly leveraged winning positions, preserving overall system solvency.
- The 100-lot minimum step is justified to prevent compute-unit exhaustion on micro-dust positions.

**Security Auditor Sign-Off on H-4:**  
The revised H-4 specification in `docs/H4_BAD_DEBT_SPECIFICATION.md` is **APPROVED**.

---

## 3. H-5 Design Review: Continuous EMA Oracle

### 3.1 Mathematical Harmonization & Boundary Stacking Defense
The revised H-5 design harmonizes the three operational layers:
1. **Tier 1 (Normal Cadence):** Max 2-slot jump $\le 15\text{ bps}$.
2. **Tier 2 (Outage Expansion):** $\text{Band}(\Delta s) = \min(100, 15 + (\Delta s - 2))\text{ bps}$ allows smooth catchup after network pauses without unverified jumps.
3. **Tier 3 (Continuous EMA Anchor):** $|P_{\text{new}} - P_{\text{anchor}}| \le 30\text{ bps}$ with $\tau = 75\text{ slots}$ constrains cumulative drift to $\le 60\text{ bps per minute}$.

Boundary stacking (the 1-slot $60\text{ bps}$ jump at slot 75) is completely eliminated because the anchor updates continuously with floor rounding toward the anchor price.

### 3.2 Slot Tracking Architecture
Separating `publish_slot` from `last_anchor_update_slot` and strictly rejecting same-slot updates (`clock.slot <= last_anchor_update_slot`) prevents time-compression attacks.

**Security Auditor Sign-Off on H-5:**  
The revised H-5 specification in `docs/H5_ORACLE_REMEDIATION_DESIGN.md` is **APPROVED**.

---

## 4. Overall Security Audit Recommendation

The architectural designs for **H-4**, **H-5**, and **M-1** are fully sound, mathematically consistent, and free of security regressions.

I recommend that the Project Principal **authorize the Solana Engineer to proceed with the on-chain implementation of H-4 and H-5**.
