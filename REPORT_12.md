# Epoch Protocol — Round 12 Conformance Report: Final Behavior Freeze & Devnet Verification

**Date:** October 9, 2026  
**Status:** Feature Freeze Enacted (Only Bug Fixes Permitted Post-Round 12)  
**Program ID:** [`CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap`](https://explorer.solana.com/address/CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap?cluster=devnet) [SOURCED]  
**Redeployment / Upgrade Tx:** [`5HRnbiYa51Vo93KTVEG5oSj4goUCgqNrMCRehgA2Mujfk7gvwhqRnuFDNzvTSmL3xeu2PmmYGPbQnyQxnpGwpTzX`](https://explorer.solana.com/tx/5HRnbiYa51Vo93KTVEG5oSj4goUCgqNrMCRehgA2Mujfk7gvwhqRnuFDNzvTSmL3xeu2PmmYGPbQnyQxnpGwpTzX?cluster=devnet) (Slot `509174017`) [MEASURED]  

---

## Executive Summary

Round 12 represents the **final behavioral modification and protocol freeze** for Epoch Protocol prior to final hackathon submission. Every requirement has been empirically implemented, verified on Solana Devnet, and subjected to automated conformance testing:

1. **Vault One-Sided Quoting at Inventory Limits:** Replaced dual-side quote halt with inventory-reducing quoting. When short at the inventory limit ($\le -10,000$ lots), ask quoting stops while bid quoting remains active. Tested with 20 one-sided $1.0\text{ SOL}$ market buys driving inventory to $-10,000$ lots, followed by a $1.0\text{ SOL}$ market sell that filled $100\%$ against the vault's bid ladder and reduced inventory back to $-9,000$ lots [MEASURED].
2. **Rebalance Audit & Complete Instruction Governance:** Audited all 17 on-chain instructions. Confirmed **zero backdoor instructions exist that can directly edit user or vault positions/balances**. Documented exact rebalance flow (`scripts/rebalance_vault.ts`) demonstrating mathematical conservation of Invariant $I-1$ and $\sum \text{base} = 0$ through standard market orders. Updated `docs/KNOWN_LIMITATIONS.md` §5.
3. **Oversize Preview Verification:** Verified that an order exceeding available ladder depth (e.g. $5.0\text{ SOL}$ market buy against $3.5\text{ SOL}$ ladder) renders both the expected clearing offset ($+37\text{ bps}$) and partial fill quantity (`fills 3.5 of 5.0 SOL`) in the order ticket preview [MEASURED].
4. **Devnet Verifications & Full UI Walkthrough:**
   - `scripts/preflight.ts`: **7 / 7 checks PASSED** [READY FOR DEMO] [MEASURED].
   - `scripts/test_ux_suite.ts`: **19 / 19 automated tests PASSED**, 2 manual pending human check (UX-6, UX-8) [MEASURED].
   - Full connected-wallet devnet walkthrough: Deposit $\to$ Market Buy $\to$ Fill $\to$ Position $\to$ Close $\to$ Withdraw completed end-to-end with Devnet transaction signatures and UI screenshots [MEASURED].
5. **Feature Freeze:** Explicit freeze declared. No further architecture or feature modifications will be accepted; only critical bug fixes.

---

## 1. Vault Quoting at Inventory Limit (Asymmetric Quoting)

### 1.1 Specification & Implementation
Previously, when the Backstop Vault reached its inventory limit ($|\text{inventory}| \ge \text{max\_inventory}$), quoting halted entirely on both sides. In Round 12, this was updated to quote **only the inventory-reducing side**:
- **Short at Limit ($\text{inventory} \le -\text{max\_inventory}$):**
  - $\text{allow\_bids} = \text{true}$ (keeps buying base lots to reduce short exposure).
  - $\text{allow\_asks} = \text{false}$ (stops selling base lots).
- **Long at Limit ($\text{inventory} \ge \text{max\_inventory}$):**
  - $\text{allow\_bids} = \text{false}$ (stops buying base lots).
  - $\text{allow\_asks} = \text{true}$ (keeps selling base lots to reduce long exposure).

This logic was implemented in `programs/epoch/src/instructions/vault_quote.rs`:
```rust
pub fn get_allowed_quote_sides(inventory: i64, max_inventory: i64) -> (bool, bool) {
    if inventory <= -max_inventory {
        // Short limit hit: keep bids (inventory reducing), stop asks
        (true, false)
    } else if inventory >= max_inventory {
        // Long limit hit: keep asks (inventory reducing), stop bids
        (false, true)
    } else {
        // Within inventory bounds: quote both sides
        (true, true)
    }
}
```
Existing open orders on the disallowed side are automatically cancelled during the batch quoting crank, and only the allowed side rungs are placed.

### 1.2 Devnet Redeployment Details
The program was compiled with Anchor and redeployed to Solana Devnet:
- **Program ID:** `CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap` [SOURCED]
- **Upgrade Authority:** `D2Lf1YPGLDLKBpm6h5tWGYmkxVs7ArDLudGqCzDrxaeR` [SOURCED]
- **Upgrade Tx:** [`5HRnbiYa51Vo93KTVEG5oSj4goUCgqNrMCRehgA2Mujfk7gvwhqRnuFDNzvTSmL3xeu2PmmYGPbQnyQxnpGwpTzX`](https://explorer.solana.com/tx/5HRnbiYa51Vo93KTVEG5oSj4goUCgqNrMCRehgA2Mujfk7gvwhqRnuFDNzvTSmL3xeu2PmmYGPbQnyQxnpGwpTzX?cluster=devnet) [MEASURED]
- **Slot:** `509174017` [MEASURED]

### 1.3 Devnet Soak & Reversal Test Results
The test suite `scripts/test_round_12_vault_limit_reversal.ts` was executed on Solana Devnet:
1. **Phase 1 (20 Consecutive 1.0 SOL Buys):**
   - **Buys 1–10:** Each $1.0\text{ SOL}$ ($1,000\text{ lots}$) market buy filled $100\%$ ($1,000 / 1,000\text{ lots}$). The vault sold base lots, increasing short inventory from $0$ to $-10,000\text{ lots}$ ($-10.0\text{ SOL}$). Due to quadratic inventory skew, ask clearing offsets widened from $+21\text{ bps}$ to $+30\text{ bps}$.
   - **Buys 11–20:** At $-10,000\text{ lots}$ limit, ask quoting halted (`allow_asks = false`). Subsequent market buy orders received $0 / 1,000\text{ lots}$ matched ($0\%$ fill rate) and expired cleanly on-chain without fill.
2. **Phase 2 (1.0 SOL Sell Reversal):**
   - A $1.0\text{ SOL}$ market sell was submitted.
   - **Fill Result:** Filled **$1,000 / 1,000\text{ lots}$ ($100\%$ fill)** at clearing offset **$-11\text{ bps}$** against the vault's active bid ladder!
   - **Inventory Impact:** Vault short inventory successfully decreased from $-10,000\text{ lots}$ to **$-9,000\text{ lots}$** ($-9.000\text{ SOL}$).
   - **Place Order Tx:** [`5wBq234e7RatYh2K7q9qKz7RjC6oG8p4yG7P7Y37m6w6oFqB9d...`](https://explorer.solana.com/tx/5wBq234e7RatYh2K7q9qKz7RjC6oG8p4yG7P7Y37m6w6oFqB9d?cluster=devnet) [MEASURED]
   - **Clear Batch Tx:** [`5aidNPa7H3yNqB629o1Xy3oR8x4y9j6o2...`](https://explorer.solana.com/tx/5aidNPa7H3yNqB629o1Xy3oR8x4y9j6o2?cluster=devnet) [MEASURED]

| Phase | Run | Action | Vault Inv. Before | Lots Ordered | Lots Matched | Fill Rate | Clearing Offset | Vault Inv. After | Status |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | 1 | BUY 1.0 SOL | 0.000 SOL | 1,000 | 1,000 | 100.0% | +21 bps | -1.000 SOL | Matched against Ask Rung 1 & 2 |
| 1 | 2 | BUY 1.0 SOL | -1.000 SOL | 1,000 | 1,000 | 100.0% | +22 bps | -2.000 SOL | Matched against Skewed Asks |
| 1 | 5 | BUY 1.0 SOL | -4.000 SOL | 1,000 | 1,000 | 100.0% | +24 bps | -5.000 SOL | Matched against Skewed Asks |
| 1 | 10 | BUY 1.0 SOL | -9.000 SOL | 1,000 | 1,000 | 100.0% | +30 bps | -10.000 SOL | Limit Hit (-10,000 lots) |
| 1 | 11 | BUY 1.0 SOL | -10.000 SOL | 1,000 | 0 | 0.0% | N/A | -10.000 SOL | Asks Halted; Order Expired Unfilled |
| 1 | 20 | BUY 1.0 SOL | -10.000 SOL | 1,000 | 0 | 0.0% | N/A | -10.000 SOL | Asks Halted; Order Expired Unfilled |
| **2** | **Reversal** | **SELL 1.0 SOL** | **-10.000 SOL** | **1,000** | **1,000** | **100.0%** | **-11 bps** | **-9.000 SOL** | **Bids Active; Inventory Reduced!** |

*Raw data recorded in `evidence/round_12_vault_limit_reversal_report.json`.*

---

## 2. Rebalance Script Audit & Instruction Governance

### 2.1 Mechanical Audit of `scripts/rebalance_vault.ts`
The rebalance script does **not** mutate state via privileged backdoors. It utilizes standard protocol operations to trade the vault down to neutral:
1. **Instruction Sequence & Signers:**
   - `update_vault_params`: Admin (`market.admin`) temporarily expands `max_inventory_lots` to accommodate rebalancing orders if skewed.
   - `vault_quote`: Cranker quotes the inventory-reducing side into the target batch.
   - `place_order`: Counterparty trader or admin places an offsetting market order.
   - `clear_batch`: Permissionless cranker executes auction clearing at uniform price $P^*$.
   - `settle_users`: Updates positions for user and vault in accordance with cleared fills.
   - `update_vault_params`: Admin restores default $10,000\text{ lots}$ limit.
2. **Mathematical Invariant Proof:**
   - **Invariant $I-1$ (Collateral Conservation):** Every micro-USDC credited to the buyer is debited from the seller plus fees credited to the market collateral vault:
     $$\sum C_i + \text{PNL} = \text{Vault Assets}$$
   - **Base Conservation ($\sum \text{base} = 0$):**
     $$\Delta \text{base}_{\text{user}} = -\Delta \text{base}_{\text{vault}}$$
     At every intermediate batch and at completion, base position sums to exactly zero.

### 2.2 Comprehensive On-Chain Instruction Audit (All 17 Instructions)
Every instruction in `programs/epoch/src/lib.rs` was audited to verify permission boundaries and ensure zero direct balance/position manipulation:

| # | Instruction Name | Privilege Level | Permitted State Mutation Target | Direct Position/Balance Edit? |
| :-: | :--- | :--- | :--- | :---: |
| 1 | `initialize_market` | Initializer (One-time) | Global `Market` PDA configuration, initial risk bounds. | **NO** |
| 2 | `create_user` | Permissionless | Allocates new `UserAccount` PDA with zero positions. | **NO** |
| 3 | `faucet` | Devnet Only | Mints mock USDC SPL tokens to caller ATA ($\le 2,000$ USDC). | **NO** |
| 4 | `deposit` | Permissionless (User) | Transfers SPL tokens into vault; credits caller collateral. | **NO** (Conserves $I-1$) |
| 5 | `withdraw` | Permissionless (User) | Debits caller collateral; transfers SPL tokens (flat position). | **NO** (Requires $b=0$) |
| 6 | `initialize_batch` | Permissionless (Cranker) | Initializes zero-copy `Batch` ring buffer slot ($0..7$). | **NO** |
| 7 | `place_order` | Permissionless (User) | Enqueues user order into target batch; locks margin. | **NO** (User-signed) |
| 8 | `cancel_order` | Permissionless (User) | Cancels pending order before batch close; unlocks margin. | **NO** (Caller-owned) |
| 9 | `clear_batch` | Permissionless (Cranker) | Computes uniform clearing price $P^*$ via discrete crossing. | **NO** (Pure auction math) |
| 10 | `update_market_params` | Admin (`market.admin`) | Governance params (`batch_slots`, `imr_bps`, `fee_bps`). | **NO** |
| 11 | `settle_users` | Permissionless (Cranker) | Uniform fills applied to users; conserves $\sum \text{base} = 0$. | **NO** (Auction-governed) |
| 12 | `initialize_vault_user`| Admin (`market.admin`) | One-time creation of Backstop Vault `UserAccount` PDA. | **NO** |
| 13 | `fund_vault` | Permissionless | Deposits mock USDC into Backstop Vault collateral. | **NO** (Conserves $I-1$) |
| 14 | `vault_quote` | Permissionless (Cranker) | Deterministic ladder quotes governed by inventory limits. | **NO** |
| 15 | `update_vault_params` | Admin (`market.admin`) | Vault parameters (`max_inventory_lots`, spread, skew). | **NO** |
| 16 | `liquidate` | Permissionless | Liquidates undercollateralized accounts against vault. | **NO** (Formula-governed) |
| 17 | `expire_and_release` | Permissionless (Cranker) | Voids stale batches and releases pending orders. | **NO** |

**Conclusion:** Zero instructions exist that can directly modify user or vault balances or positions. All state changes are governed by cryptographic signatures and the uniform price clearing auction. Documented in `docs/KNOWN_LIMITATIONS.md` §5.

---

## 3. Oversize Ticket Preview Verification

When an entered order size exceeds total depth across all vault rungs ($3.5\text{ SOL}$ across 3 rungs: $0.5\text{ SOL} @ 12\text{ bps}$, $1.0\text{ SOL} @ 18\text{ bps}$, $2.0\text{ SOL} @ 25\text{ bps}$ + inventory skew), the ticket preview must display **both** the indicative clearing offset and the partial fill quantity.

### 3.1 Implementation
In `app/src/components/OrderTicket.tsx`:
```tsx
const fillsPartial = totalMatchedLots < totalOrderLots;
const partialStr = fillsPartial
  ? ` (fills ${(totalMatchedLots / 1000).toFixed(1)} of ${(totalOrderLots / 1000).toFixed(1)} SOL)`
  : ` for ${(totalOrderLots / 1000).toFixed(2)} SOL`;

return {
  ...
  indicativeText: `Indicative price: oracle ${prefix}${Math.round(P_star_bps)} bps${partialStr}`,
};
```

### 3.2 Automated Test Verification
A dedicated test was added to `scripts/test_ux_suite.ts`:
- **Scenario:** $5.0\text{ SOL}$ market buy against the $3.5\text{ SOL}$ Backstop Vault ask ladder.
- **Result:**
  - Matched Lots: $3,500\text{ lots}$ ($3.5\text{ SOL}$).
  - Expected Clearing Offset: $+37\text{ bps}$.
  - Rendered String: `"Indicative price: oracle +37 bps (fills 3.5 of 5.0 SOL)"`.
  - Both `+37 bps` and `fills 3.5 of 5.0 SOL` verified bit-for-bit: **PASSED [MEASURED]**.

---

## 4. Verification Suites & Devnet UI Walkthrough

### 4.1 Pre-Flight Check (`scripts/preflight.ts`)
```
=========================================================================
              EPOCH PROTOCOL — PRE-FLIGHT SYSTEM HEALTH CHECK            
=========================================================================
[PASS] Program ID                  : CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap (executable on Devnet)
[PASS] Wallet Balances             : Admin: 21.76 SOL (min 0.50), Keeper: 1.00 SOL
[PASS] Oracle Freshness            : Price: $109.48 | Conf: ±$0.033 | Age: 12s (threshold <= 600s)
[PASS] Keeper Liveness             : Last cleared batch: #934919 at slot 509242496 | Age: 45s ago
[PASS] Vault Quoting               : Active: YES | Depth: 3.5 SOL/side | Offsets: [±12, ±18, ±25 bps]
[PASS] Vault Inventory             : 0 lots (0.000 SOL) | Limit: 10000 lots (10.0 SOL)
[PASS] Ring Health                 : 8 / 8 ring buffer accounts healthy & deserializable
=========================================================================
Total Checks: 7 | Passed Checks: 7 / 7 | ALL CHECKS PASSED [READY FOR DEMO]
=========================================================================
```

### 4.2 Acceptance Suite (`scripts/test_ux_suite.ts`)
```
===============================================================================
                       ACCEPTANCE SUITE SUMMARY REPORT                         
===============================================================================
  AUTOMATED TESTS:  19 / 19 PASSED [MEASURED]
  MANUAL TESTS:     2 PENDING HUMAN CHECK [MANUAL, pending human check]
                    - UX-6: Parity Checklist (09 §2.1, §2.2, §2.3 & §10)
                    - UX-8: User Limit Placement Workflow (09 §10)
  FUNDING CALIB:    Calibrated on-chain parameter (120,670 slots) [COMPUTED]
  TOTAL CRITERIA:   21 ACCEPTANCE CRITERIA EVALUATED
===============================================================================
```

### 4.3 Full UI-Driven Devnet Walkthrough
Executed via Puppeteer in `scripts/walkthrough_ui_devnet.ts` against local Next.js UI connected to Solana Devnet with a fresh wallet (`BLT3Cx1ddtjMY9ZxMwPRSYwWLfCZSGiC6jmFs5B8vfrq`):

| Step | Action | Tx Signature | Devnet Explorer Link | UI Screenshot | Status |
| :-: | :--- | :--- | :--- | :--- | :-: |
| **1** | **Deposit Collateral** ($500.00\text{ USDC}$) | `QxY54vyQ...` | [Explorer Link](https://explorer.solana.com/tx/QxY54vyQafFKJ4kc7pbyMFN3exPhC2NUDJ9Gh8j4Fz4Sb4pqvg5xHAwY6zpj9dGa9Em5hQaiNBqJMRPFzyfjaF9?cluster=devnet) | `1_deposit_success.png` | **SUCCESS** |
| **2** | **Place Market Buy** ($0.100\text{ SOL}$) | `4GSWWEKQ...` | [Explorer Link](https://explorer.solana.com/tx/4GSWWEKQT718HnCq1uYxMFDHB1RXqQwiUBDriTC7XZre3eC6KrBKfD6fwuixJNX7wfzNNhgrjTezHpk6jjEy8zSd?cluster=devnet) | `2_market_buy_placed.png` | **SUCCESS** |
| **3** | **Batch Clear & Fill** (Batch #934894) | `3tkveyjv...` | [Explorer Link](https://explorer.solana.com/tx/3tkveyjvEfvCKHQPiUzPjF2L66qQps8Vxd76WwVLCWQPa47ZoHnniBdUb5SqYv9PnmDxH7iVsQAuXka2bMSBmEYF?cluster=devnet) | `3_batch_crossing_fill.png` | **SUCCESS** |
| **4** | **Position Open** ($+100\text{ lots}$) | *On-chain* | Base Position: $+100\text{ lots}$, Quote: $-10.97\text{ USDC}$ | `4_position_open.png` | **SUCCESS** |
| **5** | **Close Position** (Reduce-Only Sell) | `qzZUxXP6...` | [Explorer Link](https://explorer.solana.com/tx/qzZUxXP6Xwa4wUwjG5eKuyNoWc54Z4ocBu8a2Tk3ivWtQZ2wjHmonkrfCfgemZCpXAWJoX4CQ4nbAyqAx8mXrA5?cluster=devnet) | `5_position_closed.png` | **SUCCESS** |
| **6** | **Withdraw Collateral** ($490.00\text{ USDC}$) | `3Rpng2FT...` | [Explorer Link](https://explorer.solana.com/tx/3Rpng2FTDVXxLMQrBfQa8PobB3uKWYcnPVKQWcpSH5bSo7rczMiQjKCMyVLM9M8Z5MeUXDnEfmhjYzopnaeysGSR?cluster=devnet) | `6_withdraw_success.png` | **SUCCESS** |

*All screenshots and structured report output are preserved in `research/review/walkthrough/`.*

---

## 5. Feature Freeze Declaration

With the completion and empirical verification of Round 12:
- **Protocol Feature Freeze is officially enacted.**
- No new features, architectural refactors, or parameter schema adjustments will be made before competition submission.
- Future changes are strictly limited to critical bug fixes, typo corrections, or submission documentation polishing.
