# Epoch Architecture Decisions & Gate Records

## Initial Gate Records

### Gate G0: Toolchain & Environment (2026-10-01)
- **Status:** PASSED [MEASURED]
- **Toolchain:** Rust 1.93.1 (system) / SBF rustc 1.84.1-dev, Solana CLI 3.0.15 (Agave), Anchor 0.32.0, Bun 1.3.11.
- **Crate Resolution Fixes:** Pinned `proc-macro-crate` to 3.2.0, `zeroize` to 1.8.1, `indexmap` to 2.7.0, and `unicode-segmentation` to 1.12.0 in `Cargo.lock` to avoid `edition2024` incompatibilities with SBF Cargo 1.84.0.
- **Zero-Copy Account:** Program compiles a 9,936-byte zero-copy `Batch` account (fits within Anchor's 10,240-byte initialization ceiling with 304 bytes margin).
- **Test:** `anchor test` passed on local validator (101ms).
- **Oracle Verification:** Pyth devnet SOL/USD price feed (`7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`) verified on-chain.

## Architecture Decision Records (Summary from Design Review)

| ID | Title | Status | Rationale |
|---|---|---|---|
| ADR-01 | Solana-only runtime, devnet target | DECIDED | Colosseum Solana Track scope and $0 devnet cost. |
| ADR-02 | Batch window defined by slot height | DECIDED | Program has no sub-slot clock; `Clock::get()?.slot` is strictly deterministic. |
| ADR-03 | On-chain clearing from tick aggregates | DECIDED | Solver-verification cannot verify omitted orders; on-chain clearing is trustless. |
| ADR-04 | Oracle-relative price grid in basis points | DECIDED | Quotes stay valid as oracle moves, mitigating multi-slot landing delay. |
| ADR-05 | Good-for-one-batch orders | DECIDED | Automatic expiry eliminates stale resting quotes and cancels. |
| ADR-06 | Price priority + pro-rata + deterministic dust | DECIDED | Uniform clearing with transparent FIFO dust rule. |
| ADR-07 | Quote-ledger position accounting | DECIDED | Guarantees exact conservation invariant $I_1$ without rounding loss. |
| ADR-08 | Mock USDC on devnet with faucet | DECIDED | Frictionless demo without reliance on external devnet faucets. |
| ADR-09 | No Hyperliquid runtime dependency | DECIDED | Eliminates cross-chain bridging failure points. |
| ADR-10 | Oracle mark price for margin and liquidations | DECIDED | Immune to intra-batch clearing price skew. |
| ADR-11 | Ring of 8 batch accounts, lookahead L=3 | DECIDED | Predictable rent, constant PDA addressing. |
| ADR-12 | Grid of K=101 ticks, 1 bp step, ±50 bps band | DECIDED | Sufficient depth for SOL perps while fitting compute budget. |
| ADR-13 | Keeper in TypeScript, reference engine in Rust | DECIDED | Fast Pyth pull SDK integration; independent Rust reference model. |
| ADR-14 | Postgres + Indexer + Read-only API | DECIDED | Non-authoritative history store; trading functions without it. |
| ADR-15 | Docker `epoch` prefix everywhere | DECIDED | Prevents resource collisions on local and test environments. |
| ADR-16 | Native toolchain with Docker services | DECIDED | High performance on Apple Silicon; Docker for off-chain services. |
