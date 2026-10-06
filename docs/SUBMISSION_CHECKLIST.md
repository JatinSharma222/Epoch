# Epoch Protocol — Colosseum Hackathon Submission Checklist

**Track**: DeFi & Trading Infrastructure  
**Protocol Version**: v0.1.0-devnet  
**Submission Status**: READY FOR REVIEW  

---

## 1. Core Submission Credentials & Links

| Asset | Value / Link | Verification Status |
| :--- | :--- | :--- |
| **Colosseum Track** | **DeFi & Trading Infrastructure** | Confirmed |
| **Program ID (Devnet)** | [`CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap`](https://explorer.solana.com/address/CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap?cluster=devnet) | Deployed & Active (Slot `508012057`) |
| **Deployer / Admin Authority** | [`D2Lf1YPGLDLKBpm6h5tWGYmkxVs7ArDLudGqCzDrxaeR`](https://explorer.solana.com/address/D2Lf1YPGLDLKBpm6h5tWGYmkxVs7ArDLudGqCzDrxaeR?cluster=devnet) | Key separated from operational cranker |
| **Keeper Cranker Authority** | [`EARRxREsGyHaeNwQmeaMnL6osLoyiwHsA5XSYqqQC5j2`](https://explorer.solana.com/address/EARRxREsGyHaeNwQmeaMnL6osLoyiwHsA5XSYqqQC5j2?cluster=devnet) | Funded on Devnet; automated quoting active |
| **Market PDA** | `[b"market"]` PDA | Initialized ($N=2$, $L=3$, 101 ticks) |
| **Trading Terminal UI** | Next.js 14 Web Application (`app/`) | Builds cleanly with `bun run build` |
| **Demo Walkthrough Video** | Screen recording in `research/review/ux3/` | Available |
| **Repository Visibility** | Public GitHub Repository | Publicly cloneable, all submodules clean |

---

## 2. Pre-Submission Hygiene Verification

- [x] **No Private Keys Committed**: Full git history scanned (`git log -p --all`). No keypairs (`*.json`), private keys, or seed phrases tracked in any commit.
- [x] **No `.env` Files Committed**: Git history verified; `.gitignore` contains `.env`, `.env.*`, and `.env.local`.
- [x] **Zero Hardcoded RPC API Keys**: All scripts and runbook configs ingest credentials via `process.env.EPOCH_RPC_URL` with public Devnet fallback (`https://api.devnet.solana.com`).
- [x] **Key Separation**: Upgrade authority (`D2Lf...`) is strictly isolated from the operational keeper keypair (`EARR...`).
- [x] **Consistent Time Units**:
  - Devnet slot duration measured: $238.67\text{ ms/slot}$ `[MEASURED]`.
  - Batch interval: $2\text{ slots} \approx 477\text{ ms}$.
  - Funding period: $28,800\text{ seconds}$ ($8\text{ hours}$), calibrated to $120,670\text{ slots}$.
  - Lookahead horizon: $3\text{ batches} = 6\text{ slots} = 1.43\text{ s}$.
  - Stale clear delay: $20\text{ slots} = 4.78\text{ s}$.

---

## 3. Test & Verification Suite Passing

- [x] **Unit & Integration Tests**: 22 program unit tests pass with `cargo test`.
- [x] **Differential Tests**: 10,000 differential clearing batches match Rust reference implementation (`tests/differential.rs`).
- [x] **Property Invariants**: Invariants I-1 (vault balance conservation), I-4 (buy fills = sell fills = Q*), and I-12 (single settlement per order) pass (`tests/property_invariants.rs`).
- [x] **Security Tests**: Permissionless stale batch voiding and release passes (`tests/test_orphan_pending_orders.rs` and `tests/test_expire_and_release_security.rs`).
- [x] **Funding Accrual Test**: Accrual scaled by unix timestamp seconds ($8\text{ h} = 28,800\text{ s}$) passes (`tests/test_funding_accrual_seconds.rs`).
- [x] **Frontend Production Build**: `cd app && bun run build` passes with zero TypeScript or ESLint errors.

---

## 4. Documentation & Judge Resources

- [x] [`README.md`](../README.md): Judge-facing overview with architectural diagrams, live addresses, verified metrics table, and setup guide.
- [x] [`docs/KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md): Transparent disclosure of v0 boundaries (capacity, ring size, single market, latency boundaries).
- [x] [`docs/KEEPER_RUNBOOK.md`](KEEPER_RUNBOOK.md): Complete operations runbook (non-root service, zero Solana CLI required, transfer funding, health log).
- [x] [`LICENSE`](../LICENSE): Apache-2.0 / MIT open source licensing.
- [x] [`ATTRIBUTION.md`](../ATTRIBUTION.md): Third-party libraries and academic papers credited (Budish et al. FBA, Avellaneda-Stoikov).

---

## 5. Cutoff Time & Final Review

- **Submission Cutoff**: End of Colosseum Hackathon Submission Window.
- **Verification Rule**: Strictly no `git push` from test agent; local commit and repository ready for human push.
