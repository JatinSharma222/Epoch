# Epoch Future Roadmap (Post-Hackathon & V2)

This document tracks architecture enhancements and features intentionally excluded from the initial Colosseum hackathon scope (per `01-ARCHITECTURE.md` Non-Goals and `04-BUILD_PLAN.md` Rule: "No new ideas after Oct 7; write them in `docs/FUTURE.md`").

## 1. Protocol Architecture & Performance

### Batch Account Sharding
- **Current Limit:** Single shared `Batch` account per auction period (write-lock contention ceiling at ~128 orders).
- **Future Design:** Partition order intake across $M$ shard accounts (e.g., sharded by user pubkey hash or order side) and execute a deterministic on-chain aggregation merge instruction prior to `clear_batch`.

### Buffer Expansion via Account Reallocation (`realloc`)
- **Current Limit:** 10,240-byte Anchor `init` limit limits static order capacity to 128 orders.
- **Future Design:** Dynamically grow batch accounts beyond 10 KB via Solana runtime `realloc` instructions as batch order count scales.

### Confidential & Commit-Reveal Auctions
- **Current Trade-Off:** Visible orderbook permits last-look informational sniping bounded by the oracle collar.
- **Future Design:** Implement threshold encryption / Timed-Commitment schemes or ElGamal confidentiality (Token-2022 confidential transfer extensions) to hide order size and offset until auction closure.

## 2. Market Structure & Margin

### Cross-Margin & Multi-Collateral
- **Current Design:** Isolated margin per market with mock USDC collateral.
- **Future Design:** Unified collateral vault supporting yield-bearing assets (e.g., LSTs like JitoSOL, tokenized T-Bills) with haircut-weighted borrowing power across multiple perpetual markets (SOL, BTC, ETH).

### Liquidation Socialization & Auto-Deleveraging (ADL)
- **Current Design:** Insurance fund absorbs bad debt; unbacked shortfalls are tracked on-chain as `bad_debt` metric without auto-deleveraging.
- **Future Design:** Implement tiered ADL priority queues to unwind winning counterparty positions if insurance fund balance reaches zero during extreme market gapping.

### Public LP Vaults
- **Current Design:** Team-funded backstop vault PDA quoting deterministic ladders for baseline demo liquidity.
- **Future Design:** ERC-4626 / SPL tokenized yield vaults enabling external liquidity providers to deposit passive collateral into automated market-making algorithms.

## 3. Decentralized Cranking Network

### Bonded Keeper Network with Slashing
- **Current Design:** Permissionless keeper execution on devnet without direct protocol fee incentives.
- **Future Design:** Stake-weighted bonded keeper protocol where keepers bond SOL to earn clearing fees and face slashing for submitting late or invalid oracle VAAs.
