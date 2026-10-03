# Epoch

<p align="center">
  <img src="app/public/logo.png" alt="Epoch Logo" width="380" />
</p>

<p align="center">
  <strong>Frequent Batch Auction (FBA) Perpetual Futures Exchange on Solana</strong><br />
  Uniform-price on-chain clearing that eliminates priority-fee racing and intra-batch sandwich MEV.
</p>

<p align="center">
  <a href="https://explorer.solana.com/?cluster=devnet"><img src="https://img.shields.io/badge/Solana-Devnet-blue.svg" alt="Solana Devnet" /></a>
  <a href="Makefile"><img src="https://img.shields.io/badge/Make-Check%20Passed-0ecb81.svg" alt="CI Check" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-ISC-blue.svg" alt="License" /></a>
  <a href="https://colosseum.com"><img src="https://img.shields.io/badge/Colosseum-Crypto_World's_Fair_2026-orange.svg" alt="Colosseum" /></a>
</p>

---

## What Is Epoch?

Conventional decentralized perpetual exchanges process trades serially in continuous time. This creates an aggressive latency arms race where high-frequency trading bots compete via priority fees, Jito tips, and validator co-location to extract value from everyday traders.

**Epoch** replaces continuous-time execution with discrete **Frequent Batch Auctions (FBA)** running natively on-chain on Solana:

1. **Discrete Auction Windows:** Time is split into discrete batch windows (default: 2 slots, ~800 ms).
2. **Oracle-Relative Limit Orders:** Traders submit limit orders as an offset in basis points relative to the Pyth oracle (e.g. *Buy up to Oracle + 4 bps*). Quotes automatically track market movement and expire cleanly at the end of their target batch, protecting market makers from stale-order sniping.
3. **On-Chain Uniform Price Clearing:** When a batch closes, the Solana program deterministically computes the single crossing price that maximizes matched volume.
4. **Uniform Execution:** Every order executed within a batch fills at the **exact same uniform clearing price**. Intra-batch arrival order within a slot provides zero fill price advantage.
5. **Backstop Vault & Inventory Skew:** Automated on-chain liquidity quoting ladder with Avellaneda-Stoikov style inventory skew and safety guards against stale or wide oracle feeds.
6. **Permissionless Liquidation:** Positions falling below Maintenance Margin Requirement (MMR = 500 bps) are closed out directly against the Backstop Vault at verified oracle mark price, routing penalties to the insurance fund and recording bad debt without socialized haircuts.
7. **Paged Settlement:** Fills settle to user accounts permissionlessly across paged transactions, releasing pending collateral and updating quote-ledgers with zero double-settlement vulnerability.

---

## Architecture & Verification Milestones

| Gate / Milestone | Status | Measured Empirical Result |
|---|---|---|
| **Gate G0: Toolchain** | **PASSED** | Zero-copy `Batch` account (9,928 bytes) within 10,240-byte ceiling; Pyth SOL/USD feed verified on-chain. |
| **Gate G1: Compute Units** | **PASSED** | `clear_batch` consumes **31,092 CU** at max load (128 orders, K=101 ticks). Well within 600,000 CU target. |
| **Gate G2: Differential Correctness** | **PASSED** | **10,000 randomized batches** (647,981 orders, 701M matched lots): **0 mismatches** against independent Rust reference engine. |
| **Gate G3: Full Integration** | **PASSED** | **52 end-to-end integration tests passing** covering order placement, auction clearing, paged settlement, keeper automation, backstop vault, and liquidations. |
| **Invariant I-1: Conservation** | **PASSED** | `Σ(collateral + quote) + fee_pool + insurance_fund = vault_balance` holds to the exact micro-USDC. |
| **Invariant I-4: Volume Balance** | **PASSED** | `Σ buy_filled == Σ sell_filled == Q*` verified across all batches. |
| **Invariant I-11: Bad Debt** | **PASSED** | Deficit absorption by insurance fund with exact bad debt ledger recording on undercollateralized liquidations. |

---

## Repository Structure

```
Epoch/
├── programs/epoch/      # Anchor program on Solana (zero-copy accounts, on-chain clearing)
├── crates/epoch-ref/    # Independent Rust reference engine & property tester
├── app/                 # Next.js 14 web trading terminal (Tailwind CSS, SVG crossing curve)
├── keeper/              # Standalone TypeScript keeper service (clearing, settlement, liquidation)
├── indexer/             # Event indexer into Postgres (TypeScript / Bun)
├── api/                 # Read-only history and evidence API (TypeScript / Bun)
├── db/migrations/       # PostgreSQL schema migrations
├── docker/              # Dockerfiles for off-chain services
├── docker-compose.yml   # Multi-service setup (isolated under `epoch` namespace)
├── scripts/             # Measurement, verification, and latency test scripts
├── evidence/            # Raw empirical benchmark logs (cu.json, diff.json)
├── docs/                # Architecture, threat model, environment, and changelog
└── Makefile             # Single-command verification (`make check`)
```

---

## Quickstart

### Prerequisites

- **Rust:** `1.84+` (Host) and Solana CLI `3.0+` (Agave)
- **Anchor CLI:** `0.32.0`
- **Bun:** `1.1+`
- **Node:** `v20+`

---

### 1. Run Complete Verification Suite

Runs formatting, clippy with zero warnings, unit tests, differential property tests, and local integration tests:

```bash
make check
```

Or run individual test suites:

```bash
# Unit, differential, and 1,000,000 random-case property tests
cargo test

# End-to-end Anchor integration test suite (52 tests)
anchor test
```

---

### 2. Launch Trading Terminal UI (`app/`)

Start the Next.js 14 trading dashboard locally:

```bash
cd app
bun install
bun run dev
```

Open **`http://localhost:3000`** in your browser to view:
- **Top Infinite Ticker:** Live prices across major perpetual markets.
- **Batch Countdown Widget:** Real-time Solana slot counter and batch closing progress bar.
- **Batch Auction Crossing Curve:** Interactive SVG step-curve showing live cumulative demand ($D[t]$) and supply ($S[t]$) crossing at equilibrium.
- **Order Placement Console:** Target batch lookahead selector, tick offset ($\pm 50$ bps), and margin calculations.
- **Portfolio & Collateral:** 1-click **"Airdrop $1,000 Mock USDC"** faucet button for instant demo trading, plus deposit and withdrawal controls.
- **Solana Wallet Adapter:** Connect Phantom or Solflare wallets.

---

### 3. Run Autonomous Keeper Service (`keeper/`)

The keeper autonomously monitors batch slots, clears closed batches, settles cleared batches in pages, quotes the backstop vault, and liquidates undercollateralized accounts:

```bash
cd keeper
bun install

# Run continuous loop
bun run src/index.ts --network devnet --interval-ms 1000

# Or execute a single execution tick
bun run src/index.ts --once
```

---

### 4. Verify Live Pyth Devnet Oracle Feed

Verify on-chain price and confidence freshness for Pyth's SOL/USD feed on Solana devnet:

```bash
bun run scripts/verify_pyth.ts
```

---

### 5. Start Off-Chain Infrastructure (Docker)

Start the PostgreSQL database and daemon services under the isolated `epoch` namespace:

```bash
cp .env.example .env
docker compose -p epoch up -d epoch-postgres
```

---

## On-Chain Program Details (Devnet)

- **Program ID:** `CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap`
- **Zero-Copy Batch Account Size:** 9,928 bytes (fits inside 10,240-byte Anchor initialization ceiling with 312 bytes margin)
- **Market State Size:** 384 bytes (16-byte aligned)
- **User Account Size:** 176 bytes (16-byte aligned)
- **Pyth SOL/USD Feed Account:** `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`

---

## Honest Claims & Boundary Conditions

Per the project threat model ([`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)):

- **What Epoch Solves:** Eliminates intra-batch transaction ordering advantage. Eliminates sandwich attacks within a batch. Guarantees uniform execution price for all matched orders. Fills are deterministic and verified against an independent Rust reference engine with zero mismatches. No trusted off-chain solver is required.
- **What Epoch Does Not Eliminate:** External venue oracle lag remains an inherent risk for market makers when external centralized exchanges move faster than the oracle update cadence. Block producers retain transaction inclusion censorship authority.
- **Deployment Scope:** Devnet hackathon prototype. Mainnet deployment is out of scope.

---

## Documentation

- [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) — Security analysis, attack vectors, and honest boundary conditions.
- [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) — Exact toolchain versions, pinned crates, and empirical measurements.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — Architectural Decision Records (ADRs) and Gate records.
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — Chronological development history (Tasks T-00 through T-15).
- [`docs/FUTURE.md`](docs/FUTURE.md) — Post-hackathon scaling and sharding roadmap.

---

## License

This project is licensed under the [ISC License](LICENSE).
