# Epoch Protocol: Architecture Specification (As Built)

This document provides a concise, one-page architectural reference for the Epoch Frequent Batch Auction (FBA) perpetual futures protocol as deployed and verified on Solana Devnet.

---

## 1. System Topology

Epoch executes discrete uniform-price batch auctions natively on Solana, eliminating intra-batch transaction ordering advantages, priority gas wars, and sandwich MEV.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             SOLANA DEVNET CONSENSUS                         │
│                                                                             │
│   Epoch Program: CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap               │
│                                                                             │
│   ┌──────────────────┐    ┌──────────────────┐    ┌─────────────────────┐   │
│   │   Market PDA     │    │  UserAccount PDA │    │  Collateral Vault   │   │
│   │ (params, index)  │    │ (margin, lots)   │    │  (USDC SPL Token)   │   │
│   └────────▲─────────┘    └────────▲─────────┘    └──────────▲──────────┘   │
│            │                       │                         │              │
│   ┌────────┴───────────────────────┴─────────────────────────┴──────────┐   │
│   │               Batch Ring Buffer (R = 8 Zero-Copy PDAs)              │   │
│   │    Batch #b: bid_qty[101], ask_qty[101], orders[128], status, tick  │   │
│   └────────▲────────────────────────────────────────────────────────────┘   │
└────────────┼───────────────────────────────────────▲────────────────────────┘
             │ Transactions (place/cancel/deposit)   │ Cranks (clear/settle/quote)
             │                                       │
┌────────────┴─────────────┐            ┌────────────┴────────────────────────┐
│  Headless Web Terminal   │            │     Autonomous Keeper Daemon        │
│        (Next.js 14)      │            │           (TypeScript)              │
│                          │            │                                     │
│ • Direct Solana RPC reads│            │ • Scans R=8 Ring Buffer every slot  │
│ • Wallet Adapter signing │            │ • Cranks clear_batch on closed slots│
│ • Pyth Hermes streaming  │            │ • Cranks paged settle_users (<=16)  │
│ • Indicative preview     │            │ • Quotes Backstop Vault ladder      │
└────────────▲─────────────┘            └────────────▲────────────────────────┘
             │                                       │
             └───────────────────┬───────────────────┘
                                 │
                   ┌─────────────┴─────────────┐
                   │    Pyth Network Hermes    │
                   │ (SOL/USD Low-Latency Feed)│
                   └───────────────────────────┘
```

---

## 2. Core Components

### 2.1 On-Chain Program (`programs/epoch`)
Built with Anchor 0.30.1 and Rust. Manages market state, accounts, orders, auctions, and margin:
- **`Market` PDA:** Stores global protocol configuration (`batch_slots = 2`, `imr_bps = 1000`, `mmr_bps = 500`, `fee_bps = 5`, `funding_period_slots = 120,670`).
- **`Batch` Ring Buffer ($R = 8$ PDAs):** Stores 101-tick aggregate demand/supply arrays (`bid_qty`, `ask_qty`) and up to 128 orders per batch in a compact zero-copy Borsh layout (9,928 bytes). Lookahead is restricted to $L = 3$ batches ($1.43\text{ s}$).
- **`UserAccount` PDAs:** Tracks user `collateral`, `base_position` (lots), `quote_position` (micro-USDC), pending order reservations, and funding index snapshots.
- **`Backstop Vault` PDA:** Dedicated protocol liquidity provider running on-chain with deterministic Avellaneda-Stoikov inventory skew.

### 2.2 Autonomous Keeper Daemon (`keeper/`)
Runs continuously as a background process to advance on-chain auctions:
- **Ring Scanner:** Inspects the 8 ring buffer accounts every slot ($\sim 238\text{ ms}$).
- **Batch Cranker:** Submits Pyth price updates and calls `clear_batch` as soon as $\text{current\_slot} \ge \text{close\_slot}$.
- **Empty Batch Policy:** Automatically skips batches with 0 orders, avoiding transaction fees and preserving RPC quotas during quiet periods.
- **Paged Settlement Cranker:** Calls `settle_users` in chunks of $\le 16$ users per transaction to respect Solana compute and account limits.
- **Stale Batch Guard:** If a batch remains un-cleared for $>20$ slots, keeper or users may call `expire_and_release` to void the batch and unblock the ring slot.

### 2.3 Headless Trading Frontend (`app/`)
Built with Next.js 14, Tailwind CSS, and `@solana/wallet-adapter`:
- **Headless Client:** Operates with zero backend dependencies, reading state directly from Solana RPC and Pyth Hermes.
- **Indicative Clearing Preview:** Computes indicative uniform clearing offsets in real time using the shared auction clearing algorithm.
- **Oversize Depth Guard:** Warns traders when order size exceeds available book depth and renders partial fill notices prior to submission.
- **RPC Outage Resilience:** Displays unambiguous fallback warnings without fabricating synthetic prices.

---

## 3. Order Lifecycle & Execution Flow

```
[Trader] ──> place_order (targets batch b <= current + L)
                 │
                 ├── Locks initial margin (IMR = 1000 bps + slippage buffer)
                 └── Updates on-chain aggregate tick arrays (bid_qty / ask_qty)
                 │
[Time]   ──> slot >= close_slot (batch closes)
                 │
[Keeper] ──> clear_batch
                 │
                 ├── Consumes Pyth oracle update (checks age <= 600s, conf <= 50 bps)
                 ├── Computes maximum volume tick (Vmax) and minimum imbalance midpoint (i*)
                 └── Sets single uniform clearing price (price*) for all matched lots
                 │
[Keeper] ──> settle_users (paged <= 16 users/tx)
                 │
                 ├── Allocates fills: price priority -> pro-rata -> deterministic dust
                 ├── Updates base_position, quote_position, and protocol fee_pool
                 └── Sets batch state to SETTLED and releases ring slot for reuse
```

---

## 4. Backstop Liquidity & Risk Management

- **Quoting Ladder:** 3 rungs on each side at offsets `[12, 18, 25]` bps with sizes `[500, 1000, 2000]` lots ($3.5\text{ SOL}$ depth/side, VWAP $21.1\text{ bps}$).
- **Inventory Skew:** Avellaneda-Stoikov skew shifts quotes outward as inventory builds ($\text{skew\_bps} = 10$).
- **Asymmetric Limit Quoting:** When vault short inventory reaches the $-10,000$ lot limit, ask quotes halt while bid quotes remain active, allowing counter-flow to reduce inventory back toward zero.
- **Liquidation:** Undercollateralized accounts ($\text{equity} < \text{MMR}$) close out directly against the Backstop Vault at the oracle mark price. A 100 bps liquidation penalty routes to the protocol insurance fund.
- **Mathematical Invariants:** Enforces exact conservation ($\sum \text{base} \equiv 0$ and Invariant $I-1$) on every fill and settlement down to 0 micro-USDC drift.

---

## 5. Telemetry & Verification Infrastructure

- **Snapshot Export (`scripts/export_snapshot.ts`):** Exports verified on-chain account states and batch metrics to JSON artifacts.
- **Pre-Flight Health Check (`scripts/preflight.ts`):** Automatically validates 7 live Devnet operational checks prior to demo execution.
- **Link & Address Verifier (`scripts/verify_links.ts`):** Queries Solana Devnet RPC to confirm 100% resolution of every deployed address and transaction signature.
