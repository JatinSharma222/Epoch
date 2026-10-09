# Epoch Protocol — Demo Script & Numerical Reference Guide

This document defines the exact step-by-step walkthrough for live hackathon judging and demonstrations of **Epoch Protocol** on Solana Devnet. Every action, expected on-chain number, indicative ticket preview, fee, and error/notice state is specified empirically from verified devnet measurements.

---

## 1. Environment & Pre-Flight Checklist

Before initiating any demonstration, run the automated pre-flight health check to verify all protocol subsystems:

```bash
# 1. Reset demo state (flattens positions, checks balances, rebalances vault inventory to 0)
bun run scripts/reset_demo_state.ts

# 2. Run automated pre-flight verification
bun run scripts/preflight.ts
```

### Expected Pre-Flight Output
```
=========================================================================
              EPOCH PROTOCOL — PRE-FLIGHT SYSTEM HEALTH CHECK            
=========================================================================
[PASS] Program ID                  : CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap (executable on Devnet)
[PASS] Wallet Balances             : Admin: 22.37 SOL (min 0.50), Keeper: 1.00 SOL
[PASS] Oracle Freshness            : Price: ~$110.00 | Conf: ±$0.035 | Age: <600s
[PASS] Keeper Liveness             : Last cleared batch: #846355 at slot 509065368 | Age: within active window
[PASS] Vault Quoting               : Active: YES | Depth: 3.5 SOL/side | Offsets: [±12, ±18, ±25 bps]
[PASS] Vault Inventory             : 0 lots (0.000 SOL) | Limit: 10000 lots (10.0 SOL)
[PASS] Ring Health                 : 8 / 8 ring buffer accounts healthy & deserializable
=========================================================================
Overall Health: ALL CHECKS PASSED [READY FOR DEMO]
=========================================================================
```

---

## 2. Protocol Numerical Parameters Reference

| Parameter | On-Chain Value | Human-Readable | Source / Rule |
| :--- | :--- | :--- | :--- |
| **Program ID** | `CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap` | Anchor Program | Devnet deployment [SOURCED] |
| **Market PDA** | `9XoVtk3h7EbNnJPQU8JrN8cQwHoLdswZasi4wYojwFCP` | Market State | Devnet deployment [SOURCED] |
| **Vault Authority PDA** | `72VMJBvoBauhktRqDfG76BavZQ9sJg8TWRibYRu2gZa2` | Vault PDA | Seed `[b"vault"]` [SOURCED] |
| **Vault User PDA** | `6fEkCVBBFpBNVaJ2BeRud8jXnYnkLdv8BEAHU6mU4m6T` | Vault Account | Seed `[b"user", vault_authority]` [SOURCED] |
| **Batch Duration** | 2 slots | ~0.48 s (at 0.23867 s/slot) | `batch_slots = 2` [MEASURED] |
| **Lookahead Window ($L$)** | 4 batches | 5 batches total ($L+1$) | `lookahead = 4` [SOURCED] |
| **Taker Fee** | 5 bps | 0.05% of notional | `taker_fee_bps = 5` [SOURCED] |
| **Max Clear Delay** | 20 slots | ~4.77 s | `max_clear_delay_slots = 20` [SOURCED] |
| **Max Oracle Age** | 600 s | 10 minutes (Devnet Pyth) | `max_oracle_age_secs = 600` [SOURCED] |
| **Vault Max Inventory** | 10,000 lots | 10.000 SOL | `max_inventory_lots = 10,000` [SOURCED] |
| **Vault Skew Slope** | 10 bps | Max ±10 bps quote shift | `skew_bps = 10` [SOURCED] |
| **Vault Ladder Depth** | 3 rungs | 3.5 SOL (3,500 lots) per side | `quote_lots = [500, 1000, 2000]` [MEASURED] |
| **Vault Ladder Offsets**| `[±12, ±18, ±25] bps` | Symmetric spread around oracle | `quote_offset_bps = [12, 18, 25]` [SOURCED] |

---

## 3. Step-by-Step Demo Walkthrough

### Step 1: Connect Wallet & Deposit Collateral
- **Action**: Connect demo wallet (e.g. Phantom or Solflare on Solana Devnet).
- **Faucet**: Click **Faucet +1,000 USDC** (mints 1,000 mock USDC).
- **Deposit**: Enter `200.00` USDC and click **Deposit Collateral**.
- **Expected UI State**:
  - Wallet balance: `800.00 USDC`
  - Account Collateral: `$200.00`
  - Free Collateral: `$200.00`
  - Open Positions: `0.00 SOL`

---

### Step 2: Fresh Wallet Small Market Sell (0.10 SOL)
Tests small order crossing against Rung 1 of the vault buy ladder.
- **Action**: Select **Sell** tab. Order Type: **Market**.
- **Size**: Enter `0.10` SOL (100 lots).
- **Indicative Preview Message Shown**:
  > `"Indicative price: oracle -14 bps for 0.10 SOL"`
- **Submit**: Click **Sell 0.10 SOL**.
- **Expected Numerical Outcome**:
  - Matched Lots: `100 / 100 lots (100% fill)`
  - Clearing Offset: `-14 bps` [MEASURED]
  - Execution Price: `Oracle Price - 14 bps` (e.g., $109.84 × (1 - 0.0014) = $109.686)
  - Protocol Fee: `5 bps`
  - Total Execution Cost: `19 bps` (-14 bps offset + 5 bps fee)
  - User Position: `-0.10 SOL` short

---

### Step 3: Fresh Wallet Standard Market Sell (1.00 SOL)
Tests medium order crossing through Rung 1 into Rung 2 of the vault buy ladder under uniform pricing.
- **Action**: Select **Sell** tab. Order Type: **Market**.
- **Size**: Enter `1.00` SOL (1,000 lots).
- **Indicative Preview Message Shown**:
  > `"Indicative price: oracle -21 bps for 1.00 SOL"`
- **Submit**: Click **Sell 1.00 SOL**.
- **Expected Numerical Outcome**:
  - Matched Lots: `1,000 / 1,000 lots (100% fill)`
  - Clearing Offset: `-21 bps` [MEASURED]
  - Uniform Clearing: All 1,000 lots execute at the single clearing price of `-21 bps` (not a blended split).
  - Protocol Fee: `5 bps`
  - Total Execution Cost: `26 bps` (-21 bps offset + 5 bps fee)
  - User Position: `-1.10 SOL` cumulative short

---

### Step 4: Limit Buy at Clearing Offset (0.10 SOL @ +14 bps)
Tests limit order crossing liquidity that matches at the indicative price.
- **Action**: Select **Buy** tab. Order Type: **Limit**.
- **Size**: Enter `0.10` SOL (100 lots).
- **Limit Offset**: Enter `+14 bps` (or select "+14 bps").
- **Indicative Preview Message Shown**:
  > `"Indicative price: oracle +13 bps for 0.10 SOL"`
- **Submit**: Click **Buy 0.10 SOL**.
- **Expected Numerical Outcome**:
  - Matched Lots: `100 / 100 lots (100% fill)`
  - Clearing Offset: `+13 bps` [MEASURED]
  - Protocol Fee: `5 bps`
  - Total Execution Cost: `18 bps` (+13 bps offset + 5 bps fee)
  - User Position: `-1.00 SOL` short

---

### Step 5: Large Market Buy Exceeding Vault Depth (5.00 SOL)
Tests protocol behavior when user order exceeds total available ladder depth (3.50 SOL). Demonstrates partial fill warnings and remaining lot expiration.
- **Action**: Select **Buy** tab. Order Type: **Market**.
- **Size**: Enter `5.00` SOL (5,000 lots).
- **Indicative Preview Message Shown**:
  > `"fills 3.5 of 5.0 SOL"`
- **Warning Notice Displayed**:
  > `"Depth insufficient: fills 3.5 of 5.0 SOL at oracle +37 bps"`
- **Submit**: Click **Buy 5.00 SOL**.
- **Expected Numerical Outcome**:
  - Matched Lots: `3,500 / 5,000 lots (70.0% partial fill)` [MEASURED]
  - Clearing Offset: `+37 bps` [MEASURED]
  - Unfilled Remainder: `1,500 lots (1.50 SOL)` expire unfilled cleanly with no margin penalty.
  - Protocol Fee: `5 bps` on filled notional ($384.44 × 0.0005 = $0.19 USDC).
  - Total Execution Cost: `42 bps` (+37 bps offset + 5 bps fee).
  - User Position: `+2.50 SOL` net long.

---

### Step 6: Flatten Position & Withdraw
- **Action**: Click **Close Position** (or place counter market sell of `2.50 SOL`).
- **Order Execution**: Matched against vault bid ladder. Position flattens to `0.00 SOL`.
- **Withdrawal**:
  - Enter full Free Collateral amount (e.g. `$198.50`).
  - Click **Withdraw Collateral**.
  - Collateral transfers back to user wallet ATA.
  - User Account balance returns to `$0.00`.

---

## 4. Edge Case Demonstrations

### Edge Case A: Limit Order with No Crossing Liquidity
- **Setup**: Select **Buy** tab. Limit price set to `-20 bps` (below vault ask ladder).
- **Indicative Preview Message Shown**:
  > `"No crossing liquidity"`
- **Subtext Notice**:
  > `"No crossing liquidity at this price, your order will expire unfilled"`
- **Result**: Order lands in batch. If no seller crosses, batch clears at 0 matched lots. Order expires cleanly at settlement.

### Edge Case B: Backstop Vault Max Inventory Exceeded
- **Condition**: Vault inventory reaches `|inventory| >= 10,000 lots` (10.0 SOL).
- **Vault Mechanism**: The vault contract triggers `VaultSkipReason::MAX_INVENTORY_EXCEEDED` and ceases quoting on both sides.
- **UI Banner Displayed**:
  > `"Vault Inventory Notice: Backstop Vault inventory limit reached (10.0 SOL). Quoting is halted until rebalanced."`
- **Rebalance Path**:
  - Administrator or cranker runs:
    ```bash
    bun run scripts/rebalance_vault.ts
    ```
  - Output:
    ```
    [rebalance] Vault inventory restored to 0 lots. Clean demo ready.
    ```
