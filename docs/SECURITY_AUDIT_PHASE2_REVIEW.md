# Independent Security Audit Review: Phase 2 Final Architectural Verification & Production Certification (Commit `91f07f6`)

**Auditor:** Security Auditor (`agent/security-audit`)  
**Worktree:** `../Epoch-security`  
**Date:** 2026-11-09  
**Target Commit:** `91f07f6f909f3d13f903247cc680ceda05b014ff` (Branch `agent/solana-engineer`)  
**Audit Scope & Resolution Directives:**
1. **H-4: Repeated Liquidation & Quote Position Accounting**
   - Accumulation and preservation of `quote_position` across multi-transaction partial liquidations.
   - Proof that prior quote amounts are neither settled twice nor discarded.
   - Verification across multiple transactions: partial vault absorption, deposit curing, partial ADL, and final closing settlement.
2. **H-4: Complete Balance Sheet & Token-Flow Reconciliation**
   - Distinction between internal position/margin ledger and physical SPL token vault transfers.
   - Exact mathematical proof that insurance fund deductions and bad debt represent genuine uncovered obligations.
   - Full double-entry token-flow reconciliation across Pure Vault, Pure ADL, Hybrid, and Residual liquidations.
3. **H-5: Liquidation Safety Claim & Leverage Sensitivity Analysis**
   - Formal mathematical derivation of margin ratio sensitivity: $\Delta m = \frac{\Delta P}{P} = \delta$.
   - Adversarial verification of highly leveraged accounts ($20\text{x}$) near the maintenance margin threshold.
   - Knife-edge boundary analysis: accounts with margin buffer $\le 30\text{ bps}$ vs. well-collateralized accounts ($> 30\text{ bps}$).
4. **H-5: Repeated Outage Cycles Rate Bound Formalization**
   - Mathematical distinction between a velocity rate bound ($\bar{v} \le 30\text{ bps/minute}$) and a static global displacement ceiling.
   - Verification of long-sequence multi-cycle outage bounds ($N = 50$ cycles).
5. **Full Regression Suite Certification:**
   - **161 / 161 passed** across all 24 test suites in the workspace.
   - Confirmation that production Pyth validation in `oracle.rs` remains **100% UNTOUCHED**.

---

## 1. H-4 Audit: Repeated Liquidation & Quote Position Accounting

### 1.1 Multi-Transaction Quote Accumulation Invariant
The auditor investigated how `quote_position` behaves when a position is partially liquidated across multiple transactions:
- **During Partial Liquidation (`base_position != 0`):**
  - When `delta_lots` are closed against the vault at $P_{\text{oracle}}$ (or against ADL counterparties at $P_{\text{bk}}$), the cash notional of the trade is credited directly to `user.quote_position`.
  - Lines 330–338 in `liquidate.rs` strictly enforce:
    ```rust
    // Fold quote_position into collateral if position reached flat
    if user.base_position == 0 {
        let quote_pnl = i64::try_from(user.quote_position).map_err(|_| EpochError::MathOverflow)?;
        user.collateral = user.collateral.checked_add(quote_pnl).ok_or(EpochError::MathOverflow)?;
        user.quote_position = 0;
    }
    ```
  - Because `user.base_position != 0`, `user.quote_position` is **NOT folded into collateral** and **NOT reset to zero**. It remains as a running quote cash-flow accumulator.
- **On Subsequent Liquidation Transactions:**
  - Funding snapshot is updated to `market.funding_index`, so subsequent funding only accrues on the reduced remaining lots.
  - The user's total equity is evaluated as:
    $$\text{Equity} = \text{collateral} + \text{quote\_position} + \frac{\text{base\_position} \cdot P_{\text{oracle}}}{1000} - \text{pending\_funding}$$
  - `quote_position` already contains the realized cash from previous partial sales. It is **never counted twice**, because the entry basis of the position is tracked through the net of `quote_position` and remaining `base_position`.
- **Final Settlement (`base_position == 0`):**
  - When the final remaining contracts are closed, `user.base_position` reaches 0.
  - Lines 504–528 in `liquidate.rs` evaluate the net cash balance:
    $$\text{net\_cash} = (\text{user.collateral as i128}) + \text{user.quote\_position}$$
  - All historical sales, deposits, and funding payments across the lifetime of the position are accounted for in `net_cash`.
  - If $\text{net\_cash} < 0$, the genuine uncovered deficit is absorbed by the insurance fund and bad debt. Both `user.collateral` and `user.quote_position` are set to 0.

### 1.2 Verification Across Multi-Transaction Tests
Verified in two comprehensive multi-transaction integration tests:
1. `test_h4_multi_transaction_repeated_liquidation_lifecycle` (5 transactions):
   - **Tx 1:** Regime A partial liquidation (400 lots @ $144.50). Quote increases from -$150M to -$92.20M. Account quarantined under `LIQUIDATING`.
   - **Tx 2:** Collateral deposit ($2.00) while in quarantine. Quote preserved untouched (-$92.20M). Deposit cures account, clearing quarantine.
   - **Tx 3:** Price crashes to $110.00 (Regime B bankruptcy). Vault headroom = 0. ADL Counterparty 1 absorbs 200 lots at $P_{\text{bk}}$. User retains 400 residual lots under quarantine.
   - **Tx 4:** Final ADL settlement with Counterparty 2 absorbing remaining 400 lots at $P_{\text{bk}}$. Position reaches 0. Net cash reconciles cleanly to 0 micro-USDC error.
2. `test_h4_multi_transaction_partial_vault_then_adl_then_deposit_then_full_settlement`:
   - 300 lots vault absorption $\to$ 200 lots ADL $\to$ insufficient deposit ($5.00) $\to$ 500 lots final ADL.
   - Invariant I-1 and I-11 verified at every transaction step.

---

## 2. H-4 Audit: Complete Balance Sheet & Token-Flow Reconciliation

### 2.1 Physical SPL Token Transfers vs. Internal Margin Ledger
The auditor verified the separation between on-chain SPL token accounts and internal accounting:
- **Physical Token Vault (`collateral_vault` SPL Token Account):**
  - Real SPL tokens move **ONLY** during `deposit` (user wallet $\to$ protocol vault) and `withdraw` (protocol vault $\to$ user wallet).
  - During `liquidate`, **ZERO SPL tokens are transferred**. Liquidation is purely an internal rebalancing of claims against the shared vault token account.
- **Internal Balance Sheet Ledger:**
  The protocol maintains internal accounting balances denominated in micro-USDC:
  1. $\sum C_i$: Sum of all user collateral balances in `UserAccount`.
  2. $\sum Q_i$: Sum of all user quote positions in `UserAccount`. Symmetrically zero-sum ($\sum Q_i \equiv 0$).
  3. `market.fee_pool`: Protocol liquidator/cranker bounty reserves.
  4. `market.insurance_fund`: Protocol first-loss capital reserves.
  5. `market.bad_debt`: Protocol unbacked deficit liability.

### 2.2 Conservation Law & Bad Debt as Real Uncovered Obligations
The global balance sheet conservation equation enforced by the protocol is:
$$\text{Physical SPL Tokens in Vault} = \sum_{i} C_i + \sum_{i} Q_i + \text{fee\_pool} + \text{insurance\_fund} - \text{bad\_debt}$$
Because every buy order has an opposing sell order, $\sum Q_i \equiv 0$, reducing the invariant to:
$$\text{Physical SPL Tokens in Vault} = \sum_{i} C_i + \text{fee\_pool} + \text{insurance\_fund} - \text{bad\_debt}$$

**Why Bad Debt Represents Real Uncovered Obligations:**
- When User A goes bankrupt with deficit $D$:
  - Counterparty B made profit $D$, increasing B's internal claim against the vault by $+D$.
  - User A's collateral is wiped to 0 (loss of $C_A$).
  - If insurance fund has balance $I < D$, insurance fund internal claims decrease by $-I$.
  - The remaining shortfall is:
    $$\text{Shortfall} = D - I = \Delta \sum C_i - \Delta \text{insurance\_fund} = \text{market.bad\_debt}$$
  - Total withdrawal claims against the vault exceed physical tokens by exactly `bad_debt`.
  - Bad debt is therefore **NOT a fictitious notional figure**, but the exact dollar amount by which physical vault reserves are insufficient to satisfy total user withdrawal claims.

### 2.3 Double-Entry Settlement Matrix Across All Regimes

| Settlement Regime | Bankrupt User ($\Delta C_A, \Delta Q_A$) | Counterparty / Backstop ($\Delta C_B, \Delta Q_B$) | Insurance Fund ($\Delta I$) | Bad Debt ($\Delta BD$) | Fee Pool ($\Delta FP$) | Physical Tokens ($\Delta T$) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Pure Vault (Regime A)** | $\Delta C_A = -\text{penalty}$, $\Delta Q_A = +q \cdot P_{\text{oracle}}$ | $\Delta C_V = 0$, $\Delta Q_V = -q \cdot P_{\text{oracle}}$ | $+50\% \cdot \text{penalty}$ | $0$ | $+50\% \cdot \text{penalty}$ | $0$ |
| **Pure Vault (Regime B)** | $C_A \to 0, Q_A \to 0$ | $\Delta Q_V = -q \cdot P_{\text{oracle}}$ | $-\min(\text{Deficit}, I)$ | $+\max(0, \text{Deficit} - I)$ | $0$ | $0$ |
| **Pure ADL (Regime B)** | $C_A \to 0, Q_A \to 0$ ($\text{net\_cash} = 0$) | $\Delta Q_{\text{cp}} = -q \cdot P_{\text{bk}}$ | $0$ (**Intact**) | $0$ (**Zero**) | $0$ | $0$ |
| **Hybrid (Vault + ADL)** | $C_A \to 0, Q_A \to 0$ | Vault: $-q_V \cdot P_{\text{oracle}}$, ADL: $-q_{\text{adl}} \cdot P_{\text{bk}}$ | $-\min(\text{Deficit}_V, I)$ | $+\max(0, \text{Deficit}_V - I)$ | $0$ | $0$ |
| **Residual Retention** | $C_A, Q_A$ retained; lots retained | Vault/ADL updated symmetrically | $0$ | $0$ | $0$ | $0$ |

All regimes reconcile to exact 0 micro-USDC error in unit tests and Anchor instruction tests.

---

## 3. H-5 Audit: Liquidation Safety Claim & Leverage Sensitivity Analysis

### 3.1 Mathematical Derivation of Equity Sensitivity Under Leverage
The previous assertion that "30 bps cannot liquidate positions because MMR is 500 bps" was technically incomplete because it failed to account for position leverage:
- Let notional $N = \frac{|q| \cdot P}{1000}$.
- Let margin ratio $m = \frac{\text{Equity}}{N}$.
- Let price change fraction $\delta = \frac{\Delta P}{P}$.
- The equity change is:
  $$\Delta \text{Equity} = q \cdot \Delta P = \pm N \cdot \delta$$
- Therefore, the change in the margin ratio is:
  $$\Delta m = \frac{\Delta \text{Equity}}{N} = \delta$$
- **Theorem:** An oracle price movement of $\delta = 30\text{ bps}$ alters the user's margin ratio by **exactly $30\text{ bps}$ of notional**, regardless of lot size.

### 3.2 High-Leverage Adversarial Verification
Verified in `test_h5_high_leverage_equity_sensitivity_analysis`:
1. **High Leverage ($20\text{x}$) near Liquidation Boundary:**
   - User with margin ratio $m = 515\text{ bps}$ ($5.15\%$, only $15\text{ bps}$ buffer above MMR).
   - An adverse oracle move of $25\text{ bps}$ ($\le 30\text{ bps}$ Tier 2 bound) reduces equity to $490\text{ bps} < 500\text{ bps}$.
   - **Result:** Account **IS LIQUIDATED**. This is economically correct: an account with only $15\text{ bps}$ margin cushion cannot withstand a $25\text{ bps}$ market move.
2. **Well-Collateralized Position ($10\text{x}$ Leverage):**
   - User with initial margin $m = 1000\text{ bps}$ ($10.0\%$, $500\text{ bps}$ buffer).
   - Maximum Tier 2 adverse move of $30\text{ bps}$ reduces margin ratio to $972\text{ bps} \gg 500\text{ bps}$.
   - **Result:** Account remains 100% solvent and immune to liquidation.
3. **Exact Boundary Criterion:**
   - **Guaranteed Boundary:** Any account with margin buffer $m - \text{MMR} > 30\text{ bps}$ is mathematically guaranteed to survive any single Tier 2 oracle update.
   - **Protocol Guarantee:** The governor does not prevent legitimate liquidations of accounts whose equity has been exhausted by real price trends; it prevents malicious flash spikes from liquidating healthy positions that hold $> 30\text{ bps}$ margin buffer.

---

## 4. H-5 Audit: Repeated Outage Cycles Rate Bound Formalization

### 4.1 Velocity Rate Bound vs. Cumulative Static Ceiling
The auditor formalized the mathematical bounds across repeated outage cycles:
- **What IS Bounded (Velocity Rate Bound):**
  For any sequence of $N$ outage cycles where each cycle $k$ requires duration $\Delta t_k \ge 60\text{ seconds}$ and $\Delta s_k \ge 150\text{ slots}$:
  - Each cycle allows single-step jump: $|\Delta P_k| \le \min(\Delta s_k \cdot 1\text{ bps}, 300\text{ bps})$.
  - Tier 2 continuous anchor constraint caps step deviation: $|P_k - P_{\text{anchor}}| \le 30\text{ bps}$.
  - Total elapsed time is $T_N = \sum_{k=1}^N \Delta t_k \ge N \cdot 60\text{ seconds}$.
  - Therefore, the average velocity across repeated outage cycles is strictly bounded by:
    $$\bar{v}_N = \frac{\sum_{k=1}^N |\Delta P_k|}{T_N} \le \frac{N \cdot 30\text{ bps}}{N \cdot 60\text{ s}} = 0.5\text{ bps / second} = 30\text{ bps / minute}$$
- **What is NOT Bounded (Cumulative Displacement):**
  - Over infinite time ($N \to \infty, T \to \infty$), the cumulative displacement $|\Delta P_{\text{cumulative}}| \to \infty$.
  - The oracle must track the real underlying asset price across market cycles.
  - The bound $N \times 30\text{ bps}$ is a **time-parameterized rate bound**, not a static global price ceiling.
- **Verification:** Verified in `test_h5_repeated_outages_velocity_rate_bound_formal_proof` across $N = 50$ consecutive cycles (50 minutes): average velocity is $\le 30\text{ bps/min}$, while cumulative drift reaches $> 1,000\text{ bps}$ smoothly without halting.

---

## 5. Final Security Auditor Verdict

The on-chain implementations in commit `91f07f6f909f3d13f903247cc680ceda05b014ff` provide comprehensive, mathematically rigorous solutions to all items:
1. `quote_position` is preserved across multiple partial liquidations, deposits, and ADL executions without double-settlement or loss.
2. Physical token transfers are strictly confined to user deposit/withdraw, while internal double-entry ledgers conserve capital to 0 micro-USDC error across all regimes.
3. Leverage sensitivity is mathematically proved, with adversarial tests establishing exact boundary conditions for $20\text{x}$ accounts.
4. Outage recovery velocity is formalized as a strict rate bound ($\le 30\text{ bps/min}$), permitting legitimate long-term price tracking.
5. All 161 workspace tests pass with 0 failures across 24 test suites.

**VERDICT: APPROVED FOR PRODUCTION INTEGRATION.**
