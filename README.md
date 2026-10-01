# Epoch

> A **Frequent Batch Auction (FBA)** perpetual-futures exchange on Solana (devnet). Orders are priced relative to a Pyth oracle and cleared **on-chain** at **one uniform price per batch**, eliminating priority-fee racing inside an auction window.

[![CI Check](https://img.shields.io/badge/make-check-green.svg)](Makefile)
[![Network](https://img.shields.io/badge/Solana-Devnet-blue.svg)](https://explorer.solana.com/?cluster=devnet)
[![Colosseum](https://img.shields.io/badge/Colosseum-Crypto_World's_Fair_2026-orange.svg)](https://colosseum.com)

---

## What It Is

Conventional decentralized perpetual exchanges process trades serially in continuous time. This creates a latency arms race where traders compete via priority fees, Jito tips, and validator co-location to extract value.

Epoch restructures execution into discrete time intervals:

1. **Batches:** Time is divided into discrete windows (default: 2 slots, ~800 ms).
2. **Oracle-Relative Orders:** Traders submit limit orders priced as an offset in basis points relative to the Pyth oracle (e.g., "buy up to oracle + 4 bps"). Quotes automatically move with the market and expire cleanly at the end of their target batch.
3. **On-Chain Uniform Price Clearing:** When a batch closes, anyone can call `clear_batch`. The Solana program aggregates the supply and demand curves across discrete price ticks and computes the single crossing price that maximizes matched volume.
4. **Uniform Execution:** Every order executed within a batch fills at the **exact same uniform clearing price**. Intra-batch arrival order does not affect fill price.
5. **Paged Settlement:** Fills settle to user accounts permissionlessly across paged transactions.

## Honest Claims & Boundary Conditions

Per the project threat model (`context/03-THREAT_MODEL.md`):

- **What Epoch provides:** Eliminates intra-batch transaction ordering advantage. Eliminates ordering-based sandwich attacks. Fills are deterministic and verified against an independent Rust reference engine. No trusted off-chain solver is required.
- **What Epoch does not eliminate:** Oracle lag remains an open risk for market makers when external venues move faster than the oracle update cadence. Visible orders allow late participants to evaluate visible liquidity before batch closure (bounded by an oracle collar). Censorship by block leaders remains possible.
- **Environment:** Devnet only. Mainnet deployment is out of scope.

## Repository Layout

```
Epoch/
├── programs/epoch/      # Anchor program on Solana (zero-copy accounts)
├── crates/epoch-ref/    # Independent Rust reference engine & simulator
├── keeper/              # Permissionless keeper service (TypeScript / Bun)
├── indexer/             # Event indexer into Postgres (TypeScript / Bun)
├── api/                 # Read-only history and evidence API (TypeScript / Bun)
├── db/migrations/       # SQL schema migrations
├── docker/              # Dockerfiles for off-chain services
├── docker-compose.yml   # Multi-service setup (all prefixed `epoch`)
├── .env.example         # Environment template
├── app/                 # Next.js frontend interface
├── scripts/             # Measurement, verification, and latency harnesses
├── evidence/            # Raw benchmark data and verified logs
├── docs/                # Environment, decisions, changelog, and roadmap
└── Makefile             # Single-command verification (`make check`)
```

## Quickstart

### Prerequisites

- Rust `1.84+` (Host) and Solana CLI `3.0+` (Agave)
- Anchor CLI `0.32.0`
- Bun `1.1+`

### 1. Verification Suite (Single Command)

Runs code formatting, strict clippy linter, unit tests, and the local validator integration test:

```bash
make check
```

### 2. Verify Pyth Devnet Oracle Live Feed

Confirm the live Pyth SOL/USD feed on Solana devnet:

```bash
bun run scripts/verify_pyth.ts
```

### 3. Start Off-Chain Services (Docker)

All containers, networks, and volumes are isolated under the `epoch` namespace:

```bash
cp .env.example .env
docker compose -p epoch config
docker compose -p epoch up -d epoch-postgres
```

Shut down cleanly:

```bash
docker compose -p epoch down
```

## Program Details (Devnet)

- **Program ID:** `CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap`
- **Zero-Copy Batch Account Size:** 9,936 bytes (fits inside 10,240-byte Anchor initialization limit with 304 bytes margin)
- **Pyth SOL/USD Price Feed Account (Shard 0):** `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`

## Documentation

- [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) - Exact toolchain versions, pinned crates, and measured metrics.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) - Architectural Decision Records (ADRs) and Gate logs.
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) - Chronological development history.
- [`docs/FUTURE.md`](docs/FUTURE.md) - Post-hackathon architectural roadmap.
