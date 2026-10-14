# Epoch Protocol — Development Roadmap

Status: Active research & development prototype on Solana devnet.

Epoch is an experimental Frequent Batch Auction (FBA) perpetual futures exchange natively running on Solana. This document outlines current architecture status, known gaps, and phased development priorities for continuing evolution as a standalone research prototype.

---

## 1. Where Things Stand

### Implemented & Verified on Devnet
- **On-Chain Clearing Engine:** Deterministic discrete Frequent Batch Auction ($N = 2$ slots, ~477 ms cadence) computing uniform market-clearing tick ($P^*$) maximizing matched volume ($V_{max}$) and minimizing volume imbalance.
- **Settlement Pipelines:** Permissionless paged settlement (up to 16 users per page) and atomic bundled settlement for small batches.
- **Risk & Margin Accounting:** Maintenance margin requirements (500 bps), initial margin (1000 bps, 10x max leverage), and liquidation path against the Backstop Vault.
- **Protocol Liquidity:** Autonomous Backstop Vault quoting a passive ladder with linear inventory skew and hard inventory caps (-10,000 to +10,000 lots).
- **Autonomous Operations:** Dual-loop TypeScript keeper daemon tracking WebSocket slots, pushing Pyth Hermes updates, clearing closed batches, and settling fills.
- **Differential Test Engine:** Standalone TypeScript reference engine passing 1,001 bit-for-bit golden vector tests against the on-chain Rust program.
- **Headless Interface:** Production Next.js 14 trading terminal with real-time on-chain telemetry, crossing curve visualization, and zero backend database dependencies.

### Current Gaps & Boundaries
- **Single Market:** Currently live for SOL-PERP only (`docs/KNOWN_LIMITATIONS.md`).
- **Batch Capacity:** Zero-copy layout bounded at 128 orders per batch PDA to fit within Solana account size and single-transaction compute unit envelopes.
- **Oracle-Lag Exposure:** Passive resting quotes track the Pyth oracle but are exposed to external venue price jumps occurring within the closing slot window (Threat R4).
- **Devnet Scope:** Operational on Solana Devnet with test collateral and demo vault liquidity.

---

## 2. Development Phases

### Phase 0 — Hygiene & Standalone Reframing (Current)
- Establish standalone devnet research prototype framing across documentation, UI strings, and verification suites.
- Establish clean versioning tag (`v0.1.0-devnet`).
- Audit link integrity and verify zero exposed private keys or credentials across repository history.
- Run remaining manual UX evaluation procedures (UX-6, UX-8).
- **Exit Criteria:** Clean-clone build passes, full test suite green, link verifier confirms 100% on-chain references.

### Phase 1 — Operational Reliability & Hosted Telemetry
- Deploy keeper daemon to permanent hosted infrastructure with systemd monitoring, automated restart policies, and health alerts.
- Maintain continuous balance guards (warning below 3 SOL, halt quoting below 0.5 SOL) with automated telemetry.
- Execute 24-hour continuous soak test against devnet under simulated stochastic user flow.
- Investigate persistent indexer and query API (`indexer/`, `api/`) to complement direct RPC snapshots for historical trade charts.
- **Exit Criteria:** 24 hours of uninterrupted autonomous operation with zero invariant drift, zero stuck batches, and recorded latency percentiles.

### Phase 2 — Mechanism Refinement & Economic Modeling
- Quantify empirical oracle lag versus centralized exchange high-frequency trade prints.
- Formalize market-maker economics: simulate inventory half-life, adverse selection across variable batch durations ($N = 1, 2, 4$), and vault PnL under toxic flow.
- Research mitigations for last-look informational advantage (Threat R4), evaluating cryptographic commit-reveal schemes and encrypted transaction mempools.
- Expand formal mathematical proofs for uniform price optimality and pro-rata integer dust conservation.
- **Exit Criteria:** Published economic and risk analysis note with empirical devnet data; extended property test coverage.

### Phase 3 — Production Architecture & Scaling
- Support multi-market cross-margin collateral accounts with shared USDC margin vaults.
- Implement sharded batch PDAs allowing order book scaling beyond 128 orders per auction window.
- Oracle resilience: Multi-oracle aggregation (Pyth + Switchboard) with adaptive confidence interval collar gating.
- External security audits, formal verification of the clearing engine, and timelocked upgrade authority governance.
- **Exit Criteria:** Comprehensive third-party security audit report, public testnet with external market makers, and mainnet deployment readiness review.

---

## 3. Guiding Research Principles

- **Empirical Rigor Only:** Every performance metric must carry an explicit evidentiary label (`[MEASURED]`, `[COMPUTED]`, `[SIMULATED]`, `[ESTIMATE]`).
- **No Overclaiming:** No claims of "MEV-free" or "zero slippage". Honest disclosure of mechanism boundaries (such as oracle latency exposure and last-look arbitrage).
- **Spec-First Engineering:** Maintain strict separation between specification ([`docs/MECHANISM_SPEC.md`](MECHANISM_SPEC.md)), reference engine implementation, and on-chain Rust code.
