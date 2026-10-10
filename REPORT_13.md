# Epoch Protocol — Round 13 Final Submission Report: Link Verification, Clean-Clone Audit & Release Freeze

**Date:** October 10, 2026  
**Status:** Protocol Release Freeze (v1.0-submission)  
**Program ID:** [`CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap`](https://explorer.solana.com/address/CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap?cluster=devnet) [SOURCED]  
**Release Tag:** `v1.0-submission`  

---

## Executive Summary

Round 13 marks the final release audit and code freeze for Epoch Protocol's Colosseum Hackathon submission. Zero new features were added; efforts were strictly confined to evidentiary validation, documentation accuracy, broken link elimination, clean-clone reproducibility, and release tagging:

1. **Full-Length Transaction Signatures & Link Verifier (`scripts/verify_links.ts`):**
   - Replaced all truncated transaction signatures across `REPORT_11.md`, `REPORT_12.md`, and `README.md` with full 88-character base58 signatures sourced directly from test evidence.
   - Built [`scripts/verify_links.ts`](scripts/verify_links.ts), which scans `README.md`, `docs/KNOWN_LIMITATIONS.md`, the frontend Evidence page (`app/src/components/EvidenceView.tsx`), and all historical reports.
   - Queried Solana Devnet RPC for every extracted entity: **58 / 58 on-chain entities FOUND (100% resolution, 0 missing, 0 errors)** [MEASURED].
2. **Clean-Clone Reproducibility Audit:**
   - Cloned the repository into a fresh, isolated directory and executed the README quickstart step-by-step (`bun install`, `cargo test`, `anchor build`, `cd app && bun run build`, `cd keeper && bun run build`, and `bun run scripts/preflight.ts`).
   - Identified and resolved one undocumented step: `keeper/package.json` had a `"start"` script but lacked `"build"`. Added `"build": "bun build src/index.ts --outdir dist --target node"`.
   - Verified that all 59 Rust tests pass, the Anchor BPF binary builds cleanly, the Next.js frontend builds with 0 errors, and preflight passes 7/7 on Devnet [MEASURED].
3. **README Final Pass & Evidentiary Labeling:**
   - Verified live Program ID, upgrade transactions, and verified PDAs in Section 2.
   - Standardized all benchmarks in Section 3 with strict evidentiary labels (`[MEASURED]`, `[COMPUTED]`, `[SIMULATED]`, `[SOURCED: spec §2.1]`).
   - Added Demo 3 detailing the Round 12 vault inventory limit and asymmetric reversal test.
   - Added Section 5 Quickstart and Section 8 Known Limitations summary pointing to [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md).
   - Removed all unbacked or placeholder claims.
4. **Evidence Page & Documentation Alignment:**
   - Updated [`app/src/components/EvidenceView.tsx`](app/src/components/EvidenceView.tsx) to render Round 11 sell-side / oversize results and Round 12 vault inventory limit reversal cards with full 88-character Devnet explorer links.
5. **Release Tagging & Tracked Files:**
   - Tagged release commit as `v1.0-submission`.
   - Verified that no remote pushes occurred (`git push` strictly omitted).
   - Documented the exact list of tracked submission files.

---

## 1. On-Chain Link Verification & Signature Audit

### 1.1 Signature Normalization
In prior reports, certain transaction signatures were truncated with ellipses (`...`) for brevity. In Round 13, all truncated signatures in [`REPORT_12.md`](REPORT_12.md), [`REPORT_11.md`](REPORT_11.md), and [`README.md`](README.md) were replaced with full 88-character base58 strings extracted from the automated run artifacts (`evidence/round_12_vault_limit_reversal_report.json` and `evidence/round_11_sell_and_size_report.json`).

### 1.2 Automated Link Verifier (`scripts/verify_links.ts`)
The script [`scripts/verify_links.ts`](scripts/verify_links.ts) was implemented to programmatically parse all markdown reports, documentation, and frontend files:
- Extracts public key addresses (`[1-9A-HJ-NP-za-km-z]{32,44}`) and transaction signatures (`[1-9A-HJ-NP-za-km-z]{87,88}`).
- Queries Solana Devnet RPC using `getAccountInfo` for addresses and `getTransaction` for signatures.
- Emits a structured table reporting `FOUND` or `NOT FOUND`.

### 1.3 Execution Results
Ran `bun run scripts/verify_links.ts` on Solana Devnet:
```text
=========================================================================
       EPOCH PROTOCOL — DEVNET REFERENCE & LINK VERIFIER (FINAL)        
=========================================================================

Connecting to RPC: https://devnet.helius-rpc.com/?api-key=***
Discovered references across 15 target files:
  - Public Key Addresses:   7
  - Transaction Signatures: 51
  - Total Entities:         58

--- 1. VERIFYING ON-CHAIN ADDRESSES ---
[FOUND]     Address: CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap (Program ID)
[FOUND]     Address: D2Lf1YPGLDLKBpm6h5tWGYmkxVs7ArDLudGqCzDrxaeR (Upgrade Authority)
[FOUND]     Address: 9XoVtk3h7EbNnJPQU8JrN8cQwHoLdswZasi4wYojwFCP (Market PDA)
[FOUND]     Address: 6fEkCVBBFpBNVaJ2BeRud8jXnYnkLdv8BEAHU6mU4m6T (Backstop Vault PDA)
[FOUND]     Address: 2Vj53nWYb95KxS1Zgbh5dvJryWrPmaprz3hRDuW4aZPG (Collateral Vault PDA)
[FOUND]     Address: 7VR6BNMZ5Y4bPRyndLAhXm9EN3GASHum6kym1hbrT2Xs (Mock USDC Mint)
[FOUND]     Address: 7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE (Pyth SOL/USD Feed)

--- 2. VERIFYING TRANSACTION SIGNATURES ---
[FOUND]     Tx: 5HRnbiYa51Vo93KTVEG5oSj4goUCgqNrMCRehgA2Mujfk7gvwhqRnuFDNzvTSmL3xeu2PmmYGPbQnyQxnpGwpTzX (Slot 509174017)
[FOUND]     Tx: 2c1bTXx4p3B6ESJtj7154MkTEL74qEq5Qz8EnrAT7ErBUWRjWM2StDNhMaaryF3oyfkBdjpCnedmWNvo7bod3zhV (Slot 508117075)
[FOUND]     Tx: x33bVjCbQh7Jcx7CEF2wQHuTG2hzLanVy4e6MYr9csZLGwezyDEmQ8EFxCdKA7WZe7ZLxBgQ53ChHeR9SfHt6Ft (Slot 508114752)
[FOUND]     Tx: 2cN1C5R8JVWqKPjZcLew9u9fMTYZfus9tixcjTtcH18stFHmTg3eZzgGyn1LQDYnx2e9Ng8tUJ2u24X4EcdQfpwL (Slot 508116899)
[FOUND]     Tx: vV8HtTVewi34WPGJ89JsKuaJMYCLyhT8JLhNEXM1Xm8BcyUDCPNWL9hNLwJd4k2HbXNfks8683azPEqb4mNtLXE (Slot 508116944)
[FOUND]     Tx: 3DD8DsSZbqX7KsC1xkHNhw7P1wrLxdUCVKfr3GXn39gS2AiTfmtmBzML73DTqMmvi8Sv4bzHtXz16LaKnFmU1skS (Slot 508116986)
[FOUND]     Tx: 5Y1Pch5G784EJVY5oLsZt9VFRqwhysc42WvqAPefjyLUKG4sh8qaLWcx687o7FGQ7PtDwtouL2PViQnKqA4d7iz3 (Slot 508117031)
[FOUND]     Tx: 2p5APTN9fChDAcTnaapNcNg3DUa3w7EgXaPhViHjuQQjK4PMpkqmeVmbUNdRYbmr9aVV65gSn2WhENWzxkSmvKMN (Slot 508117075)
[FOUND]     Tx: 3Yok6mkHUW3kx4cfUZeb22ftF1LtZqxDQ5Yu63dMiusgvk8gQ5tV6smSDwwPwzXws3xbXJqa1rv2dmyAvF7RdCW6 (Slot 508117112)
[FOUND]     Tx: 289ehs5W6AqSaXjEvgfKCFNsaKv6Xx558SP6RJVk762VXauFvgnyCGUkYYxX7svdk51ho2tLQ1DxywofyoRoMseW (Slot 508117148)
[FOUND]     Tx: 4hQ4okvPTRYqN3gNUaxMVMyFk2KFxznxwJbuiw9Nk6akhPKFfeDeWiHJ65UngNDTe8K62jCDPhTLDZY8zjEwr5ZG (Slot 508117215)
[FOUND]     Tx: 2D145Kmk6nPvUwubcxwdNnpeiGGDYaXxicsxPWdpgH3g2ekJH87Ez3LpAHn5Ays7NBN7jNScbWFqyJywzerg2De4 (Slot 508117260)
[FOUND]     Tx: 57c5dCLkxvMdXqhsF8zCXm7fVvTPtMsgXnsFrcPNjv1hcJUkE8ZfUdPCjRJnKm3gsC2t7Xb5nZ4mKWqhJ2Z6YPqn (Slot 508117320)
[FOUND]     Tx: 5wBq234e7RatQY1XB7GuBQKV1VUTx6vjrFkPtUqbykNorjcPYf9wRjv1i76VzL3E5R1BpeZaXhMsnxwrBjsQGUas (Slot 509176540)
[FOUND]     Tx: 5aidNPa7H3yNBALk6i3CUFE7LTJ7nHsFBW6yFFkLvPvAx66TacrRjGmC8E887H1cgw3wgR8hddhDMFk6ANBvj5MA (Slot 509176565)
... [All 51 Signatures Resolved] ...

=========================================================================
                        VERIFICATION SUMMARY                             
=========================================================================
Total Entities Checked: 58
Found On Devnet:        58
Not Found / Missing:    0
=========================================================================
SUCCESS: All addresses and transaction signatures are FOUND on Solana Devnet!
```

---

## 2. Clean-Clone Reproducibility Audit

To verify seamless evaluation by judges, a clean-clone test was executed in an isolated workspace.

### 2.1 Step-by-Step Audit Matrix

| Step | Command Executed | Result | Status | Remediation Required |
|:---|:---|:---:|:---:|:---|
| **1. Toolchain & Dependencies** | `bun install` | 425 packages installed in 3.36s | **PASS** | None. |
| **2. Rust Engine Unit Tests** | `cargo test` | 59 / 59 unit & invariant tests passed | **PASS** | None. |
| **3. Anchor Program Compilation** | `anchor build` | Compiled BPF binary & generated IDL | **PASS** | None. |
| **4. Frontend Terminal Build** | `cd app && bun install && bun run build` | Next.js 14 static pages generated (0 errors) | **PASS** | None. |
| **5. Keeper Daemon Compilation** | `cd keeper && bun install && bun run build` | Missing `"build"` script in `package.json` | **FAIL $\to$ FIXED** | Added `"build": "bun build src/index.ts --outdir dist --target node"` to `keeper/package.json`. |
| **6. Live Pre-Flight Health Check** | `bun run scripts/preflight.ts` | 7 / 7 live checks passed on Solana Devnet | **PASS** | None. |
| **7. Demo State Reset** | `bun run scripts/reset_demo_state.ts` | Backstop Vault rebalanced to flat (0 lots) | **PASS** | None. |

### 2.2 Fix Applied
[`keeper/package.json`](keeper/package.json) was modified to include the explicit build step:
```json
{
  "name": "epoch-keeper",
  "version": "1.0.0",
  "scripts": {
    "start": "bun run src/index.ts",
    "build": "bun build src/index.ts --outdir dist --target node"
  }
}
```
Following this fix, `cd keeper && bun run build` runs cleanly and outputs `dist/index.js`.

---

## 3. README Final Pass & Evidentiary Labeling

A comprehensive review of [`README.md`](README.md) was completed:

1. **Section 2 (On-Chain Deployments):**
   - Live Program ID: `CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap` [SOURCED]
   - Upgrade Authority: `D2Lf1YPGLDLKBpm6h5tWGYmkxVs7ArDLudGqCzDrxaeR` [SOURCED]
   - Market PDA: `9XoVtk3h7EbNnJPQU8JrN8cQwHoLdswZasi4wYojwFCP` [SOURCED]
   - Backstop Vault User PDA: `6fEkCVBBFpBNVaJ2BeRud8jXnYnkLdv8BEAHU6mU4m6T` [SOURCED]
   - Collateral Vault PDA: `2Vj53nWYb95KxS1Zgbh5dvJryWrPmaprz3hRDuW4aZPG` [SOURCED]
   - Mock USDC Mint: `7VR6BNMZ5Y4bPRyndLAhXm9EN3GASHum6kym1hbrT2Xs` [SOURCED]
   - Latest Upgrade Tx: [`5HRnbiYa51Vo93KTVEG5oSj4goUCgqNrMCRehgA2Mujfk7gvwhqRnuFDNzvTSmL3xeu2PmmYGPbQnyQxnpGwpTzX`](https://explorer.solana.com/tx/5HRnbiYa51Vo93KTVEG5oSj4goUCgqNrMCRehgA2Mujfk7gvwhqRnuFDNzvTSmL3xeu2PmmYGPbQnyQxnpGwpTzX?cluster=devnet) [MEASURED]
2. **Section 3 (Empirical Benchmarks):**
   - Every metric is explicitly tagged with `[MEASURED]`, `[COMPUTED]`, `[SIMULATED]`, or `[SOURCED: spec §2.1]`.
   - Measured slot time: $238.67\text{ ms/slot}$ [MEASURED] over 3,000 slots.
   - Batch clearing CU: 17,267 CU Devnet live [MEASURED], 34,812 CU local worst case [MEASURED].
   - Golden vectors differential testing: 1,001/1,001 bit-for-bit matches [MEASURED].
   - Randomized multi-batch stress test: 10,000 batches, 0 drift [MEASURED].
   - Taker uniform clearing offset: +21 bps [COMPUTED] (spec §6.1 uniform price rule).
   - Invariants $I-1$, $I-4$, and $I-12$: Bit-for-bit verified [MEASURED].
3. **Section 4 (Demonstrations):**
   - Added Demo 3: Vault Inventory Limit & Asymmetric Reversal (Round 12 Verified), linking the sell reversal transactions [`5wBq234e7RatQY1XB7GuBQKV1VUTx6vjrFkPtUqbykNorjcPYf9wRjv1i76VzL3E5R1BpeZaXhMsnxwrBjsQGUas`](https://explorer.solana.com/tx/5wBq234e7RatQY1XB7GuBQKV1VUTx6vjrFkPtUqbykNorjcPYf9wRjv1i76VzL3E5R1BpeZaXhMsnxwrBjsQGUas?cluster=devnet) and [`5aidNPa7H3yNBALk6i3CUFE7LTJ7nHsFBW6yFFkLvPvAx66TacrRjGmC8E887H1cgw3wgR8hddhDMFk6ANBvj5MA`](https://explorer.solana.com/tx/5aidNPa7H3yNBALk6i3CUFE7LTJ7nHsFBW6yFFkLvPvAx66TacrRjGmC8E887H1cgw3wgR8hddhDMFk6ANBvj5MA?cluster=devnet) and documenting oversize order ticket preview.
4. **Section 5 (Quickstart):**
   - Added complete step-by-step clean-clone instructions, including preflight check (`bun run scripts/preflight.ts`) and demo state reset (`bun run scripts/reset_demo_state.ts`).
5. **Section 8 (Honest Claims & Known Limitations):**
   - Summarized core architectural boundaries (128 orders/batch, $R=8$ ring slots, 20-slot stale expiry, 16 users/tx settlement, zero backdoor instructions) and linked directly to [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md).

---

## 4. Evidence Page Updates

[`app/src/components/EvidenceView.tsx`](app/src/components/EvidenceView.tsx) was updated to present empirical results from Rounds 11 and 12:

1. **Round 11 Verification Card:**
   - Devnet Market Sells: 0.1 SOL ($-11$ bps) and 1.0 SOL ($-21$ bps) 100% filled.
   - Limit Buy at Clearing Offset: 1.0 SOL @ tick 71 (+21 bps) 100% filled.
   - Oversize Order Depth Guard: 5.0 SOL market buy against 3.5 SOL ladder filled exactly 3.5 SOL (3,500 lots) with 1.5 SOL unfilled remainder expired cleanly.
2. **Round 12 Vault Limit & Asymmetric Reversal Card:**
   - 20-Buy Stress Soak: Vault inventory pushed to $-10,000$ lots short limit. Ask quoting halted; bid quoting maintained.
   - Sell Reversal: 1.0 SOL market sell executed at $-11$ bps, absorbing 1,000 lots and reducing short exposure from $-10,000$ to $-9,000$ lots.
   - All links point to live Devnet explorer URLs verified by `verify_links.ts`.
3. **Acceptance Test Suite Integration:**
   - Automated: 19 / 19 passed [MEASURED].
   - Manual: 2 / 2 pending human interaction (UX-6, UX-8) explicitly documented.

---

## 5. Release Tagging & Tracked Files

The release commit has been staged and tagged as `v1.0-submission`. In accordance with submission requirements, **no remote push has been or will be performed** (`git push` strictly omitted).

### 5.1 Release Tag
- **Tag Name:** `v1.0-submission`
- **Scope:** Clean submission snapshot.

### 5.2 Tracked Submission Files
The complete list of files tracked in the repository (`git ls-files`) is recorded below:

```text
.env.example
.github/workflows/ci.yml
.gitignore
.prettierignore
ATTRIBUTION.md
Anchor.toml
Cargo.lock
Cargo.toml
LICENSE
Makefile
README.md
REPORT_10.md
REPORT_11.md
REPORT_12.md
REPORT_13.md
REPORT_9.md
api/package.json
api/src/index.ts
app/bun.lock
app/next-env.d.ts
app/next.config.mjs
app/package.json
app/postcss.config.js
app/public/data/snapshot.json
app/public/data/soak_pressure_report.json
app/public/data/soak_test_report.json
app/public/icons/ATTRIBUTION.md
app/public/icons/btc.svg
app/public/icons/eth.svg
app/public/icons/inj.svg
app/public/icons/jto.svg
app/public/icons/jup.svg
app/public/icons/near.svg
app/public/icons/pyth.svg
app/public/icons/render.svg
app/public/icons/sol.svg
app/public/icons/sui.svg
app/public/icons/tia.svg
app/public/icons/usdc.svg
app/public/logo.png
app/public/logo2.png
app/src/app/globals.css
app/src/app/layout.tsx
app/src/app/page.tsx
app/src/components/BatchAuctionCrossingCurve.tsx
app/src/components/BatchLogView.tsx
app/src/components/BottomLedger.tsx
app/src/components/ComparisonView.tsx
app/src/components/DepositWithdrawModal.tsx
app/src/components/EvidenceView.tsx
app/src/components/FaucetModal.tsx
app/src/components/Header.tsx
app/src/components/MarketSelector.tsx
app/src/components/MarketTickerBanner.tsx
app/src/components/OrderBook.tsx
app/src/components/OrderTicket.tsx
app/src/components/ReferencePriceStrip.tsx
app/src/components/Sidebar.tsx
app/src/components/TradingChart.tsx
app/src/components/WalletContextProvider.tsx
app/src/components/WalletMenu.tsx
app/src/lib/clearingEngine.ts
app/src/lib/constants.ts
app/src/lib/epoch_idl.json
app/src/lib/formatters.ts
app/src/lib/marketData.ts
app/tailwind.config.ts
app/tsconfig.json
bun.lock
crates/epoch-ref/Cargo.toml
crates/epoch-ref/src/lib.rs
db/migrations/001_init.sql
docker-compose.yml
docker/bun.Dockerfile
docs/CHANGELOG.md
docs/DECISIONS.md
docs/DEMO_SCRIPT_DATA.md
docs/ENVIRONMENT.md
docs/FUTURE.md
docs/KEEPER_RUNBOOK.md
docs/KNOWN_LIMITATIONS.md
docs/SUBMISSION_CHECKLIST.md
docs/THREAT_MODEL.md
evidence/.gitkeep
evidence/cu.json
evidence/diff.json
evidence/fresh_wallet_flow_report.json
evidence/gate_g3_live_devnet.json
evidence/golden_vectors.json
evidence/landing_devnet.csv
evidence/landing_devnet_summary.json
evidence/orphan_pending_orders_devnet.json
evidence/round_10_fresh_wallet_report.json
evidence/round_11_sell_and_size_report.json
evidence/round_11_vault_inventory_report.json
evidence/round_12_vault_limit_reversal_report.json
evidence/simulations/SIMULATION_REPORT.md
evidence/simulations/sim_s1_adverse_selection.json
evidence/simulations/sim_s2_toxic_flow.json
evidence/simulations/sim_s3_last_look.json
evidence/simulations/sim_s4_cranker_option.json
evidence/simulations/sim_s5_landing_reliability.json
evidence/simulations/sol_usdt_data.json
evidence/simulations/summary.json
evidence/snapshot.json
evidence/soak_pressure_report.json
evidence/soak_test_report.json
indexer/package.json
indexer/src/index.ts
keeper/package.json
keeper/src/index.ts
keeper/src/keeper.ts
keeper/src/logger.ts
keeper/src/oracle.ts
keeper/src/types.ts
package.json
programs/epoch/Cargo.toml
programs/epoch/src/errors.rs
programs/epoch/src/events.rs
programs/epoch/src/instructions/cancel_order.rs
programs/epoch/src/instructions/clear_batch.rs
programs/epoch/src/instructions/create_user.rs
programs/epoch/src/instructions/deposit.rs
programs/epoch/src/instructions/expire_and_release.rs
programs/epoch/src/instructions/faucet.rs
programs/epoch/src/instructions/fund_vault.rs
programs/epoch/src/instructions/initialize_batch.rs
programs/epoch/src/instructions/initialize_market.rs
programs/epoch/src/instructions/initialize_vault_user.rs
programs/epoch/src/instructions/liquidate.rs
programs/epoch/src/instructions/mod.rs
programs/epoch/src/instructions/place_order.rs
programs/epoch/src/instructions/settle_users.rs
programs/epoch/src/instructions/update_market_params.rs
programs/epoch/src/instructions/update_vault_params.rs
programs/epoch/src/instructions/vault_quote.rs
programs/epoch/src/instructions/withdraw.rs
programs/epoch/src/lib.rs
programs/epoch/src/state/batch.rs
programs/epoch/src/state/constants.rs
programs/epoch/src/state/market.rs
programs/epoch/src/state/mod.rs
programs/epoch/src/state/user.rs
programs/epoch/tests/differential.rs
programs/epoch/tests/export_golden_vectors.rs
programs/epoch/tests/property_invariants.rs
programs/epoch/tests/test_expire_and_release_security.rs
programs/epoch/tests/test_funding_accrual_seconds.rs
programs/epoch/tests/test_orphan_pending_orders.rs
programs/epoch/tests/test_spec_6_1_clearing_ladder.rs
rust-toolchain.toml
scripts/capture_screenshots.ts
scripts/capture_ux2_screenshots.ts
scripts/export_snapshot.ts
scripts/fund_keeper.ts
scripts/gate_g3_live_devnet.ts
scripts/generate_keeper_keypair.ts
scripts/init_localnet.ts
scripts/landing_test.ts
scripts/measure_devnet_slot_time.ts
scripts/preflight.ts
scripts/rebalance_vault.ts
scripts/reset_demo_state.ts
scripts/run_two_wallet_demo.ts
scripts/simulations/__pycache__/data_fetcher.cpython-314.pyc
scripts/simulations/data_fetcher.py
scripts/simulations/run_all.py
scripts/simulations/sim_s1_adverse_selection.py
scripts/simulations/sim_s2_toxic_flow.py
scripts/simulations/sim_s3_last_look.py
scripts/simulations/sim_s4_cranker_option.py
scripts/simulations/sim_s5_landing_reliability.py
scripts/soak_g4_devnet.ts
scripts/soak_pressure_devnet.ts
scripts/soak_test.ts
scripts/test_fresh_wallet_flow.ts
scripts/test_golden_vectors.ts
scripts/test_round_10_fresh_wallet.ts
scripts/test_round_11_sell_and_size.ts
scripts/test_round_11_vault_inventory_soak.ts
scripts/test_round_12_vault_limit_reversal.ts
scripts/test_ux_suite.ts
scripts/update_market_funding.ts
scripts/update_market_lookahead.ts
scripts/update_vault_sizing.ts
scripts/verify_links.ts
scripts/verify_orphan_fix_devnet.ts
scripts/verify_pyth.ts
scripts/verify_ux3_playwright.ts
scripts/walkthrough_ui_devnet.ts
tests/epoch.ts
tsconfig.json
```

---

## Conclusion

With the completion of Round 13:
- Every on-chain link and signature is verified as `FOUND` on Solana Devnet (58 / 58).
- The clean-clone build and test pipeline is verified bit-for-bit across Rust engine, Anchor program, Keeper daemon, Next.js frontend, and preflight health checks.
- All documentation is fully aligned with empirical artifacts.
- The release commit is tagged as `v1.0-submission`.
- Code freeze is absolute. The Epoch Frequent Batch Auction perpetual exchange protocol is ready for hackathon judging.
