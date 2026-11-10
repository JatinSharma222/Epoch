# Epoch Protocol — Gate G3 Devnet Deployment-Readiness Plan

**Document Version:** 1.0.0  
**Target Gate:** Gate G3 (Solana Devnet Live Deployment & Cranker Verification)  
**Branch Baseline:** `feat/epoch-protocol-hardening` (`3cc7549e5eb6d747bc78faf996878235c6e02a02`)  
**Network Target:** Solana Devnet Exclusively (`https://api.devnet.solana.com`)  
**Status:** **PLANNING ONLY — AWAITING SEPARATE EXPLICIT USER AUTHORIZATION**  
**Execution Boundary:** Zero Devnet transactions, zero deployments, and zero key broadcasts permitted during review.

---

## Executive Summary

This Deployment-Readiness Plan defines the exact technical procedure, operational controls, safety boundaries, and post-deployment acceptance criteria for transitioning Epoch Protocol from Gate G2 (Local Integration) to Gate G3 (Solana Devnet Deployment & Cranker Soak).

The protocol architecture, smart contracts, keeper daemon, and off-chain harnesses have been hardened and verified during Gate G2 (196 Rust tests passing, 12 Keeper resilience tests passing, 62 Anchor integration tests passing, zero clippy warnings, and worst-case 128-order clearing at 37,851 CU with 93.7% headroom).

Gate G3 execution will commence **only after explicit written authorization from protocol stakeholders**.

---

## 1. Deployment Artifact & Program ID Verification

### 1.1 SBF Binary Artifacts
- **Primary Binary File:** `target/deploy/epoch.so`
- **Build Mode:** Production Stripped (`default` feature set, no `devnet-faucet` compilation)
- **Binary Size:** **647,304 bytes** (clean build)
- **SHA-256 Checksum:** `15e3f1fb5b3f29fe5892a0daba8b51da9bd2451ff5d7b906ca33805d2ca2ab42`
- **Bytecode Inspection Verification:**
  ```bash
  strings target/deploy/epoch.so | grep "faucet.rs" || echo "FAUCET NOT IN BINARY"
  # Expected: FAUCET NOT IN BINARY (zero dead code, zero unauthorized minting)
  ```

### 1.2 Program ID & Keypair Binding
- **On-Chain Program ID:** `ER8SSfvp7roW6asG429Uv3mHY1aEd1jxGBdigLu27284`
- **Deploy Keypair Location:** `target/deploy/epoch-keypair.json`
- **Public Key Derivation:**
  ```bash
  node -e '
  const fs = require("fs");
  const { Keypair } = require("./node_modules/@solana/web3.js");
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("target/deploy/epoch-keypair.json"))));
  console.log("Program ID:", kp.publicKey.toBase58());
  '
  # Expected: ER8SSfvp7roW6asG429Uv3mHY1aEd1jxGBdigLu27284
  ```
- **Source Alignment:**
  - `programs/epoch/src/lib.rs`: `declare_id!("ER8SSfvp7roW6asG429Uv3mHY1aEd1jxGBdigLu27284");`
  - `Anchor.toml`: `[programs.devnet] epoch = "ER8SSfvp7roW6asG429Uv3mHY1aEd1jxGBdigLu27284"`
  - `app/src/lib/constants.ts`: `export const PROGRAM_ID = new PublicKey("ER8SSfvp7roW6asG429Uv3mHY1aEd1jxGBdigLu27284");`

---

## 2. Upgrade Authority & Key Management

### 2.1 Role & Keypair Segregation

| Role | Keypair Path | Description | Minimal Balance | Permissions |
|---|---|---|---|:---:|
| **Deployer / Upgrade Authority** | `~/.config/solana/epoch-v1-keys/epoch-authority-keypair.json` | Holds program upgrade authority & deployment buffer rights | 5.0 SOL | `0600` |
| **Market Admin** | `~/.config/solana/epoch-v1-keys/epoch-authority-keypair.json` | Owns `Market` PDA, updates parameters, pauses trading | 1.0 SOL | `0600` |
| **Cranker / Keeper Fee-Payer** | `~/.config/solana/epoch-v1-keys/epoch-keeper-keypair.json` | Permissionless batch clearance, settlement, and ADL | 2.0 SOL | `0600` |
| **Backstop Vault Authority** | `~/.config/solana/epoch-v1-keys/epoch-vault-authority-keypair.json` | Places backstop liquidity ladder (`vault_quote`) | 1.0 SOL | `0600` |
| **Oracle Authority (Fallback)**| `~/.config/solana/epoch-v1-keys/epoch-oracle-authority-keypair.json`| Fallback price feeder if Pyth Devnet cluster is down | 0.5 SOL | `0600` |

### 2.2 Filesystem Security Audit
Prior to any Devnet interaction, verify all keypair files enforce non-world-readable Unix permissions:
```bash
chmod 0700 ~/.config/solana/epoch-v1-keys
chmod 0600 ~/.config/solana/epoch-v1-keys/*.json
ls -la ~/.config/solana/epoch-v1-keys/
```

---

## 3. Devnet Deployment & Rollback Procedures

### 3.1 Pre-Deployment Buffer Allocation
To guarantee atomic deployment and prevent partial transaction failure due to Devnet RPC packet loss, all deployments utilize Solana's two-phase buffer workflow:

```bash
# Step 1: Write SBF bytecode to an uncommitted buffer
solana program write-buffer target/deploy/epoch.so \
  --url https://api.devnet.solana.com \
  --keypair ~/.config/solana/epoch-v1-keys/epoch-authority-keypair.json

# Step 2: Set buffer authority to the deployer keypair
solana program set-buffer-authority <BUFFER_ADDRESS> \
  --new-buffer-authority ~/.config/solana/epoch-v1-keys/epoch-authority-keypair.json \
  --url https://api.devnet.solana.com

# Step 3: Verify buffer integrity and byte count
solana program show --buffers --url https://api.devnet.solana.com
```

### 3.2 Atomic Program Upgrade
```bash
# Step 4: Deploy buffer atomically into the existing Program ID
solana program deploy \
  --program-id target/deploy/epoch-keypair.json \
  --buffer <BUFFER_ADDRESS> \
  --upgrade-authority ~/.config/solana/epoch-v1-keys/epoch-authority-keypair.json \
  --url https://api.devnet.solana.com
```

### 3.3 Rollback Strategy
1. **Immediate Bytecode Inconsistency:** If post-deployment verification fails, deploy the previously verified bytecode buffer retained in `target/deploy/backup/epoch_v1_backup.so`.
2. **Buffer Cancellation:** If buffer writing stalls or fails mid-way, close the buffer to reclaim rent lamports:
   ```bash
   solana program close <BUFFER_ADDRESS> --url https://api.devnet.solana.com
   ```
3. **Emergency Circuit Breaker:** If runtime issues arise post-deployment, invoke emergency pause via `update_market_params` setting `is_active = 0`.

---

## 4. Market Initialization & Configuration

### 4.1 Fresh Market Initialization Script
- **Harness:** `scripts/init_fresh_market.ts`
- **Execution Target:** `initialize_market` instruction on `ER8SSfvp7roW6asG429Uv3mHY1aEd1jxGBdigLu27284`

### 4.2 Initial Parameter Baseline (`MarketParams`)

| Parameter | Baseline Value | Units / Scale | Rationale |
|---|:---:|---|---|
| `batch_slots` | **20** | Slots (~8.0 seconds) | Balances batch liquidity aggregation with interactive UX |
| `max_clear_delay_slots` | **30** | Slots (~12.0 seconds) | Devnet slot jitter allowance (reconciled in OF-03) |
| `k_ticks` | **101** | Integer | Symmetric price band: $\pm 50$ basis points around oracle |
| `tick_bps` | **1** | Basis points (0.01%) | 1 bp per tick grid resolution |
| `imr_bps` | **1000** | Basis points (10.0%) | 10x maximum nominal leverage |
| `mmr_bps` | **500** | Basis points (5.0%) | 20x liquidation threshold |
| `fee_bps` | **5** | Basis points (0.05%) | 5 bps taker fee |
| `liq_penalty_bps` | **100** | Basis points (1.0%) | 1% penalty routed to Insurance Fund |
| `max_oracle_age_secs`| **60** | Seconds | Devnet network latency tolerance |
| `max_conf_bps` | **20** | Basis points (0.20%) | Max allowed Pyth confidence interval width |
| `max_orders_per_batch`| **128** | Orders | Hard bound on order ring storage |
| `funding_period_secs`| **28,800** | Seconds (8 hours) | Standard perpetual funding normalization period |
| `funding_cap_bps` | **50** | Basis points (0.50%) | Maximum funding clamp per 8-hour epoch |

### 4.3 Ring Buffer PDA Initialization
The market requires 8 sequential ring buffer accounts (`ring_index` 0..7) to enable continuous circular batching:
- **Derivation:** `PDA(["batch", market_pda, ring_index], program_id)`
- **Initialization:** Sequentially invoke `initialize_batch(ctx, ring_index, batch_id)` for `ring_index = 0..7`.

---

## 5. Backstop Vault Funding Controls

### 5.1 Vault Initialization & Role
- **Instruction:** `initialize_vault_user`
- **PDA:** `PDA(["vault_user", market_pda], program_id)`
- **Role:** Backstop liquidity provider placing two-sided quoting ladders to ensure every batch has executable counter-liquidity.

### 5.2 Funding Capitalization Strategy
1. **Mock USDC Collateral:**
   - Mint initial test collateral (50,000 mock USDC = $50,000 \times 10^6$ units).
   - Deposit collateral into the vault via `fund_vault` instruction.
2. **Backstop Vault Parameter Calibration (`VaultParams`):**
   - `quote_offset_bps`: `[3, 6, 10]` (rungs at $\pm 3$, $\pm 6$, $\pm 10$ bps from oracle).
   - `quote_lots`: `[10, 20, 30]` (lot sizes per rung).
   - `max_inventory_lots`: **1,000 lots** (1.0 SOL total inventory cap).
   - `skew_bps`: **5 bps** (dynamic quote skew per inventory shift).
   - `max_conf_bps`: **15 bps** (vault quote halt threshold).
   - `is_active`: **1** (active quoting enabled).
3. **Double-Entry Balance Sheet Invariant Check:**
   - Confirm Invariant **I-1** on startup: $\text{VaultBalance} == \sum C_i + \text{InsuranceFund} + \text{FeePool} - \text{BadDebt}$.

---

## 6. Pyth Oracle Connectivity & Freshness Monitoring

### 6.1 Pyth Devnet Configuration
- **Pyth Receiver Program:** `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`
- **SOL/USD Price Feed Account:** `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`
- **Pyth Feed ID:** `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`
- **Hermes Price Service:** `https://hermes.pyth.network`

### 6.2 Pre-Flight Oracle Validation Procedure
Before launching the keeper daemon, execute `scripts/verify_pyth.ts`:
1. Verify Pyth price update account owner matches Pyth Receiver.
2. Verify Feed ID matches SOL/USD feed ID.
3. Verify on-chain publish time:
   $$t_{\text{current}} - t_{\text{publish}} \le 30\text{ seconds}$$
4. Verify price confidence:
   $$\frac{\text{conf} \times 10,000}{\text{price}} \le 20\text{ bps}$$

---

## 7. Keeper Startup, Recovery & Alerting

### 7.1 Keeper Daemon Orchestration
The production keeper runs via Bun with structured logging and automatic process restart:
```bash
# Environment configuration
export EPOCH_RPC_URL="https://api.devnet.solana.com"
export EPOCH_WS_URL="wss://api.devnet.solana.com"
export EPOCH_PROGRAM_ID="ER8SSfvp7roW6asG429Uv3mHY1aEd1jxGBdigLu27284"
export EPOCH_KEEPER_KEYPAIR_PATH="$HOME/.config/solana/epoch-v1-keys/epoch-keeper-keypair.json"
export EPOCH_KEEPER_INTERVAL_MS=1000

# Launch keeper daemon
bun run keeper/src/index.ts
```

### 7.2 Boot-Time Reconciliation & Resilience Safeguards
1. **On-Chain Boot Reconciliation (T-G2-03):** Keeper reads `market.next_batch_to_clear` directly from the RPC and syncs local state before processing new slots.
2. **Slot Freshness Watchdog (T-G2-02):** If WebSocket slot updates stall for $> 2,500\text{ ms}$, keeper automatically polls HTTP `getSlot({ commitment: "processed" })` and triggers WebSocket resubscription.
3. **HTTP 429 Exponential Backoff (T-G2-02):** Upon encountering RPC rate limits (429), keeper applies jittered exponential backoff:
   $$\text{Backoff}(attempt) = \min(2^{attempt} \times 100\text{ ms} + \text{rand}(0, 50), 2000\text{ ms})$$
4. **Durable Idempotency & Lost Confirmation Recovery (T-G2-03):** Keeper tracks in-flight signatures; if an RPC disconnects, keeper queries `getSignatureStatuses` before retrying to prevent duplicate execution.
5. **Pre-Broadcast MTU Guard (T-G2-04):** ADL transactions are chunked to $K \le 16$ counterparties (956 bytes) and guarded against exceeding 1,232 bytes.

---

## 8. Live Monitoring, Failure Thresholds & Emergency Shutdown

### 8.1 Critical Telemetry & Health Metrics

```
+--------------------------------------------------------------------------+
|                       EPOCH DEVNET HEALTH MONITOR                         |
+-----------------------------------+--------------------------------------+
| Metric Name                       | Nominal Healthy Range                |
+-----------------------------------+--------------------------------------+
| Batch Landing Latency             | <= 3 slots after close_slot          |
| Batch Clearance Success Rate      | >= 90% (excluding planned pauses)    |
| Protocol Bad Debt (bad_debt)      | EXACTLY 0 micro-USDC                 |
| Backstop Vault Inventory          | -800 lots <= Inventory <= +800 lots  |
| Keeper SOL Gas Balance            | >= 0.50 SOL                          |
| Pyth Price Feed Latency           | <= 20 seconds                        |
+-----------------------------------+--------------------------------------+
```

### 8.2 Failure Thresholds & Automated Circuit Breakers

| Condition | Severity | Automated Action | Operator Action |
|---|:---:|---|---|
| **> 5 Consecutive Void Batches** | HIGH | Alert via webhook; check Pyth feed | Inspect Devnet Pyth relay; verify slot drift |
| **Keeper Gas < 0.20 SOL** | MEDIUM | Alert via webhook | Airdrop / transfer SOL to keeper keypair |
| **Protocol Bad Debt > 0** | CRITICAL | Emergency halt: invoke pause | Investigate liquidation accounting invariant |
| **Vault Inventory at Limit (1,000 lots)**| MEDIUM | Vault skips quotes (`INVENTORY_EXHAUSTED`)| Rebalance vault via `rebalance_vault.ts` |
| **RPC 429 Exhaustion** | MEDIUM | Fallback to secondary RPC endpoint | Switch `EPOCH_RPC_URL` to alternate provider |

### 8.3 Emergency Shutdown Procedure
If an unrecoverable protocol invariant violation is detected:
1. Admin executes `scripts/emergency_pause.ts`:
   - Calls `update_market_params` setting `is_active = 0`.
   - Calls `update_vault_params` setting `is_active = 0`.
2. All new order placement (`place_order`) and batch clearance (`clear_batch`) immediately reject.
3. Existing open orders are safely expired and refunded via `expire_and_release`.
4. Flat user collateral withdrawals (`withdraw`) remain permanently enabled.

---

## 9. Post-Deployment Verification & Acceptance Criteria

### 9.1 Phase A: Automated Pre-Flight Health Check
Execute `bun run scripts/preflight.ts`. Every subsystem must output `[PASS]`:
1. `[PASS]` **Program ID:** Executable on Devnet and matches `ER8SSfvp...`.
2. `[PASS]` **Wallet Balances:** Admin $\ge 0.50\text{ SOL}$, Keeper $\ge 0.50\text{ SOL}$.
3. `[PASS]` **Oracle Freshness:** Pyth price feed age $\le 30\text{s}$, confidence $\le 20\text{ bps}$.
4. `[PASS]` **Keeper Liveness:** Cranker responding and tracking slot progression.
5. `[PASS]` **Vault Quoting:** Two-sided quoting ladder active.
6. `[PASS]` **Vault Inventory:** Inventory within bounds ($< 1,000\text{ lots}$).
7. `[PASS]` **Ring Buffer:** All 8 ring slots initialized and deserializable.

### 9.2 Phase B: Live End-to-End Trading Smoke Test
Execute `bun run scripts/gate_g3_live_devnet.ts`:
1. User 1 deposits mock USDC collateral.
2. Backstop vault quotes bid/ask ladder into target batch.
3. User 1 submits crossing BUY order.
4. Keeper executes `clear_batch` with non-zero match ($Q^* > 0$).
5. Keeper executes `settle_users` (paged settlement).
6. Verify User 1 base position $> 0$ and collateral updated on-chain.
7. User 1 submits closing order in next batch to flatten position.
8. User 1 calls `withdraw` and receives exact principal $\pm$ realized PnL.
9. Verify all transaction signatures land with Explorer links.

### 9.3 Gate G3 Acceptance Sign-Off Criteria
Gate G3 will be declared complete when:
- Program is successfully deployed and verified on Devnet.
- Market and 8 ring slots are initialized with clean state.
- Backstop vault is funded and quoting two-sided liquidity.
- Keeper runs autonomously for at least 50 consecutive batches.
- Zero bad debt is incurred.
- Full evidence dossier of Devnet transaction signatures is compiled and signed off by all six engineering workstreams.

---

## Summary Confirmation

> [!CAUTION]
> **GATE G3 REMAINS UNAUTHORIZED:**
> This document is a deployment-readiness planning artifact only. No Devnet transactions, program deployments, market initializations, or vault fundings have been or will be executed without separate explicit user authorization.
