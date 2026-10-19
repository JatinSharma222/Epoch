# Epoch

<p align="center">
  <img src="app/public/logo.png" alt="Epoch Logo" width="380" />
</p>

<p align="center">
  <strong>Frequent Batch Auction (FBA) Perpetual Futures Exchange on Solana</strong><br />
  Epoch is an experimental batch-auction perpetual exchange on Solana (devnet research prototype).
</p>

<p align="center">
  <a href="https://explorer.solana.com/address/CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap?cluster=devnet"><img src="https://img.shields.io/badge/Solana-Devnet_Live-00f0ff.svg" alt="Solana Devnet" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-ISC-blue.svg" alt="License" /></a>
</p>

---

## 1. Overview

**Epoch is an experimental batch-auction perpetual exchange on Solana (devnet research prototype).**

Conventional decentralized perpetual exchanges match orders serially in continuous time. This market structure inherently creates a latency arms race where high-frequency arbitrageurs exploit priority gas auctions, private mempools, and validator co-location to extract value from everyday traders and liquidity providers.

Epoch replaces continuous serial matching with discrete **Frequent Batch Auctions (FBA)** executing natively on Solana: uniform-price on-chain clearing that removes the ordering race inside a batch and ordering-based sandwiches.

### On-Chain Devnet Deployments & Verified Addresses

#### v1 Deployment (Live / Audited Devnet Protocol)

The Epoch v1 protocol is live and verified on **Solana Devnet** with hardened cryptographic Pyth oracle verification, parameter boundaries, and fresh segregated keypairs:

| Account / Entity | On-Chain Public Key / Address | Explorer Link |
|:---|:---|:---:|
| **Epoch Program ID (v1)** | `ER8SSfvp7roW6asG429Uv3mHY1aEd1jxGBdigLu27284` | [Solana Explorer](https://explorer.solana.com/address/ER8SSfvp7roW6asG429Uv3mHY1aEd1jxGBdigLu27284?cluster=devnet) |
| **Upgrade Authority (v1)** | `4vyQiHC1BqTsXQHkTPjQ3WMe6EoDi1Jeh2LZku8mwjTV` | [Solana Explorer](https://explorer.solana.com/address/4vyQiHC1BqTsXQHkTPjQ3WMe6EoDi1Jeh2LZku8mwjTV?cluster=devnet) |
| **Market PDA (v1)** | `EaN2QU5w5RVTepYExdqxcuu49pg7MHSFWBEYpN2QKYsF` | [Solana Explorer](https://explorer.solana.com/address/EaN2QU5w5RVTepYExdqxcuu49pg7MHSFWBEYpN2QKYsF?cluster=devnet) |
| **Backstop Vault User PDA (v1)** | `EJx8SbY1p6LV7JC8MjE6kF8fJgNEjewYNvJnZq6i86Eu` | [Solana Explorer](https://explorer.solana.com/address/EJx8SbY1p6LV7JC8MjE6kF8fJgNEjewYNvJnZq6i86Eu?cluster=devnet) |
| **Vault Authority PDA (v1)** | `ALjbMKvwkfoy234kMwSUB6svmAu4TeXWzLtbMC36dJyv` | [Solana Explorer](https://explorer.solana.com/address/ALjbMKvwkfoy234kMwSUB6svmAu4TeXWzLtbMC36dJyv?cluster=devnet) |
| **Collateral Vault PDA (v1)** | `CkaBNrXFLqJTCQCbSenDmkbXc2apXXE2HTKSopvX8ku6` | [Solana Explorer](https://explorer.solana.com/address/CkaBNrXFLqJTCQCbSenDmkbXc2apXXE2HTKSopvX8ku6?cluster=devnet) |
| **Mock USDC Mint (v1)** | `9ncxNM7tiBo3Gfeo6T2CrC71T3WsbaubpkRbK2YN2XTd` | [Solana Explorer](https://explorer.solana.com/address/9ncxNM7tiBo3Gfeo6T2CrC71T3WsbaubpkRbK2YN2XTd?cluster=devnet) |
| **Keeper Cranker Key (v1)** | `ENpGtE1uv89juataka3Qc1BUZ9ytATsmr7Zy18ahSZPM` | [Solana Explorer](https://explorer.solana.com/address/ENpGtE1uv89juataka3Qc1BUZ9ytATsmr7Zy18ahSZPM?cluster=devnet) |
| **Pyth SOL/USD Feed** | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | [Solana Explorer](https://explorer.solana.com/address/7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE?cluster=devnet) |
| **Deployment Transaction** | `4ATjm2zfZNZcpUKDHQaQy8mfdT7Ke3Cu6GxmXvyqQwE6DVDJkYbuuVH2w4s2TNsevxMBZeVtvmx45yKjC1G3uTKr` | [Solana Explorer](https://explorer.solana.com/tx/4ATjm2zfZNZcpUKDHQaQy8mfdT7Ke3Cu6GxmXvyqQwE6DVDJkYbuuVH2w4s2TNsevxMBZeVtvmx45yKjC1G3uTKr?cluster=devnet) |
| **Market Init Transaction** | `2yyVqG2PAWEHvW38YtYpqmY8NKGDu5t7XK4UzFs7Foa4ByZom2CBLex6Kyqw3JkuecZcDfrfTN15HeRypj8E7H3r` | [Solana Explorer](https://explorer.solana.com/tx/2yyVqG2PAWEHvW38YtYpqmY8NKGDu5t7XK4UzFs7Foa4ByZom2CBLex6Kyqw3JkuecZcDfrfTN15HeRypj8E7H3r?cluster=devnet) |

#### v0 Deployment (SUPERSEDED / Pre-Audit Devnet Prototype)

> [!WARNING]
> The addresses below correspond to the initial hackathon submission and pre-audit research prototype (**v0**). This deployment has been **SUPERSEDED** by v1 and is documented here for historical audit integrity. Do not interact with v0.

| Account / Entity | On-Chain Public Key / Address | Explorer Link | Status |
|:---|:---|:---:|:---:|
| **Epoch Program ID (v0)** | `CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap` | [Solana Explorer](https://explorer.solana.com/address/CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap?cluster=devnet) | SUPERSEDED |
| **Upgrade Authority (v0)** | `D2Lf1YPGLDLKBpm6h5tWGYmkxVs7ArDLudGqCzDrxaeR` | [Solana Explorer](https://explorer.solana.com/address/D2Lf1YPGLDLKBpm6h5tWGYmkxVs7ArDLudGqCzDrxaeR?cluster=devnet) | SUPERSEDED |
| **Market PDA (v0)** | `9XoVtk3h7EbNnJPQU8JrN8cQwHoLdswZasi4wYojwFCP` | [Solana Explorer](https://explorer.solana.com/address/9XoVtk3h7EbNnJPQU8JrN8cQwHoLdswZasi4wYojwFCP?cluster=devnet) | SUPERSEDED |
| **Backstop Vault User PDA (v0)** | `6fEkCVBBFpBNVaJ2BeRud8jXnYnkLdv8BEAHU6mU4m6T` | [Solana Explorer](https://explorer.solana.com/address/6fEkCVBBFpBNVaJ2BeRud8jXnYnkLdv8BEAHU6mU4m6T?cluster=devnet) | SUPERSEDED |
| **Collateral Vault PDA (v0)** | `2Vj53nWYb95KxS1Zgbh5dvJryWrPmaprz3hRDuW4aZPG` | [Solana Explorer](https://explorer.solana.com/address/2Vj53nWYb95KxS1Zgbh5dvJryWrPmaprz3hRDuW4aZPG?cluster=devnet) | SUPERSEDED |
| **Mock USDC Mint (v0)** | `7VR6BNMZ5Y4bPRyndLAhXm9EN3GASHum6kym1hbrT2Xs` | [Solana Explorer](https://explorer.solana.com/address/7VR6BNMZ5Y4bPRyndLAhXm9EN3GASHum6kym1hbrT2Xs?cluster=devnet) | SUPERSEDED |
| **Latest Upgrade Tx (v0)** | `5HRnbiYa51Vo93KTVEG5oSj4goUCgqNrMCRehgA2Mujfk7gvwhqRnuFDNzvTSmL3xeu2PmmYGPbQnyQxnpGwpTzX` | [Solana Explorer](https://explorer.solana.com/tx/5HRnbiYa51Vo93KTVEG5oSj4goUCgqNrMCRehgA2Mujfk7gvwhqRnuFDNzvTSmL3xeu2PmmYGPbQnyQxnpGwpTzX?cluster=devnet) | HISTORICAL |

### Core Documentation Links
- **Roadmap & Priorities:** [`docs/ROADMAP.md`](docs/ROADMAP.md)
- **Architecture (As Built):** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Mechanism Specification:** [`docs/MECHANISM_SPEC.md`](docs/MECHANISM_SPEC.md)
- **Demonstration Walkthrough:** [`docs/DEMO_WALKTHROUGH.md`](docs/DEMO_WALKTHROUGH.md)
- **Known Limitations & As-Built Delta:** [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md)
- **Threat Model & Security Boundaries:** [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)

---

## 2. How It Works

Epoch replaces continuous serial matching with discrete Frequent Batch Auctions:

1. **Discrete Auction Windows:** Time is partitioned into discrete batch intervals (default: $N = 2$ Solana slots, ~477 ms [MEASURED: 238.67 ms/slot]).
2. **Oracle-Relative Limit Orders:** Traders submit limit orders pegged as basis-point offsets relative to the Pyth oracle (e.g. *Buy up to Oracle + 4 bps*). Resting quotes automatically track price drift and expire cleanly at batch close (resting quotes track the oracle; oracle-lag exposure remains).
3. **On-Chain Deterministic Uniform Price Clearing:** When a batch closes, the Solana program deterministically computes the single market-clearing tick ($P^*$) that maximizes matched volume ($V_{max}$) and minimizes volume imbalance.
4. **Uniform Execution:** Every crossing order fills at the **exact same uniform clearing price**. Intra-batch transaction arrival order within a batch provides zero price or execution advantage.
5. **Backstop Vault & Inventory Skew:** Automated on-chain liquidity quoting ladder with linear inventory skew and safety guards against stale or wide oracle confidence bands.
6. **Backstop Liquidation:** Positions falling below Maintenance Margin Requirement (MMR = 500 bps) can be liquidated against the Backstop Vault at oracle mark price, routing penalties to the insurance fund (implemented and verified via unit tests; the vault absorbs delinquent positions).
7. **Paged Settlement:** Trades settle permissionlessly across lightweight transactions (up to 16 users per page), releasing pending margin and updating balances (guarded by bitmap settlement flags preventing duplicate settlement; verified on devnet).

### Autonomous Keeper Daemon

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
│  1. Ring Scanner: Scans R=8 Batch PDAs (slot ~239 ms;       │
│     clear/settle: 1,000 ms; vault quoting: 2,000 ms)        │
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
└──────────────────────────────┬──────────────────────────────┘
```

#### Key Keeper Policies
1. **Empty Batch Skipping Policy:** With $N = 2$ slots (~477 ms at ~239 ms/slot), there are ~181,000 batches per day [ESTIMATE]. Clearing empty batches costs ~0.9 SOL/day [ESTIMATE] and ~900,000 RPC calls/day [ESTIMATE]. Because `place_order.rs` allows overwriting empty ring slots directly without clearing, the keeper skips empty batches during quiet periods, preserving funds and RPC quota.
2. **Permissionless Redundancy & Racing:** Clearing and settlement calls are idempotent. Multiple independent keepers can race without risking double-clearing, fund loss, or invalid state transitions.
3. **Systemd Daemon Deployment:** Deployable as a systemd service (`/etc/systemd/system/epoch-keeper.service`) with auto-restart and health-check telemetry.

### End-to-End Live Devnet Demonstrations

> **Counterparty Note:** All fills to date on Devnet were matched against the on-chain protocol Backstop Vault (`6fEkCVBBFpBNVaJ2BeRud8jXnYnkLdv8BEAHU6mU4m6T`). Direct peer-to-peer matching between distinct user accounts is fully implemented and tested in the clearing engine, but all live devnet benchmark fills were absorbed by the Backstop Vault liquidity ladder.

#### Demo 1: Full User & Market Lifecycle (Milestone M3 Verified)

The entire lifecycle was executed live on Solana Devnet across trader wallets and the Backstop Vault:

1. **SOL Funding & ATA Setup:** Transferred test SOL to User 1 and User 2; initialized associated token accounts for mock USDC.
   - Fund SOL: [`x33bVjCbQh7Jcx7CEF2wQHuTG2hzLanVy4e6MYr9csZLGwezyDEmQ8EFxCdKA7WZe7ZLxBgQ53ChHeR9SfHt6Ft`](https://explorer.solana.com/tx/x33bVjCbQh7Jcx7CEF2wQHuTG2hzLanVy4e6MYr9csZLGwezyDEmQ8EFxCdKA7WZe7ZLxBgQ53ChHeR9SfHt6Ft?cluster=devnet) [MEASURED]
   - Create ATAs: [`2cN1C5R8JVWqKPjZcLew9u9fMTYZfus9tixcjTtcH18stFHmTg3eZzgGyn1LQDYnx2e9Ng8tUJ2u24X4EcdQfpwL`](https://explorer.solana.com/tx/2cN1C5R8JVWqKPjZcLew9u9fMTYZfus9tixcjTtcH18stFHmTg3eZzgGyn1LQDYnx2e9Ng8tUJ2u24X4EcdQfpwL?cluster=devnet) [MEASURED]
2. **Faucet & Registration:** Minted 5,000 USDC each via on-chain faucet; initialized `UserAccount` PDAs.
   - Faucet User 1: [`vV8HtTVewi34WPGJ89JsKuaJMYCLyhT8JLhNEXM1Xm8BcyUDCPNWL9hNLwJd4k2HbXNfks8683azPEqb4mNtLXE`](https://explorer.solana.com/tx/vV8HtTVewi34WPGJ89JsKuaJMYCLyhT8JLhNEXM1Xm8BcyUDCPNWL9hNLwJd4k2HbXNfks8683azPEqb4mNtLXE?cluster=devnet) [MEASURED]
   - Create PDA User 1: [`3DD8DsSZbqX7KsC1xkHNhw7P1wrLxdUCVKfr3GXn39gS2AiTfmtmBzML73DTqMmvi8Sv4bzHtXz16LaKnFmU1skS`](https://explorer.solana.com/tx/3DD8DsSZbqX7KsC1xkHNhw7P1wrLxdUCVKfr3GXn39gS2AiTfmtmBzML73DTqMmvi8Sv4bzHtXz16LaKnFmU1skS?cluster=devnet) [MEASURED]
3. **Collateral Deposit:** Deposited 1,000 USDC each into the Epoch Collateral Vault.
   - Deposit User 1: [`5Y1Pch5G784EJVY5oLsZt9VFRqwhysc42WvqAPefjyLUKG4sh8qaLWcx687o7FGQ7PtDwtouL2PViQnKqA4d7iz3`](https://explorer.solana.com/tx/5Y1Pch5G784EJVY5oLsZt9VFRqwhysc42WvqAPefjyLUKG4sh8qaLWcx687o7FGQ7PtDwtouL2PViQnKqA4d7iz3?cluster=devnet) [MEASURED]
4. **Order Placement & Batch Crossing:** Backstop Vault placed its 6-order quoting ladder; User 1 placed a BUY order for 10 lots @ tick 62 targeting Batch #6579.
   - Bundle Orders: [`2p5APTN9fChDAcTnaapNcNg3DUa3w7EgXaPhViHjuQQjK4PMpkqmeVmbUNdRYbmr9aVV65gSn2WhENWzxkSmvKMN`](https://explorer.solana.com/tx/2p5APTN9fChDAcTnaapNcNg3DUa3w7EgXaPhViHjuQQjK4PMpkqmeVmbUNdRYbmr9aVV65gSn2WhENWzxkSmvKMN?cluster=devnet) [MEASURED]
5. **Batch Clearance ($Q^* > 0$):** Batch #6579 cleared at uniform clearing tick 55 ($121.7950) matching **10 lots (0.01 SOL, about $1.22 USDC notional) NONZERO [MEASURED]** consuming **17,267 CU**. *(Note: Demo 1 predates the widened vault ladder; it cleared at +5 bps).*
   - Clear Batch #6579: [`3Yok6mkHUW3kx4cfUZeb22ftF1LtZqxDQ5Yu63dMiusgvk8gQ5tV6smSDwwPwzXws3xbXJqa1rv2dmyAvF7RdCW6`](https://explorer.solana.com/tx/3Yok6mkHUW3kx4cfUZeb22ftF1LtZqxDQ5Yu63dMiusgvk8gQ5tV6smSDwwPwzXws3xbXJqa1rv2dmyAvF7RdCW6?cluster=devnet) [MEASURED]
6. **Paged Settlement:** Settled positions on-chain against the vault: User 1: **+10 lots (Long)**; Backstop Vault: **-10 lots (Short)**.
   - Settle Users: [`289ehs5W6AqSaXjEvgfKCFNsaKv6Xx558SP6RJVk762VXauFvgnyCGUkYYxX7svdk51ho2tLQ1DxywofyoRoMseW`](https://explorer.solana.com/tx/289ehs5W6AqSaXjEvgfKCFNsaKv6Xx558SP6RJVk762VXauFvgnyCGUkYYxX7svdk51ho2tLQ1DxywofyoRoMseW?cluster=devnet) [MEASURED]
7. **Flattening Trade & Collateral Exit:** User 1 placed an offsetting SELL order in Batch #6608 crossing the vault bid, returning position to **0 lots (Flat) [MEASURED]**, and withdrew $500 USDC collateral.
   - Clear Flattening Batch #6608: [`4hQ4okvPTRYqN3gNUaxMVMyFk2KFxznxwJbuiw9Nk6akhPKFfeDeWiHJ65UngNDTe8K62jCDPhTLDZY8zjEwr5ZG`](https://explorer.solana.com/tx/4hQ4okvPTRYqN3gNUaxMVMyFk2KFxznxwJbuiw9Nk6akhPKFfeDeWiHJ65UngNDTe8K62jCDPhTLDZY8zjEwr5ZG?cluster=devnet) [MEASURED]
   - Withdraw User 1: [`2D145Kmk6nPvUwubcxwdNnpeiGGDYaXxicsxPWdpgH3g2ekJH87Ez3LpAHn5Ays7NBN7jNScbWFqyJywzerg2De4`](https://explorer.solana.com/tx/2D145Kmk6nPvUwubcxwdNnpeiGGDYaXxicsxPWdpgH3g2ekJH87Ez3LpAHn5Ays7NBN7jNScbWFqyJywzerg2De4?cluster=devnet) [MEASURED]

#### Demo 2: Backstop Vault Quoting & Uniform Price Execution

1. **Vault Parameter Sizing:** The on-chain Backstop Vault quoting ladder is configured via `updateVaultParams` to offsets `[12, 18, 25]` bps and sizes `[500, 1000, 2000]` lots (3.5 SOL total depth per side, VWAP: 21.1 bps).
   - Parameter Update Signature: [`57c5dCLkxvMdXqhsF8zCXm7fVvTPtMsgXnsFrcPNjv1hcJUkE8ZfUdPCjRJnKm3gsC2t7Xb5nZ4mKWqhJ2Z6YPqn`](https://explorer.solana.com/tx/57c5dCLkxvMdXqhsF8zCXm7fVvTPtMsgXnsFrcPNjv1hcJUkE8ZfUdPCjRJnKm3gsC2t7Xb5nZ4mKWqhJ2Z6YPqn?cluster=devnet) [MEASURED]
2. **1.0 SOL Market Order Execution:** A 1.0 SOL (1,000 lots) market buy clears at the single uniform clearing price of **+21.00 bps** (the minimum-imbalance midpoint of the plateau), plus 5 bps fee (total taker cost: 26 bps one-way), matching 100% of lots at that single price.
3. **On-Screen Spread:** The vault quotes a 24 bps inner bid-ask spread ($-12$ bps to $+12$ bps, or $0.288 at $120 SOL) with an expected maker yield of **+6.973 bps [SIMULATED]** net of all protocol fees.

#### Demo 3: Vault Inventory Limit & Asymmetric Reversal (Round 12 Verified)

1. **Inventory Limit & Asymmetric Quoting:** Tested with 20 consecutive 1.0 SOL market buys against the Backstop Vault. As inventory accumulated, linear inventory skew widened clearing offsets from +21 bps up to +30 bps. At Run 10, vault inventory reached the maximum short limit of **-10,000 lots (-10.0 SOL)**.
2. **One-Sided Quoting Halt:** In Runs 11–20, the vault halted ask quotes (inventory-increasing side) while continuing to quote bid quotes (inventory-reducing side), resulting in 0 lots matched for subsequent buys.
3. **Inventory Reversal:** A 1.0 SOL market sell was submitted. Because the vault maintained its bid ladder, the order executed at offset **-11 bps**, matching 1,000 lots and reducing vault short inventory from -10,000 to -9,000 lots:
   - Sell Placement Tx: [`5wBq234e7RatQY1XB7GuBQKV1VUTx6vjrFkPtUqbykNorjcPYf9wRjv1i76VzL3E5R1BpeZaXhMsnxwrBjsQGUas`](https://explorer.solana.com/tx/5wBq234e7RatQY1XB7GuBQKV1VUTx6vjrFkPtUqbykNorjcPYf9wRjv1i76VzL3E5R1BpeZaXhMsnxwrBjsQGUas?cluster=devnet) [MEASURED]
   - Batch Clearance Tx: [`5aidNPa7H3yNBALk6i3CUFE7LTJ7nHsFBW6yFFkLvPvAx66TacrRjGmC8E887H1cgw3wgR8hddhDMFk6ANBvj5MA`](https://explorer.solana.com/tx/5aidNPa7H3yNBALk6i3CUFE7LTJ7nHsFBW6yFFkLvPvAx66TacrRjGmC8E887H1cgw3wgR8hddhDMFk6ANBvj5MA?cluster=devnet) [MEASURED]
4. **Oversize Order Preview:** When an order exceeds total book depth (e.g. 5.0 SOL market buy against 3.5 SOL vault ladder depth), the order ticket preview displays both the expected clearing offset (+37 bps) and the partial fill notice ("fills 3.5 of 5.0 SOL") prior to signing the transaction.

---

## 3. Measured Results

All metrics are derived from real on-chain execution or calibrated economic simulations and strictly labeled per protocol evidentiary standards:

| Verification Milestone | Metric / Dimension | Verified Result | Evidentiary Label & Source |
|:---|:---|:---:|:---:|
| **Milestone M0: Toolchain** | Batch Account PDA Memory Footprint | **9,928 bytes** | **[MEASURED]** (Within 10,240-byte Anchor ceiling) |
| **Milestone M1: Compute Units** | `clear_batch` Local Worst-Case (128 orders @ 1 tick) | **34,812 CU** | **[MEASURED]** (5.80% of 600k budget, 2.49% of 1.4M tx limit) |
| **Milestone M1: Compute Units** | `clear_batch` Devnet Live Execution (Batch #6579) | **17,267 CU** | **[MEASURED]** (2.88% of 600k budget, 1.23% of 1.4M tx limit) |
| **Milestone M1: Compute Units** | `expire_and_release` Stale Batch Release | **12,425 CU** | **[MEASURED]** (Devnet tx [`2c1bTXx4p3B6ESJtj7154MkTEL74qEq5Qz8EnrAT7ErBUWRjWM2StDNhMaaryF3oyfkBdjpCnedmWNvo7bod3zhV`](https://explorer.solana.com/tx/2c1bTXx4p3B6ESJtj7154MkTEL74qEq5Qz8EnrAT7ErBUWRjWM2StDNhMaaryF3oyfkBdjpCnedmWNvo7bod3zhV?cluster=devnet)) |
| **Milestone M1: Compute Units** | `place_order` Per-User Placement | **10,552 – 13,243 CU** | **[MEASURED]** (Target $\le 60,000$ CU) |
| **Milestone M1: Compute Units** | `settle_users` Paged Settlement | **14,791 – 28,380 CU** | **[MEASURED]** (Target $\le 400,000$ CU) |
| **Milestone M2: Differential** | Golden Vectors Parity (TS vs Rust Engine) | **1,001/1,001 Bit-for-bit** | **[MEASURED]** (0 mismatches across 1,001 vectors) |
| **Milestone M2: Differential** | Randomized Multi-Batch Stress Test | **10,000 Batches (0 drift)**| **[MEASURED]** (647,981 orders, 701M matched lots) |
| **Milestone M3: Integration** | Full Lifecycle with Nonzero Fills ($Q^* > 0$) | **10 lots (0.01 SOL, about $1.22)** | **[MEASURED]** (13 live Devnet transactions verified) |
| **Milestone M4: Continuous Soak**| Continuous Multi-Trader Soak on Devnet (30+ min) | **100% Invariants Verified** | **[MEASURED]** (Invariants I-1, I-4, I-12 passed) |
| **Latency: Slot Time** | Measured Average Devnet Slot Time | **238.67 ms/slot** | **[MEASURED]** (Measured over 3,000 slots & 15,058 samples) |
| **Latency: Close $\to$ Settle**| Close $\to$ Settle Duration (9 slots block distance) | **2,148 ms (9 slots)** | **[COMPUTED]** ($9 \times 238.67\text{ ms/slot}$ from chain block times) |
| **Latency: Client RTT** | Client Round-Trip Confirmation (Close $\to$ Settled) | **2,506 ms ($P_{50}$)** | **[MEASURED]** (Client wall-clock including RPC network transit) |
| **Ring Occupancy: Future**| Peak Open Future Batches in Ring ($L = 4$ live market; soak used $L = 3$) | **3 / 8 slots** | **[MEASURED]** (Continuous pressure soak used $L = 3$; live market uses $L = 4$) |
| **Ring Occupancy: Unsettled**| Peak Closed-Unsettled Batches in Ring | **1 / 8 slots** | **[MEASURED]** (Bundled clearing latency = 0 slots) |
| **Ring Occupancy: Total** | Peak Total Utilized Ring Slots | **4 / 8 slots (50% headroom)** | **[MEASURED]** (Continuous pressure soak used $L = 3$; live market uses $L = 4$) |
| **Taker Uniform Clearing Offset** | Single Clearing Price Offset (1.0 SOL taker vs Vault) | **21.00 bps** | **[COMPUTED]** (Spec §6.1 uniform clearing price, not pay-as-bid) |
| **Taker Protocol Fee** | Standard Taker Fee | **5.00 bps (0.05%)** | **[SOURCED: spec §2.1]** |
| **Taker Cost: One-Way** | Total One-Way Cost (1.0 SOL taker order) | **26.00 bps** | **[COMPUTED]** (21.00 bps offset + 5.00 bps fee) |
| **Taker Cost: Round-Trip**| Total Round-Trip Cost (1.0 SOL round-trip) | **52.00 bps** | **[COMPUTED]** ($2 \times 26.00\text{ bps}$) |
| **Vault Ladder Depth & VWAP** | 3-Rung Ladder (500@12, 1000@18, 2000@25) | **3.50 SOL · 21.1 bps VWAP** | **[COMPUTED]** ($(500\cdot 12 + 1000\cdot 18 + 2000\cdot 25)/3500$) |
| **Funding Period** | Calibrated on-chain parameter (`120,670` slots) | **8 h at measured devnet slot time** | **[COMPUTED]** ($28,800\text{ s} / 0.23867\text{ s/slot}$) |
| **Adverse selection (model)** | Maker Adverse Selection Reduction ($k = 5$ snipers) | **91.0% Reduction** | **[SIMULATED]** (Model result under stated assumptions; unit: per sniped fill) |
| **Adverse selection (model)** | Maker Adverse Selection Reduction ($k = 1$ sniper) | **53.8% Reduction** | **[SIMULATED]** (Model result under stated assumptions; unit: per sniped fill) |
| **Simulation S-5: Landing** | Target Batch Landing Reliability ($L = 4$) | **88.5% landed** | **[SIMULATED]** (Pessimistic simulation next to measured 87.9% on-time rate; calibrated with $L = 4$) |
| **Invariant I-1: Balance** | Vault Balance $\equiv \sum(C + Q) + \text{fee} + \text{ins}$ | **0.00 micro-USDC Drift** | **[MEASURED]** (Bit-for-bit conservation down to dust) |
| **Invariant I-4: Volume** | Matched Volume Balance ($\sum \text{buy} \equiv \sum \text{sell} \equiv Q^*$) | **Bit-for-bit Identical** | **[MEASURED]** (Conservation of base lots) |
| **Invariant I-12: Rationality**| Clearing Tick Within Bid-Ask Crossing Overlap | **$t_a \le t^* \le t_b$** | **[MEASURED]** (Zero trade-through of limit orders) |
| **Acceptance UX-1..UX-21** | UI Acceptance Test Suite (Automated & Manual) | **19/19 automated pass; 2 manual checks pending (UX-6, UX-8)** | **[MEASURED]** (19 automated verified, 2 manual pending) |

---

## 4. Run It Yourself

Follow these exact steps from a fresh git clone to install, build, test, and run the complete Epoch protocol:

### Prerequisites
- **Rust & Cargo:** `1.89.0` (pinned in `rust-toolchain.toml`)
- **Solana CLI:** `3.0.15` (`solana-cli 3.0.15`)
- **Anchor CLI:** `0.32.0` (`avm use 0.32.0`)
- **Bun:** `1.3.11` or newer (`curl -fsSL https://bun.sh/install | bash`)

### Step 1: Repository Setup
```bash
git clone https://github.com/JatinSharma222/Epoch.git
cd Epoch
bun install
```

### Step 2: Build & Test On-Chain Program
```bash
anchor build
cargo test
```
*Result:* Compiles the BPF program binary and executes 59 Rust unit tests verifying uniform price clearing, linear inventory skew, and mathematical conservation invariants (59 / 59 passed).

### Step 3: Build Autonomous Keeper Daemon
```bash
cd keeper
bun install
bun run build
cd ..
```
*Result:* Compiles the TypeScript keeper daemon with Hermes Pyth streaming and automated batch clearing.

### Step 4: Build Headless Trading Frontend
```bash
cd app
bun install
bun run build
cd ..
```
*Result:* Generates the production Next.js 14 static and server bundles (0 lint errors, 0 type errors).

### Step 5: Run Pre-Flight System Health Check
```bash
bun run scripts/preflight.ts
```
*Result:* Queries Solana Devnet and confirms 7/7 health dimensions: live program ID, keeper and admin balances, Pyth oracle freshness, keeper liveness, two-sided vault quoting, vault inventory limits, and ring buffer accounts.

### Step 6: Demonstration Walkthrough & State Reset
```bash
bun run scripts/reset_demo_state.ts
```
*Result:* Verifies demo wallet balances, inspects Backstop Vault inventory, and rebalances the vault to flat (0 lots) through the on-chain auction pipeline to guarantee clean demonstration conditions. Full step-by-step test instructions are detailed in [`docs/DEMO_WALKTHROUGH.md`](docs/DEMO_WALKTHROUGH.md).

---

## 5. Known Limitations

Per the security analysis in [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) and [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md):

- **What Epoch Solves (Eliminated by Construction):**
  1. Intra-batch ordering sandwiches: Banned mathematically because all orders execute at the identical uniform price $P^*$.
  2. Priority-gas wars: Arrival order inside a batch grants no priority (landing before the close still matters).
  3. Toxic intra-batch reordering: Matched lots are allocated via deterministic pro-rata math with integer-exact dust rules.
- **What Epoch Does NOT Solve (Threat R4 Boundary):**
  1. Last-look informational advantage: An actor observing external centralized exchange price jumps at $t = T_{close} - 50$ms can submit late orders into the closing batch against resting quotes. This informational latency advantage is not eliminated.
  2. Oracle update latency: Pyth oracle updates reflect external venue prices with finite latency. Makers must maintain spread buffers (e.g. 12 bps) to offset adverse selection.
- **Architectural & Operational Boundaries:**
  - **128 Orders per Batch:** Zero-copy layout fixed at 128 orders to fit within Solana account size and single-transaction CU limits.
  - **Ring Buffer Size ($R=8$):** Lookahead window set to $L=4$ batches (~1.91 s) on the live market account (pressure soak tested at $L=3$) within the $R=8$ ring buffer to prevent ring collisions.
  - **Max Clearing Delay:** Batches un-cleared after 20 slots ($4.78\text{ s}$) expire stale and can be permissionlessly voided via `expire_and_release`.
  - **Paged Settlement:** Batches with $>16$ users unbundle into distinct `clear_batch` and `settle_users` transactions.
  - **Admin Surface:** No privileged backdoor instructions exist for the admin to arbitrarily edit user positions, collaterals, or balances outside the standard invariant-constrained state machine (deposit, withdraw, auction settlement, and liquidation). Vault rebalancing proceeds exclusively through the standard auction crossing pipeline.
  - Complete details are documented in [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md).
- **Deployment Scope:** Standalone devnet research prototype. Mainnet deployment is out of scope.

---

## 6. Roadmap

Epoch is under active development as a standalone research prototype. Phased development priorities include:

- **Phase 0 — Hygiene & Standalone Reframing (Current):** Reframing documentation and UI strings, establishment of `v0.1.0-devnet` release, link integrity verification.
- **Phase 1 — Operational Reliability & 24h Soak:** Systemd hosted keeper daemon with telemetry, balance guards, and 24-hour uninterrupted continuous soak validation on devnet.
- **Phase 2 — Mechanism Refinement & Economics:** Empirical oracle lag measurement vs. CEX price jumps, market-maker adverse selection modeling, and cryptographic commit-reveal research for Threat R4.
- **Phase 3 — Multi-Market & Production Scaling:** Multi-market collateral sharing, sharded batch account structures beyond 128 orders, and third-party security audits.

For comprehensive milestone targets and technical criteria, see the complete [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## 7. License & Attribution

This project is licensed under the [ISC License](LICENSE). Full academic and open-source software citations are documented in [`ATTRIBUTION.md`](ATTRIBUTION.md). Per-asset vector graphics are open source under MIT / CC0 licenses detailed in [`app/public/icons/ATTRIBUTION.md`](app/public/icons/ATTRIBUTION.md).
