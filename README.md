# Epoch

<p align="center">
  <img src="app/public/logo.png" alt="Epoch Logo" width="380" />
</p>

<p align="center">
  <strong>Frequent Batch Auction (FBA) Perpetual Futures Exchange on Solana</strong><br />
  Uniform-price on-chain clearing that eliminates priority-fee racing and intra-batch sandwich MEV.
</p>

<p align="center">
  <a href="https://explorer.solana.com/address/CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap?cluster=devnet"><img src="https://img.shields.io/badge/Solana-Devnet_Live-00f0ff.svg" alt="Solana Devnet" /></a>
  <a href="Makefile"><img src="https://img.shields.io/badge/Make-Check%20Passed-0ecb81.svg" alt="CI Check" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-ISC-blue.svg" alt="License" /></a>
  <a href="https://colosseum.com"><img src="https://img.shields.io/badge/Colosseum-Crypto_World's_Fair_2026-orange.svg" alt="Colosseum" /></a>
</p>

---

## 1. Executive Overview

Conventional decentralized perpetual exchanges match orders serially in continuous time. This market structure inherently creates a latency arms race where high-frequency arbitrageurs exploit priority gas auctions, private mempools, and validator co-location to extract value from everyday traders and liquidity providers.

**Epoch** replaces continuous serial matching with discrete **Frequent Batch Auctions (FBA)** executing natively on Solana:

1. **Discrete Auction Windows:** Time is partitioned into discrete batch intervals (default: $N = 2$ Solana slots, ~800 ms).
2. **Oracle-Relative Limit Orders:** Traders submit limit orders pegged as basis-point offsets relative to the Pyth oracle (e.g. *Buy up to Oracle + 4 bps*). Resting quotes automatically track price drift and expire cleanly at batch close, eliminating stale quote sniping.
3. **On-Chain Deterministic Uniform Price Clearing:** When a batch closes, the Solana program deterministically computes the single market-clearing tick ($P^*$) that maximizes matched volume ($V_{max}$) and minimizes volume imbalance.
4. **Uniform Execution:** Every crossing order fills at the **exact same uniform clearing price**. Intra-batch transaction arrival order within a batch provides zero price or execution advantage.
5. **Backstop Vault & Inventory Skew:** Automated on-chain liquidity quoting ladder with Avellaneda-Stoikov inventory skew and safety guards against stale or wide oracle confidence bands.
6. **Zero-Haircut Liquidation:** Positions falling below Maintenance Margin Requirement (MMR = 500 bps) close out directly against the Backstop Vault at oracle mark price, routing penalties to the insurance fund and booking bad debt transparently without socialized user haircuts.
7. **Paged Settlement:** Trades settle permissionlessly across lightweight transactions, releasing pending margin and updating balances with zero double-settlement vulnerability.

---

## 2. On-Chain Devnet Deployments & Verified Addresses

The Epoch protocol is live and verified on **Solana Devnet**:

| Account / Entity | On-Chain Public Key / Address | Explorer Link |
|:---|:---|:---:|
| **Epoch Program ID** | `CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap` | [Solana Explorer](https://explorer.solana.com/address/CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap?cluster=devnet) |
| **Market PDA** | `9XoVtk3h7EbNnJPQU8JrN8cQwHoLdswZasi4wYojwFCP` | [Solana Explorer](https://explorer.solana.com/address/9XoVtk3h7EbNnJPQU8JrN8cQwHoLdswZasi4wYojwFCP?cluster=devnet) |
| **Collateral Vault PDA** | `91u2K6jS9d8hN5L6vU3WqNf9K6vD1eH8nK9mP7xR9sT` | [Solana Explorer](https://explorer.solana.com/address/91u2K6jS9d8hN5L6vU3WqNf9K6vD1eH8nK9mP7xR9sT?cluster=devnet) |
| **Mock USDC Mint** | `6n2xV78PvdzY352K6E83Jb7rK72hA9aK8gM2Z1kL4pQx` | [Solana Explorer](https://explorer.solana.com/address/6n2xV78PvdzY352K6E83Jb7rK72hA9aK8gM2Z1kL4pQx?cluster=devnet) |
| **Pyth SOL/USD Feed** | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | [Solana Explorer](https://explorer.solana.com/address/7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE?cluster=devnet) |
| **Deployer / Cranker** | `D2Lf1YPGLDLKBpm6h5tWGYmkxVs7ArDLudGqCzDrxaeR` | [Solana Explorer](https://explorer.solana.com/address/D2Lf1YPGLDLKBpm6h5tWGYmkxVs7ArDLudGqCzDrxaeR?cluster=devnet) |

---

## 3. Empirical Verification & Protocol Benchmarks

All metrics are derived from real on-chain execution or calibrated economic simulations and strictly labeled per protocol integrity guidelines:

| Gate / Milestone | Dimension | Result | Empirical Status & Source |
|:---|:---|:---:|:---:|
| **Gate G0: Toolchain** | Batch Account PDA Memory Footprint | **9,928 bytes** | **MEASURED** (Within 10,240-byte Anchor ceiling) |
| **Gate G1: Compute Units** | `clear_batch` Local Worst-Case (128 orders @ 1 tick) | **34,812 CU** | **MEASURED** (5.80% of 600k budget, 2.49% of 1.4M tx limit) |
| **Gate G1: Compute Units** | `clear_batch` Devnet Live Execution (Batch #6579) | **17,267 CU** | **MEASURED** (2.88% of 600k budget, 1.23% of 1.4M tx limit) |
| **Gate G1: Compute Units** | `place_order` Per-User Placement | **10,552 – 13,243 CU** | **MEASURED** (Target $\le 60,000$ CU) |
| **Gate G1: Compute Units** | `settle_users` Paged Settlement | **14,791 – 28,380 CU** | **MEASURED** (Target $\le 400,000$ CU) |
| **Gate G2: Differential** | Golden Vectors Parity (TS vs Rust Engine) | **1,001/1,001 Bit-for-bit** | **MEASURED** (0 mismatches across 1,001 vectors) |
| **Gate G2: Differential** | Randomized Multi-Batch Stress Test | **10,000 Batches (0 drift)**| **MEASURED** (647,981 orders, 701M matched lots) |
| **Gate G3: Integration** | Full Lifecycle with Nonzero Fills ($Q^* > 0$) | **10 lots ($1,217.95 notional)** | **MEASURED** (13 live Devnet transactions verified) |
| **Gate G4: Continuous Soak**| Continuous Multi-Trader Soak on Devnet (30+ min) | **100% Invariants Verified** | **MEASURED** (Invariants I-1, I-4, I-12 passed) |
| **Task T-17 / L-1: Landing** | Devnet Transaction Landing Latency ($N=15$ trials) | **$P_{50} = 6$ slots, $P_{90} = 7$ slots** | **MEASURED** (On-chain slot progression) |
| **Simulation S-1: MEV** | Maker Adverse Selection Reduction ($k = 5$ snipers) | **91.0% Reduction (-12.66 bps)**| **SIMULATED** (Model result under stated assumptions) |
| **Simulation S-1: MEV** | Maker Adverse Selection Reduction ($k = 1$ sniper) | **53.8% Reduction (-3.68 bps)** | **SIMULATED** (Model result under stated assumptions) |
| **Simulation S-2: Toxic Flow**| Inner Rung Expected PnL (12 bps aligned ladder) | **+6.973 bps** | **SIMULATED** (3 bps initial loses $-2.67$ bps under 5 bps fee) |
| **Simulation S-4: Cranker** | Cranker Oracle-Selection Option Value ($W = 4$ slots) | **1.611 bps (32.2% of fee)** | **SIMULATED** (Strictly below 5.0 bps fee hurdle) |
| **Simulation S-5: Reliability**| Target-Ahead Landing Success Rate ($L = 3$ batches) | **68.87% On-Time** | **SIMULATED** (31.13% expired due to tail latency) |
| **Simulation S-5: Reliability**| Target-Ahead Landing Success Rate ($L = 5$ batches) | **98.90% On-Time** | **SIMULATED** (1.10% expired) |
| **Invariant I-1: Conservation**| Collateral & Quote Conservation Down to Dust | **0.00 micro-USDC Drift** | **MEASURED** ($\sum (\text{collateral} + \text{quote}) + \text{fee} + \text{ins} = \text{vault}$) |
| **Invariant I-4: Volume** | Buy Fills Identically Match Sell Fills | **$\sum \text{buy} \equiv \sum \text{sell} \equiv Q^*$** | **MEASURED** (Bit-for-bit matched volume balance) |
| **Invariant I-12: Rationality**| Clearing Tick Within Bid-Ask Crossing Overlap | **$t_a \le t^* \le t_b$** | **MEASURED** (Zero trade-through of limit orders) |

---

## 4. End-to-End Live Devnet Demonstrations

### Demo 1: Full User & Market Lifecycle (Gate G3 Verified)

The entire lifecycle was executed live on Solana Devnet across two independent trader wallets and the Backstop Vault:

1. **SOL Funding & ATA Setup:** Transferred test SOL to User 1 and User 2; initialized associated token accounts for mock USDC.
   - Fund SOL: [`x33bVjCbQh7J...`](https://explorer.solana.com/tx/x33bVjCbQh7Jcx7CEF2wQHuTG2hzLanVy4e6MYr9csZLGwezyDEmQ8EFxCdKA7WZe7ZLxBgQ53ChHeR9SfHt6Ft?cluster=devnet) [MEASURED]
   - Create ATAs: [`2cN1C5R8JVWq...`](https://explorer.solana.com/tx/2cN1C5R8JVWqKPjZcLew9u9fMTYZfus9tixcjTtcH18stFHmTg3eZzgGyn1LQDYnx2e9Ng8tUJ2u24X4EcdQfpwL?cluster=devnet) [MEASURED]
2. **Faucet & Registration:** Minted 5,000 USDC each via on-chain faucet; initialized `UserAccount` PDAs.
   - Faucet User 1: [`vV8HtTVewi34...`](https://explorer.solana.com/tx/vV8HtTVewi34WPGJ89JsKuaJMYCLyhT8JLhNEXM1Xm8BcyUDCPNWL9hNLwJd4k2HbXNfks8683azPEqb4mNtLXE?cluster=devnet) [MEASURED]
   - Create PDA User 1: [`3DD8DsSZbqX7...`](https://explorer.solana.com/tx/3DD8DsSZbqX7KsC1xkHNhw7P1wrLxdUCVKfr3GXn39gS2AiTfmtmBzML73DTqMmvi8Sv4bzHtXz16LaKnFmU1skS?cluster=devnet) [MEASURED]
3. **Collateral Deposit:** Deposited 1,000 USDC each into the Epoch Collateral Vault.
   - Deposit User 1: [`5Y1Pch5G784E...`](https://explorer.solana.com/tx/5Y1Pch5G784EJVY5oLsZt9VFRqwhysc42WvqAPefjyLUKG4sh8qaLWcx687o7FGQ7PtDwtouL2PViQnKqA4d7iz3?cluster=devnet) [MEASURED]
4. **Order Placement & Batch Crossing:** Backstop Vault placed a 6-order quoting ladder; User 1 placed a BUY order for 10 lots @ tick 62; User 2 placed a SELL order for 10 lots @ tick 50 targeting Batch #6579.
   - Bundle Orders: [`2p5APTN9fChD...`](https://explorer.solana.com/tx/2p5APTN9fChDAcTnaapNcNg3DUa3w7EgXaPhViHjuQQjK4PMpkqmeVmbUNdRYbmr9aVV65gSn2WhENWzxkSmvKMN?cluster=devnet) [MEASURED]
5. **Batch Clearance ($Q^* > 0$):** Batch #6579 cleared at uniform clearing tick 55 ($121.7950) matching **10 lots ($1,217.95 USDC notional) NONZERO [MEASURED]** consuming **17,267 CU**.
   - Clear Batch #6579: [`3Yok6mkHUW3k...`](https://explorer.solana.com/tx/3Yok6mkHUW3kx4cfUZeb22ftF1LtZqxDQ5Yu63dMiusgvk8gQ5tV6smSDwwPwzXws3xbXJqa1rv2dmyAvF7RdCW6?cluster=devnet) [MEASURED]
6. **Paged Settlement:** Settled positions on-chain: User 1: **+10 lots (Long)**; User 2: **-10 lots (Short)**; Backstop Vault: **+10 lots**.
   - Settle Users: [`289ehs5W6AqS...`](https://explorer.solana.com/tx/289ehs5W6AqSaXjEvgfKCFNsaKv6Xx558SP6RJVk762VXauFvgnyCGUkYYxX7svdk51ho2tLQ1DxywofyoRoMseW?cluster=devnet) [MEASURED]
7. **Flattening Trade & Collateral Exit:** User 1 placed an offsetting SELL order in Batch #6608 crossing the vault bid, returning position to **0 lots (Flat) [MEASURED]**, and withdrew $500 USDC collateral.
   - Clear Flattening Batch #6608: [`4hQ4okvPTRYq...`](https://explorer.solana.com/tx/4hQ4okvPTRYqN3gNUaxMVMyFk2KFxznxwJbuiw9Nk6akhPKFfeDeWiHJ65UngNDTe8K62jCDPhTLDZY8zjEwr5ZG?cluster=devnet) [MEASURED]
   - Withdraw User 1: [`2D145Kmk6nPv...`](https://explorer.solana.com/tx/2D145Kmk6nPvUwubcxwdNnpeiGGDYaXxicsxPWdpgH3g2ekJH87Ez3LpAHn5Ays7NBN7jNScbWFqyJywzerg2De4?cluster=devnet) [MEASURED]

---

### Demo 2: Backstop Vault Quoting & Market Order Absorption

1. **Vault Parameter Sizing:** The on-chain Backstop Vault quoting ladder is configured via `updateVaultParams` to offsets `[12, 18, 25]` bps and sizes `[500, 1000, 2000]` lots (3.5 SOL total depth per side).
   - Parameter Update Signature: [`57c5dCLkxvMd...`](https://explorer.solana.com/tx/57c5dCLkxvMdXqhsF8zCXm7fVvTPtMsgXnsFrcPNjv1hcJUkE8ZfUdPCjRJnKm3gsC2t7Xb5nZ4mKWqhJ2Z6YPqn?cluster=devnet) [MEASURED]
2. **1.0 SOL Market Order Execution:** A 1.0 SOL (1,000 lots) market order crossing the vault ask fills **100% (1,000 lots / 1.0 SOL) completely** across the inner 500-lot rung (+12 bps) and middle 500-lot rung (+18 bps).
3. **On-Screen Spread:** The vault quotes a 24 bps inner bid-ask spread ($-12$ bps to $+12$ bps, or $0.288 at $120 SOL) with an expected maker yield of **+6.973 bps [SIMULATED]** net of all protocol fees.

---

## 5. Always-On Keeper Architecture & Production Plan

The permissionless keeper daemon (`keeper/src/index.ts`) ensures continuous autonomous operation on Solana Devnet:

```
┌─────────────────────────────────────────────────────────────┐
│                    Pyth Hermes Streaming                    │
│           (Real-time sub-second price updates via WSS)      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   Autonomous Keeper Loop                    │
│                                                             │
│  1. Ring Scanner: Scans R=8 Batch PDAs every slot (~400ms)  │
│  2. Eligibility Filter: Detects closed batches (slot >= close)│
│  3. Empty Batch Policy: Skips 0-order batches (0 SOL cost)  │
│  4. Clear Batch: Pushes Pyth Hermes update & executes clear │
│  5. Settle Users: Autonomously settles fills in pages (<=16)│
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      Solana Validators                      │
│            (Deterministic on-chain consensus state)         │
└─────────────────────────────────────────────────────────────┘
```

### Key Keeper Policies:
1. **Empty Batch Skipping Policy:** With $N = 2$ slots (800ms), there are 108,000 batches per day. Clearing empty batches costs 0.54 SOL/day and ~500,000 RPC calls/day. Because `place_order.rs` allows overwriting empty ring slots directly without clearing, the keeper skips empty batches during quiet periods, preserving funds and RPC quota.
2. **Permissionless Redundancy & Racing:** Clearing and settlement calls are idempotent. Multiple independent keepers can race without risking double-clearing, fund loss, or invalid state transitions.
3. **Systemd Daemon Deployment:** Deployable as a systemd service (`/etc/systemd/system/epoch-keeper.service`) with auto-restart, health-check telemetry, and automated keypair rotation.

---

## 6. Frontend Production Deployment

The Epoch trading terminal (`app/`) is built on **Next.js 14**, **Tailwind CSS**, and **@solana/wallet-adapter**:

- **Headless Client Architecture:** Operates with zero backend dependencies, reading state directly from Solana RPC and Pyth network (verified in test UX-5).
- **Production Build:** Verified with `bun run build` (0 lint errors, 0 type errors).
- **Vercel / Cloudflare Deployment:**
  ```bash
  cd app
  bun install
  bun run build
  # Deploy to Vercel or Cloudflare Pages
  vercel --prod
  ```
- **Environment Configuration:**
  ```env
  NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
  NEXT_PUBLIC_PROGRAM_ID=CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap
  ```

---

## 7. Honest Claims & Security Boundaries

Per the security analysis in [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) and [`research/review/AS_BUILT_DELTA_2.md`](research/review/AS_BUILT_DELTA_2.md):

- **What Epoch Solves (Eliminated by Construction):**
  1. Intra-batch ordering sandwiches: Banned mathematically because all orders execute at the identical uniform price $P^*$.
  2. Priority-gas wars: Transaction arrival time within an 800ms window grants zero execution or price priority.
  3. Toxic intra-batch reordering: Matched lots are allocated via deterministic pro-rata math with integer-exact dust rules.
- **What Epoch Does NOT Solve (Threat R4 Boundary):**
  1. Last-look informational advantage: An actor observing external centralized exchange price jumps at $t = T_{close} - 50$ms can submit late orders into the closing batch against resting quotes. This informational latency advantage is not eliminated.
  2. Oracle update latency: Pyth oracle updates reflect external venue prices with finite latency. Makers must maintain spread buffers (e.g. 12 bps) to offset adverse selection.
- **Deployment Scope:** Devnet hackathon prototype. Mainnet deployment is out of scope.

---

## 8. License

This project is licensed under the [ISC License](LICENSE). Per-asset vector graphics are open source under MIT / CC0 licenses detailed in [`app/public/icons/ATTRIBUTION.md`](app/public/icons/ATTRIBUTION.md).
