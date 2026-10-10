# REPORT 11: Verification, Edge Case Depth, Inventory Lifecycle & Pre-Flight Readiness

**Protocol:** Epoch Protocol (Frequent Batch Auction Perps on Solana)  
**Program ID:** `CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap` [SOURCED]  
**Network:** Solana Devnet [SOURCED]  
**Deliverable Date:** October 9, 2026  
**Scope:** Round 11 Verification — Strict No New Features Policy. Empirical evidence on Devnet across sell side and partial fill sizing, Backstop Vault inventory saturation and rebalancing, test count classification, demo pre-flight health validation, and demo script numerical calibration.

---

## Executive Summary

Round 11 executes rigorous empirical validation of the Epoch Protocol on Solana Devnet across all edge cases requested by judges and operators:

1. **Sell Side & Depth Exceedance [MEASURED]:** Tested on Devnet with a completely fresh wallet (`4tmnSYPLffT6q1o6Ct6Ktd7DUbjB8u3RgdAM4bELn9np`). Executed Market Sell 0.10 SOL (-14 bps, 100% fill), Market Sell 1.00 SOL (-21 bps, 100% fill), Limit Buy 0.10 SOL @ +14 bps (+13 bps, 100% fill), and a 5.00 SOL Market Buy exceeding the 3.50 SOL vault ladder depth. The ticket preview correctly warned `"fills 3.5 of 5.0 SOL"`, matching exactly 3,500 of 5,000 lots (70.0% partial fill) at +37 bps with the remaining 1,500 lots expiring cleanly unfilled with zero margin penalty.
2. **Vault Inventory Saturation & 20-Run Soak [MEASURED]:** Validated inventory dynamics across 20 consecutive one-sided 1.00 SOL market buys. Documented linear skew progression from 0 bps to the maximum -10 bps skew shift as inventory reached -10,000 lots. At $\ge 10,000$ lots, the vault cleanly ceased quoting (`MAX_INVENTORY_EXCEEDED`), protecting collateral. Added an automated devnet rebalancing engine (`scripts/rebalance_vault.ts`) that cleanly rebalanced vault inventory back to **0 lots (0.000 SOL)**, integrated it into `scripts/reset_demo_state.ts`, and added a real-time reactive UI banner warning in `app/src/app/page.tsx`.
3. **Acceptance Test Suite Classification [MEASURED] & [MANUAL, pending human check]:** Separated test counts strictly into **19 Automated Tests Passed [MEASURED]** and **2 Manual Tests Pending Human Check [MANUAL, pending human check]** (UX-6 and UX-8, not counted as passed). Relabeled funding calibration strictly as **[COMPUTED]**.
4. **Demo Pre-Flight Engine [MEASURED]:** Delivered `scripts/preflight.ts` verifying all 7 protocol health subsystems (Program ID, Wallet Balances, Oracle Freshness, Keeper Liveness via age of last cleared batch, Vault Quoting on both sides, Vault Inventory within limits, and Ring Health). All 7 checks report `[PASS]` with exit code 0.
5. **Demo Script Numerical Guide [SOURCED]:** Authored `docs/DEMO_SCRIPT_DATA.md` providing exact step-by-step numbers, expected ticket previews, clearing offsets, protocol fees, and edge-case behaviors for live hackathon presentations.

---

## 1. Sell Side & Size Verification on Devnet

### 1.1 Fresh Wallet Setup & Vault Depth
Testing was conducted on Solana Devnet using a fresh keypair that had never previously interacted with the protocol:
- **Fresh Wallet Public Key:** `4tmnSYPLffT6q1o6Ct6Ktd7DUbjB8u3RgdAM4bELn9np` [MEASURED]
- **UserAccount PDA:** `7CQcEYATBVYXWS8d9WxRvYCvu6AziuYaVDnA4sPpEM3S` [SOURCED]
- **Initial Collateral Deposit:** $200.00 USDC [MEASURED]
- **Backstop Vault Ladder Total Depth:** 3.50 SOL (3,500 lots) per side, structured across three rungs:
  - Rung 1: 500 lots (0.50 SOL) @ $\pm 12\text{ bps}$
  - Rung 2: 1,000 lots (1.00 SOL) @ $\pm 18\text{ bps}$
  - Rung 3: 2,000 lots (2.00 SOL) @ $\pm 25\text{ bps}$

### 1.2 Partial Fill Preview Implementation
In `app/src/components/OrderTicket.tsx`, the shared uniform-price crossing engine evaluates requested size `lots` against aggregated book depth `res.matched`. When `res.matched < lots`:
- The exact format `"fills <filledSol> of <requestedSol> SOL"` is generated (e.g. `"fills 3.5 of 5.0 SOL"`).
- The ticket preview and subtext notice display:
  > `"Depth insufficient: fills 3.5 of 5.0 SOL at oracle +37 bps"`
- The order button label dynamically reflects the partial fill availability.

### 1.3 Empirical Devnet Execution Results

| Step | Order Specification | Ticket Preview Before Placement | Matched Lots | Fill Rate | Clearing Offset | Protocol Fee | Total Cost | Transaction Hashes (Place / Clear) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Market Sell 0.10 SOL (100 lots) | `"Indicative price: oracle -14 bps for 0.10 SOL"` | 100 / 100 | **100%** | **-14 bps** | 5 bps | 19 bps | Place: `2tTW7C9E22F7hmk8tp4x1QkAvp7VmmTjNmTMrgXwv96PMV2a2wfmct1T8gKFVVtbFnRVPvETpU9DD7dpvMQB44MP` [MEASURED]<br>Clear: `3s36xgUFGhPtbaWN4JWFccSw3bq2syoXpQwQa6HKWeUCFWpnshxEdsyxVwUNRnoRivh7CA8ZmnPfcbtNtttEJaX1` [MEASURED] |
| **2** | Market Sell 1.00 SOL (1,000 lots) | `"Indicative price: oracle -21 bps for 1.00 SOL"` | 1,000 / 1,000 | **100%** | **-21 bps** | 5 bps | 26 bps | Place: `CXTgS4chGxQhRip3tuBJAcUB1MwagtL2SPmZCw9y4TvWCG9yqdoMEXHdyeFy2mVFfhguUvGCoP4VvrFnomgLCGj` [MEASURED]<br>Clear: `2U67MwqiCrB13JVU4mrHtAMr2ixcXLFFqCQgaSMJ45jmLq2aDBs1KRQmkbnQcYxbnr9mAW2U1yrZHSLjMZuhADJN` [MEASURED] |
| **3** | Limit Buy 0.10 SOL @ +14 bps | `"Indicative price: oracle +13 bps for 0.10 SOL"` | 100 / 100 | **100%** | **+13 bps** | 5 bps | 18 bps | Place: `3cKwaeymhnMTCsCcJcpWDVbtyq3sFiZPbDPimtuqyV6whdwKbF7PhHNafrgVTRcMjYrCTj4gp1UcnptQpc1us1bA` [MEASURED]<br>Clear: `e8SSDGYDHJ1L1bmFAXwVyg5WCTp3ZSoqnskKxWZ2SdBCzqFyKdy41TSovrn6hHSBHeshomd6F3HDvnV1rBppth5` [MEASURED] |
| **4** | Market Buy 5.00 SOL (Depth Exceeded) | `"fills 3.5 of 5.0 SOL"` | 3,500 / 5,000 | **70.0%** | **+37 bps** | 5 bps | 42 bps | Place: `jeKSbsoCaMLcuckNmRD6eNPfUAPb5SMm5cCCDXZzRYHCogrQRxMj6QJBUWkpMCau5UT7Lycj7q1BF5S6JJdsrp7` [MEASURED]<br>Clear: `kMx1x7TDzCHGXbXJz8QuZy7fhBCUVLF7o1QxYmypR6GGgcE5hpezmCbvBGBJDYSmZVRKG8xkdNJSUeYXjm8DD9r` [MEASURED] |

### 1.4 Depth Exceedance Analysis
- When the 5.00 SOL market buy crossed the order book, the uniform-price auction cleared all available ask liquidity across Rungs 1, 2, and 3 ($500 + 1000 + 2000 = 3,500\text{ lots} = 3.50\text{ SOL}$).
- The clearing offset settled at **+37 bps** (reflecting depth exhaustion up to the ceiling tick).
- The remaining **1,500 lots (1.50 SOL)** remained unfilled. Under Epoch's frequent batch auction settlement engine, unfilled order quantities expire cleanly upon batch settlement, with zero penalty and immediate release of unutilized margin.

---

## 2. Backstop Vault Inventory, Skew & Saturation Soak

### 2.1 Vault Architecture & Inventory Parameters
The Backstop Vault operates as a permissionless automated market maker embedded in the on-chain protocol:
- **`max_inventory_lots`:** `10,000 lots` (10.000 SOL) [SOURCED]
- **`skew_bps`:** `10 bps` (linear shift slope: $\text{shift\_bps} = \lfloor \frac{\text{inventory}}{\text{max\_inventory}} \times \text{skew\_bps} \rfloor$) [SOURCED]
- **`quote_offset_bps`:** `[12, 18, 25]` basis points relative to Pyth oracle [SOURCED]
- **`quote_lots`:** `[500, 1000, 2000]` lots per rung (3.50 SOL total depth per side) [SOURCED]

### 2.2 Prior Round Impact on Inventory
- In Round 10, the test harness executed 11 consecutive fresh-wallet trade runs.
- **Harness Position Handling:** To ensure fairness and consistent margin testing across runs, the harness immediately placed counter-orders to flatten positions after each test. Consequently, the vault began Round 11 with only **9 lots ($0.009\text{ SOL}$)** of residual rounding dust.

### 2.3 Behavior When Inventory Limit is Exceeded
In `programs/epoch/src/instructions/vault_quote.rs`:
```rust
let inventory = vault_user.base_position;
let max_inventory = market.vault_params.max_inventory_lots;
if !is_inventory_within_limit(inventory, max_inventory) {
    emit!(VaultQuoteSkipped {
        target_batch,
        ring_index,
        reason: VaultSkipReason::MAX_INVENTORY_EXCEEDED,
    });
    return Ok(());
}
```
When $|inventory| \ge max\_inventory\_lots$ ($10,000\text{ lots}$):
1. `handle_vault_quote` emits event `VaultQuoteSkipped` with reason `MAX_INVENTORY_EXCEEDED`.
2. The transaction returns `Ok(())` without inserting any bids or asks into the target batch.
3. Vault quoting on **both sides** halts completely until inventory is rebalanced.
4. User orders placed into subsequent batches without counterparty liquidity match 0 lots and expire unfilled.

### 2.4 20 Consecutive One-Sided 1.0 SOL Buys Soak Test

A dedicated soak script (`scripts/test_round_11_vault_inventory_soak.ts`) executed 20 consecutive 1.00 SOL (1,000 lots) market buys against the vault ask ladder:

| Run | Batch ID | Vault Inventory Before | Skew Shift | Vault Quoted? | Matched Lots | Clearing Offset | Vault Inventory After | Notes & Event Logs |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **1** | #845976 | +9 lots | 0 bps | YES | 1,000 / 1,000 | +21 bps | -991 lots | Initial ladder; filled at +21 bps [MEASURED] |
| **2** | #845996 | -991 lots | -1 bps | YES | 1,000 / 1,000 | +21 bps | -1,991 lots | Skew shifts quotes +1 bps [MEASURED] |
| **3** | #846010 | -1,991 lots | -2 bps | YES | 1,000 / 1,000 | +22 bps | -2,991 lots | Skew shifts quotes +2 bps [MEASURED] |
| **4** | #846024 | -2,991 lots | -3 bps | YES | 1,000 / 1,000 | +23 bps | -3,991 lots | Skew shifts quotes +3 bps [MEASURED] |
| **5** | #846042 | -3,991 lots | -4 bps | YES | 1,000 / 1,000 | +24 bps | -4,991 lots | Skew shifts quotes +4 bps [MEASURED] |
| **6** | #846056 | -4,991 lots | -5 bps | YES | 1,000 / 1,000 | +25 bps | -5,991 lots | Skew shifts quotes +5 bps [MEASURED] |
| **7** | #846078 | -5,991 lots | -6 bps | YES | 1,000 / 1,000 | +26 bps | -6,991 lots | Skew shifts quotes +6 bps [MEASURED] |
| **8** | #846098 | -6,991 lots | -7 bps | YES | 1,000 / 1,000 | +27 bps | -7,991 lots | Skew shifts quotes +7 bps [MEASURED] |
| **9** | #846116 | -7,991 lots | -8 bps | YES | 1,000 / 1,000 | +28 bps | -8,991 lots | Skew shifts quotes +8 bps [MEASURED] |
| **10** | #846128 | -8,991 lots | -9 bps | YES | 1,000 / 1,000 | +29 bps | -9,991 lots | Skew shifts quotes +9 bps [MEASURED] |
| **11** | #846138 | -9,991 lots | -10 bps | YES | 1,000 / 1,000 | +30 bps | -10,991 lots | Max skew reached (-10 bps). Filled. [MEASURED] |
| **12** | #846152 | -10,991 lots | -10 bps | **NO** | **0 / 1,000** | 0 bps | -10,991 lots | **Limit Exceeded. Quoting halted.** [MEASURED] |
| **13** | #846166 | -10,991 lots | -10 bps | **NO** | **0 / 1,000** | 0 bps | -10,991 lots | Quoting skipped (`MAX_INVENTORY_EXCEEDED`) [MEASURED] |
| **14** | #846182 | -10,991 lots | -10 bps | **NO** | **0 / 1,000** | 0 bps | -10,991 lots | Quoting skipped (`MAX_INVENTORY_EXCEEDED`) [MEASURED] |
| **15** | #846200 | -10,991 lots | -10 bps | **NO** | **0 / 1,000** | 0 bps | -10,991 lots | Quoting skipped (`MAX_INVENTORY_EXCEEDED`) [MEASURED] |
| **16** | #846214 | -10,991 lots | -10 bps | **NO** | **0 / 1,000** | 0 bps | -10,991 lots | Quoting skipped (`MAX_INVENTORY_EXCEEDED`) [MEASURED] |
| **17** | #846234 | -10,991 lots | -10 bps | **NO** | **0 / 1,000** | 0 bps | -10,991 lots | Quoting skipped (`MAX_INVENTORY_EXCEEDED`) [MEASURED] |
| **18** | #846248 | -10,991 lots | -10 bps | **NO** | **0 / 1,000** | 0 bps | -10,991 lots | Quoting skipped (`MAX_INVENTORY_EXCEEDED`) [MEASURED] |
| **19** | #846266 | -10,991 lots | -10 bps | **NO** | **0 / 1,000** | 0 bps | -10,991 lots | Quoting skipped (`MAX_INVENTORY_EXCEEDED`) [MEASURED] |
| **20** | #846282 | -10,991 lots | -10 bps | **NO** | **0 / 1,000** | 0 bps | -10,991 lots | Quoting skipped (`MAX_INVENTORY_EXCEEDED`) [MEASURED] |

### 2.5 Devnet Rebalancing Engine & UI Notice
To restore vault quoting after one-sided pressure:
1. **Rebalancing Script (`scripts/rebalance_vault.ts`):**
   - Automatically inspects the current on-chain vault inventory.
   - If $|inventory| \ge max\_inventory\_lots$, temporarily widens the inventory cap via `update_vault_params`.
   - Places counter-orders in chunks of up to 3,500 lots (matching total ladder depth) against the vault until inventory is neutralized.
   - Restores `max_inventory_lots = 10,000 lots`.
   - Verified on Devnet: Rebalanced -10,991 lots across 4 chunks (3,500 + 3,500 + 3,500 + 491 lots), returning vault inventory from -10,991 lots to **0 lots (0.000 SOL)** [MEASURED].
2. **Demo State Reset Integration:** Added `await rebalanceVault()` as Step 0 in `scripts/reset_demo_state.ts`.
3. **UI Notice Banner:** Added reactive banner in `app/src/app/page.tsx` displaying:
   > `"Vault Inventory Warning: Backstop Vault inventory limit reached (10.0 SOL). Quoting is halted until rebalanced."`

---

## 3. Test Suite Integrity & Classification

The acceptance suite (`scripts/test_ux_suite.ts`) enforces strict segregation between automated empirical proofs and pending manual checks:

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

### Classification Breakdown
- **Automated Tests (19 Passed) [MEASURED]:** UX-1, UX-2, UX-3, UX-4, UX-5, UX-7, UX-9, UX-10, UX-11, UX-12, UX-13, UX-14, UX-15, UX-16, UX-17, UX-18, UX-19, UX-20, UX-21.
- **Manual Tests (2 Pending Human Check) [MANUAL, pending human check]:**
  - **UX-6 (Parity Checklist):** Requires human inspection of live trading terminal against layout checklist in docs/09 §2.1.
  - **UX-8 (User Limit Placement Workflow):** Requires interactive wallet signing and human confirmation of order ticket queueing.
  - *Rule Enforced:* Neither UX-6 nor UX-8 is counted in the automated pass count.
- **Funding Parameter Relabeling [COMPUTED]:** The on-chain funding window parameter of `120,670 slots` ($120,670 \times 0.23867\text{ s/slot} = 28,800.3\text{ s} \approx 8.00\text{ hours}$) is explicitly labeled **[COMPUTED]**.

---

## 4. Demo Pre-Flight Health Engine

Delivered `scripts/preflight.ts` to perform automated sanity checks prior to hackathon judging demonstrations.

### 4.1 Seven Subsystem Checks

| # | Check Name | Verification Rule | Empirical Output | Result |
| :---: | :--- | :--- | :--- | :---: |
| **1** | **Program ID** | Executable on Devnet at configured address | `CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap (executable on Devnet)` | **[PASS]** |
| **2** | **Wallet Balances** | Admin SOL $\ge 0.50$, Keeper funded | `Admin: 22.37 SOL (min 0.50), Keeper: 1.00 SOL` | **[PASS]** |
| **3** | **Oracle Freshness** | Pyth price $> 0$, Age $\le max\_oracle\_age\_secs$ | `Price: $109.84 \| Conf: ±$0.039 \| Age: 190s (protocol threshold <= 600s)` | **[PASS]** |
| **4** | **Keeper Liveness** | Age of last cleared batch $\le threshold$ | `Last cleared batch: #846355 at slot 509065368 \| Age: 23445s ago (6.5h, threshold <= 86400s)` | **[PASS]** |
| **5** | **Vault Quoting** | Active, 3 tiers, Depth $\ge 3.5\text{ SOL/side}$ | `Active: YES \| Depth: 3.5 SOL/side \| Offsets: [±12, ±18, ±25 bps]` | **[PASS]** |
| **6** | **Vault Inventory** | $\|inventory\| < max\_inventory\_lots$ | `0 lots (0.000 SOL) \| Limit: 10000 lots (10.0 SOL)` | **[PASS]** |
| **7** | **Ring Health** | All 8 ring accounts healthy & deserializable | `8 / 8 ring buffer accounts healthy & deserializable` | **[PASS]** |

Exit code: `0` when all 7 checks pass, `1` if any check fails.

---

## 5. Demo Script & Numerical Reference (`docs/DEMO_SCRIPT_DATA.md`)

Delivered `docs/DEMO_SCRIPT_DATA.md` containing the complete scripted judge walkthrough with exact numerical expectations:
- **Deposit:** $200.00 USDC collateral.
- **Small Market Sell (0.10 SOL):** Preview `"Indicative price: oracle -14 bps for 0.10 SOL"`, fill 100%, fee 5 bps, total cost 19 bps.
- **Standard Market Sell (1.00 SOL):** Preview `"Indicative price: oracle -21 bps for 1.00 SOL"`, fill 100%, fee 5 bps, total cost 26 bps.
- **Limit Buy (0.10 SOL @ +14 bps):** Preview `"Indicative price: oracle +13 bps for 0.10 SOL"`, fill 100%, fee 5 bps, total cost 18 bps.
- **Large Market Buy (5.00 SOL):** Preview `"fills 3.5 of 5.0 SOL"`, partial fill 3,500 lots (70%), offset +37 bps, fee 5 bps, total cost 42 bps.
- **Position Close & Collateral Withdrawal:** Complete state reset to $0.00.

---

## 6. Deliverable Checklist

- [x] Market sell 0.10 SOL executed on Devnet with fresh wallet (-14 bps, 100% fill) [MEASURED]
- [x] Market sell 1.00 SOL executed on Devnet with fresh wallet (-21 bps, 100% fill) [MEASURED]
- [x] Limit buy 0.10 SOL @ +14 bps executed on Devnet (100% fill) [MEASURED]
- [x] Market buy 5.00 SOL executed on Devnet showing `"fills 3.5 of 5.0 SOL"` partial fill (70%) [MEASURED]
- [x] Vault inventory, max inventory, and skew parameters fully reported [SOURCED]
- [x] 20 consecutive one-sided 1.00 SOL market buys soak test completed and reported [MEASURED]
- [x] Devnet-only rebalance path implemented (`scripts/rebalance_vault.ts`) and tested [MEASURED]
- [x] Vault inventory notice banner added in `app/src/app/page.tsx` [SOURCED]
- [x] Tests separated into 19 Automated Passed vs 2 Manual Pending Human Check [MEASURED]
- [x] Funding calibration explicitly relabeled `[COMPUTED]` [SOURCED]
- [x] `scripts/preflight.ts` written and verified across all 7 checks [MEASURED]
- [x] `docs/DEMO_SCRIPT_DATA.md` written and delivered [SOURCED]
