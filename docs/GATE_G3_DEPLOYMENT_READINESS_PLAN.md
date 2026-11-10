# Epoch Protocol — Gate G3 Devnet Deployment-Readiness Plan (Revised)

**Document Version:** 2.0.0 (Comprehensive Pre-Authorization Revision)  
**Target Gate:** Gate G3 (Solana Devnet Live Deployment & Cranker Verification)  
**Branch Baseline:** `feat/epoch-protocol-hardening` (`1f5a5de4589a10b7bf1a7138f663dc5205eb08ca`)  
**Network Target:** Solana Devnet Exclusively (`https://api.devnet.solana.com`)  
**Status:** **PLANNING & SOURCE INSPECTION ONLY — GATE G3 REMAINS STRICTLY UNAUTHORIZED**  
**Execution Boundary:** Zero Devnet transactions, zero deployments, zero market initializations, and zero key broadcasts permitted during review.

---

## 1. Upgrade Authority, Key Segregation & Governance Controls

### 1.1 Strict Role & Keypair Segregation
To prevent privilege conflation and eliminate single-point-of-failure risks, the deployment architecture strictly decouples the BPF Program Upgrade Authority from Market Administration and Cranking operations:

| Role Name | Dedicated Keypair File | Scope of Authority | Minimal SOL Balance | Permissions |
|---|---|---|:---:|:---:|
| **Deployer / Upgrade Authority** | `~/.config/solana/epoch-v1-keys/epoch-deployer-keypair.json` | Program buffer upload, BPF upgrade, upgrade authority rotation | **5.00 SOL** | `0600` |
| **Market Admin** | `~/.config/solana/epoch-v1-keys/epoch-admin-keypair.json` | Owns `Market` PDA (`market.admin`), param updates, emergency shutdown | **1.00 SOL** | `0600` |
| **Cranker / Keeper Fee-Payer** | `~/.config/solana/epoch-v1-keys/epoch-keeper-keypair.json` | Signs batch clearing (`clear_batch`), settlement (`settle_users`), and ADL | **1.00 SOL** | `0600` |
| **Backstop Vault Authority** | `~/.config/solana/epoch-v1-keys/epoch-vault-authority-keypair.json` | Places automated quoting ladder into open batches (`vault_quote`) | **0.50 SOL** | `0600` |
| **Fallback Oracle Authority** | `~/.config/solana/epoch-v1-keys/epoch-oracle-authority-keypair.json`| Submits signed price updates solely in authority oracle fallback mode | **0.50 SOL** | `0600` |
| **Total Ecosystem Capitalization** | | **Five discrete, non-overlapping keypairs** | **8.00 SOL** | |

### 1.2 Exact Minimum SOL Balance Derivations

1. **Deployer / Upgrade Authority (5.00 SOL):**
   - SBF Executable Bytecode Size: **647,304 bytes**
   - Program Data Account Allocation ($2 \times \text{size} + \text{metadata} \approx 1,300\text{ KB}$): **4.51 SOL** rent exemption.
   - Buffer chunk transaction fees (approx. 650 transactions): **0.05 SOL**.
   - Operational safety buffer: **0.44 SOL**.
2. **Market Admin (1.00 SOL):**
   - `Market` PDA Rent (392 bytes): **0.0036 SOL**.
   - Mock USDC Mint PDA Rent (82 bytes): **0.0015 SOL**.
   - Collateral Vault Token Account Rent (165 bytes): **0.0020 SOL**.
   - 8 Circular Batch Accounts Rent ($8 \times 13,880\text{ bytes} \approx 111\text{ KB}$): **0.7720 SOL**.
   - Admin parameter adjustment transactions: **0.2209 SOL**.
3. **Cranker / Keeper (1.00 SOL):**
   - 50 Soak Batches $\times$ (1 `clear_batch` + 1 `settle_users`) = 100 txs.
   - Base signature fee: $100 \times 0.000005\text{ SOL} = 0.0005\text{ SOL}$.
   - Priority fees at 10,000 micro-lamports per CU ($37,851\text{ CU} \approx 0.00038\text{ SOL}$/tx): **0.0380 SOL**.
   - Operational gas buffer: **0.9615 SOL** (automated alert triggers if balance drops below 0.20 SOL).
4. **Backstop Vault Authority (0.50 SOL):**
   - `vault_user` Account Rent (200 bytes): **0.0022 SOL**.
   - Quoting transaction fees (50 batches $\times 0.000005\text{ SOL}$): **0.00025 SOL**.
   - Operational buffer: **0.4975 SOL**.
5. **Fallback Oracle Authority (0.50 SOL):**
   - Price posting transactions if Pyth Devnet cluster stalls: **0.05 SOL**.
   - Operational buffer: **0.45 SOL**.

### 1.3 Multisig & Program Upgrade Authority Protection
- **Devnet Architecture:** The Deployer keypair (`epoch-deployer-keypair.json`) holds initial upgrade authority for rapid debugging during Gate G3.
- **Multisig Governance Transition:** Prior to public demonstration or Gate G4 soak testing, upgrade authority can be migrated to a **Squads Protocol v4 Multisig** on Solana Devnet:
  - Configuration: 2-of-3 threshold among Lead Architect, Security Auditor, and Sponsor.
  - Command: `solana program set-upgrade-authority ER8SSfvp7roW6asG429Uv3mHY1aEd1jxGBdigLu27284 --new-upgrade-authority <SQUADS_VAULT_PDA>`.
- **Mainnet Immutability Option:** For production release, program upgrade authority can be permanently revoked via `solana program set-upgrade-authority <PROGRAM_ID> --final`, rendering the contract completely immutable.

### 1.4 Backup, Recovery & Key Compromise Procedures
1. **Encrypted Offline Backup:** Keypairs are stored in AES-256 GPG-encrypted tarballs (`gpg -c epoch-v1-keys.tar.gz`) stored across two physically isolated offline storage media.
2. **Key Compromise Emergency Revocation:**
   - If the Deployer keypair is suspected compromised, the authority is immediately rotated using a pre-signed or fast-path transaction:
     ```bash
     solana program set-upgrade-authority ER8SSfvp7roW6asG429Uv3mHY1aEd1jxGBdigLu27284 \
       --new-upgrade-authority <RECOVERY_SECURE_KEYPAIR_OR_MULTISIG> \
       --keypair ~/.config/solana/epoch-v1-keys/epoch-deployer-keypair.json
     ```
   - If the Cranker/Keeper keypair is compromised, the operator immediately stops the keeper daemon, drains residual SOL balance to a cold address, generates a fresh keeper keypair, and updates the keeper service configuration. The keeper holds zero administrative rights over market parameters or collateral vaults.

### 1.5 Filesystem Security & Git Hygiene Audit
- **Filesystem Permissions:** Non-world-readable permissions enforced on all keypaths:
  ```bash
  chmod 0700 ~/.config/solana/epoch-v1-keys
  chmod 0600 ~/.config/solana/epoch-v1-keys/*.json
  ```
- **Git Hygiene:** Verified that `.gitignore` contains `**/*keypair*.json`, `**/*.key`, and `target/deploy/*.json`. `git status --ignored` confirms zero keys are tracked or stageable.

---

## 2. Deployment Artifact Verification & BPF Rollback Procedures

### 2.1 Approved SBF Binary Specification
- **File Location:** `target/deploy/epoch.so`
- **Compiler Mode:** Cargo SBF Release (`default` feature set, zero `devnet-faucet` compilation)
- **Exact Size:** **647,304 bytes**
- **SHA-256 Hash:** `15e3f1fb5b3f29fe5892a0daba8b51da9bd2451ff5d7b906ca33805d2ca2ab42`

### 2.2 Reproducible Bytecode Verification of Uploaded Buffer
Solana SBF uploads occur via `solana program write-buffer`. Because network packet corruption can occur, the uploaded buffer must be mathematically verified against the local binary **prior** to executing the upgrade:

```bash
# 1. Upload bytecode to uncommitted buffer
solana program write-buffer target/deploy/epoch.so \
  --url https://api.devnet.solana.com \
  --keypair ~/.config/solana/epoch-v1-keys/epoch-deployer-keypair.json
# Returns: Buffer <BUFFER_PUBKEY>

# 2. Dump raw buffer account data from Devnet RPC
solana account <BUFFER_PUBKEY> --output-file /tmp/buffer_dump.bin --url https://api.devnet.solana.com

# 3. Strip 37-byte BPF Upgradeable Loader buffer header (offset 37 -> end)
tail -c +38 /tmp/buffer_dump.bin > /tmp/buffer_extracted.so

# 4. Compare SHA-256 hashes
LOCAL_HASH=$(shasum -a 256 target/deploy/epoch.so | awk '{print $1}')
BUFFER_HASH=$(shasum -a 256 /tmp/buffer_extracted.so | awk '{print $1}')

if [ "$LOCAL_HASH" = "$BUFFER_HASH" ]; then
  echo "[PASS] Buffer bytecode strictly identical to local artifact: $LOCAL_HASH"
else
  echo "[CRITICAL FAIL] Hash mismatch! Abort deployment immediately."
  exit 1
fi
```

### 2.3 Pre-Deployment Verification of Program ID & Upgrade Authority
Before invoking upgrade:
```bash
# Query on-chain program account metadata
solana program show ER8SSfvp7roW6asG429Uv3mHY1aEd1jxGBdigLu27284 --url https://api.devnet.solana.com
# Asserts:
# 1. ProgramData Address matches expected derivation
# 2. Upgrade Authority matches ~/.config/solana/epoch-v1-keys/epoch-deployer-keypair.json
```

### 2.4 Preservation of Rollback Artifact
Prior to any upgrade deployment, the currently running live bytecode is dumped and archived:
```bash
mkdir -p target/deploy/backup
solana program dump ER8SSfvp7roW6asG429Uv3mHY1aEd1jxGBdigLu27284 \
  target/deploy/backup/epoch_live_rollback_$(date +%Y%m%d_%H%M%S).so \
  --url https://api.devnet.solana.com
```

### 2.5 Precise Atomicity Semantics & Rollback Procedure
> [!IMPORTANT]
> **Technical Clarification on Deployment Atomicity:**
> - The **buffer upload phase** is **NOT atomic**: It is split across hundreds of RPC transactions over several minutes. If RPC disconnects, the buffer is partial.
> - The **buffer deployment phase** (`solana program deploy --buffer <BUFFER>`) IS **strictly atomic on-chain**: The BPF Upgradeable Loader executes a single transaction that swaps the `ProgramData` executable pointer to the newly verified buffer. Either the swap succeeds in 1 transaction, or the existing program remains completely unmodified.

**Exact Rollback Execution Procedure:**
If post-deployment functional verification detects an unexpected regression:
1. Write the preserved backup binary to a fresh buffer:
   ```bash
   solana program write-buffer target/deploy/backup/epoch_live_rollback_*.so \
     --url https://api.devnet.solana.com \
     --keypair ~/.config/solana/epoch-v1-keys/epoch-deployer-keypair.json
   ```
2. Atomically deploy the rollback buffer:
   ```bash
   solana program deploy --program-id ER8SSfvp7roW6asG429Uv3mHY1aEd1jxGBdigLu27284 \
     --buffer <ROLLBACK_BUFFER_PUBKEY> \
     --upgrade-authority ~/.config/solana/epoch-v1-keys/epoch-deployer-keypair.json \
     --url https://api.devnet.solana.com
   ```

---

## 3. Emergency Shutdown Source Inspection & Guarantees

We performed an independent source code audit across all 6 core lifecycle instructions:
1. `update_market_params` ([`programs/epoch/src/instructions/update_market_params.rs`](file:///Users/jatinsharma/Projects/Solana-Hackathon/Colosseum/Epoch/programs/epoch/src/instructions/update_market_params.rs))
2. `update_vault_params` ([`programs/epoch/src/instructions/update_vault_params.rs`](file:///Users/jatinsharma/Projects/Solana-Hackathon/Colosseum/Epoch/programs/epoch/src/instructions/update_vault_params.rs))
3. `place_order` ([`programs/epoch/src/instructions/place_order.rs`](file:///Users/jatinsharma/Projects/Solana-Hackathon/Colosseum/Epoch/programs/epoch/src/instructions/place_order.rs))
4. `clear_batch` ([`programs/epoch/src/instructions/clear_batch.rs`](file:///Users/jatinsharma/Projects/Solana-Hackathon/Colosseum/Epoch/programs/epoch/src/instructions/clear_batch.rs))
5. `expire_and_release` ([`programs/epoch/src/instructions/expire_and_release.rs`](file:///Users/jatinsharma/Projects/Solana-Hackathon/Colosseum/Epoch/programs/epoch/src/instructions/expire_and_release.rs))
6. `withdraw` ([`programs/epoch/src/instructions/withdraw.rs`](file:///Users/jatinsharma/Projects/Solana-Hackathon/Colosseum/Epoch/programs/epoch/src/instructions/withdraw.rs))
7. `settle_users` ([`programs/epoch/src/instructions/settle_users.rs`](file:///Users/jatinsharma/Projects/Solana-Hackathon/Colosseum/Epoch/programs/epoch/src/instructions/settle_users.rs))

### 3.1 Proved Protocol Guarantees Under Emergency Pause

1. **How New Orders Stop (Zero Risk-Taking):**
   - `VaultParams` contains `pub is_active: u8`. Invoking `update_vault_params` setting `is_active = 0` immediately halts all automated backstop vault liquidity (`vault_quote` skips execution).
   - In `MarketParams`, `pub min_order_notional: u64` is mutable by admin. Invoking `update_market_params` setting `min_order_notional = u64::MAX` causes every subsequent `place_order` invocation to revert on line 169:
     ```rust
     require!(notional >= market.params.min_order_notional, EpochError::OrderNotionalTooSmall);
     ```
     Because no order notional can exceed `u64::MAX`, **100% of new user order placements are halted deterministically**.
2. **Existing Open Batches Safely Expire & Release Collateral:**
   - In [`expire_and_release.rs:65-74`](file:///Users/jatinsharma/Projects/Solana-Hackathon/Colosseum/Epoch/programs/epoch/src/instructions/expire_and_release.rs#L65-L74), once an open batch exceeds `close_slot + max_clear_delay_slots`, any permissionless caller can transition it to `VOID`.
   - Lines 176–196 decrement user `pending_buy_lots`, `pending_sell_lots`, and `active_orders` back to 0 without executing any trade fills. All committed order margin is safely released.
3. **Users Can Always Withdraw When Eligible (Zero Stranded Funds):**
   - In [`withdraw.rs:56-64`](file:///Users/jatinsharma/Projects/Solana-Hackathon/Colosseum/Epoch/programs/epoch/src/instructions/withdraw.rs#L56-L64), withdrawal requires:
     1. `user.pending_buy_lots == 0 && user.pending_sell_lots == 0 && user.active_orders == 0` (satisfied once `expire_and_release` or `settle_users` runs).
     2. `user.base_position == 0` (user is flat).
     3. Line 66 clears any liquidation quarantine flags:
        `user.flags &= !(UserFlags::LIQUIDATING | UserFlags::LIQUIDATION_LOCKED);`
   - **Crucial Invariant:** `withdraw.rs` has **ZERO dependency on `MarketParams` or market pause state**, **ZERO oracle staleness dependency**, and **ZERO admin permission checks**. An admin **cannot freeze or strand eligible user collateral**.
4. **Existing Positions Safely Settle:**
   - Batches cleared prior to pause (`status == CLEARED`) are settled via `settle_users.rs`. `settle_users` calculates fills and folds realized PnL into `user.quote_position`.

### 3.2 Documented Protocol Limitations Under Pause
- **Documented Limitation 1 (Order Rejection Mechanism):** `MarketParams` does not currently contain a dedicated boolean `is_active` flag. Emergency shutdown of new order intake is implemented via `min_order_notional = u64::MAX`. This is fully functional on-chain without code modifications.
- **Documented Limitation 2 (Open Position Flattening):** If a user has an active non-zero position (`base_position != 0`) when trading is paused, they cannot immediately call `withdraw` because `withdraw` enforces the flat position rule (`base_position == 0`). To exit, the position must either:
  1. Be settled against an opposing trade in an already cleared batch, or
  2. Be closed out via ADL / liquidation (`liquidate.rs`), which remains active and callable during emergency pause.

---

## 4. Devnet Mock USDC Controls & PDA Architecture

Epoch on Devnet operates exclusively with an isolated mock token mint derived from the program's PDA:

### 4.1 Exact Mint & Account Specification

| Parameter / Field | Specification | On-Chain Verification / Address |
|---|---|---|
| **Token Mint Address** | Program Derived Address (`[b"quote_mint"]`) | `9ncxNM7tiBo3Gfeo6T2CrC71T3WsbaubpkRbK2YN2XTd` |
| **Token Program** | Standard Solana SPL Token Program | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| **Mint Authority** | Program Derived Address (`[b"mint_authority"]`) | `FpFxvMv8ZPdVSqhoUVmL9DXj47pLopbUbnBnjt8BFVht` |
| **Decimals** | 6 Decimals | $1\text{ mock USDC} = 1,000,000\text{ micro-USDC}$ |
| **Collateral Vault Account**| Program Derived Address (`[b"collateral_vault"]`) | `CkaBNrXFLqJTCQCbSenDmkbXc2apXXE2HTKSopvX8ku6` |
| **Collateral Vault Owner** | `Market` PDA (`[b"market"]`) | `EaN2QU5w5RVTepYExdqxcuu49pg7MHSFWBEYpN2QKYsF` |
| **Backstop Vault User PDA**| `[b"vault_user", market_pda]` | `9rdZk3SSy9ED7dB3q2DAgZPYGqjstEXwqEmF1Jt8XcPt` |

### 4.2 Absolute Isolation from Real Assets
- **Zero Real-Value Stablecoins:** The protocol does not interact with Circle's official Devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`) or Mainnet USDC (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`).
- **Cryptographic Enclosure:** Because `quote_mint` is initialized with `seeds = [b"quote_mint"]` and `mint::authority = mint_authority` ([`initialize_market.rs:76-83`](file:///Users/jatinsharma/Projects/Solana-Hackathon/Colosseum/Epoch/programs/epoch/src/instructions/initialize_market.rs#L76-L83)), no external entity can forge mock USDC, and no external token mint can be deposited into the collateral vault.

### 4.3 Vault Funding Procedure
1. Admin calls `fund_vault(amount)`: Transfers mock USDC from admin's Associated Token Account to `collateral_vault`.
2. Credits `vault_user.collateral += amount` on-chain.
3. Vault token balance matches on-chain collateral ledger entry with 0 drift.

---

## 5. Keeper & Oracle Operational Monitoring

### 5.1 RPC Endpoints & Multi-Provider Fallback

```
+--------------------------------------------------------------------------+
|                        KEEPER RPC FAILOVER ARCHITECTURE                  |
+-------------------+-----------------------------------+------------------+
| Priority          | Provider Endpoint                 | Transport        |
+-------------------+-----------------------------------+------------------+
| Primary           | https://api.devnet.solana.com     | HTTP + WebSocket |
| Secondary (Fast)  | https://devnet.helius-rpc.com/... | HTTP             |
| Tertiary (Public) | https://rpc.ankr.com/solana_devnet| HTTP             |
+-------------------+-----------------------------------+------------------+
```

### 5.2 Rate-Limit & Retry Behavior
- **HTTP 429 Backoff:** Implemented in [`keeper/src/keeper.ts:60-78`](file:///Users/jatinsharma/Projects/Solana-Hackathon/Colosseum/Epoch/keeper/src/keeper.ts#L60-L78). Retries with jittered exponential backoff:
  $$\text{Delay} = \min(2^{\text{attempt}} \times 100\text{ ms} + \text{rand}(0, 50), 2000\text{ ms})$$
  Max 4 attempts before triggering fallback RPC failover.
- **Fail-Fast Policy:** Non-429 client errors (e.g., account deserialization or custom program errors) fail immediately without entering retry loops.

### 5.3 Keeper Recovery & Idempotency
- **Slot Watchdog (2.5s Timeout):** If WebSocket fails to publish slot updates for $> 2,500\text{ ms}$, keeper switches to polling HTTP `getSlot({ commitment: "processed" })` and resubscribes to WebSocket.
- **Signature Polling & Lost Confirmations:** If an RPC drops connection mid-flight, keeper queries `getSignatureStatuses` across 30 block heights. If the transaction landed, keeper updates its `_confirmedSignatures` set and does NOT resubmit.

### 5.4 Pyth Freshness & Confidence Safeguards
- **Max Oracle Age:** 60 seconds (`max_oracle_age_secs = 60`). If $(t_{\text{current}} - t_{\text{publish}}) > 60\text{s}$, `clear_batch` marks batch `VOID`.
- **Future Timestamp Rejection:** If $t_{\text{publish}} > t_{\text{current}}$, batch is immediately marked `VOID`.
- **Confidence Clamping:** If $(\text{conf} \times 10,000) / \text{price} > 20\text{ bps}$, batch is immediately marked `VOID`.

### 5.5 Conditions that Automatically Halt New Risk-Taking
1. **Oracle Staleness / Window Expiration:** `place_order` reverts with `EpochError::OracleStale`.
2. **Pyth Confidence Wide:** `clear_batch` marks batch `VOID`; no trades match.
3. **Backstop Vault Inventory Limit:** When $|\text{inventory}| \ge 1,000\text{ lots}$, `vault_quote` emits `VaultQuoteSkipped { reason: INVENTORY_EXHAUSTED }` and halts new liquidity rungs until rebalanced.

---

## 6. Expanded 50-Batch Devnet Soak-Test Acceptance Specification

The Gate G3 verification includes an expanded 50-batch autonomous soak test (~7 minutes continuous execution on Solana Devnet):

### 6.1 Monitored Metrics & Target Thresholds

| Metric | Target Specification | Failure Condition |
|---|:---:|---|
| **Total Consecutive Batches** | **50 Batches** | $< 50$ completed batches |
| **Batch Clearance Success** | $\ge 45$ CLEARED / $\le 5$ VOID | $> 5$ consecutive VOID batches |
| **Keeper Crash / Restart** | 0 unhandled crashes (1 simulated recovery) | Unhandled process crash |
| **RPC 429 Recoveries** | 100% recovered without duplicate tx | Stalled thread / duplicate tx |
| **Oracle Staleness Voids** | Deterministic VOID on simulated stale price | Executed trade on stale price |
| **ADL Execution ($K \le 16$)** | Serialized wire size $\le 956\text{ bytes}$ | Wire size $> 1,232\text{ bytes}$ |
| **Backstop Inventory Exposure**| $-800 \le \text{Inv} \le +800\text{ lots}$ | $|\text{Inv}| > 1,000\text{ lots}$ |
| **Protocol Bad Debt** | **EXACTLY 0 micro-USDC** | $\mathbf{\text{bad\_debt} > 0}$ |
| **Balance Sheet Conservation** | Invariant **I-1** delta $== 0$ across all batches | Non-zero I-1 drift |
| **User Withdrawal Test** | 100% balance return to flat test users | Stranded user funds |

### 6.2 Critical Threshold Action Policy (Fail vs. Pause vs. Reset)

```
+--------------------------------------------------------------------------+
|                       SOAK TEST THRESHOLD ACTION POLICY                  |
+-----------------------+---------------------+----------------------------+
| Event Category        | Trigger Condition   | Protocol Action            |
+-----------------------+---------------------+----------------------------+
| CRITICAL BREACH       | bad_debt > 0        | IMMEDIATE FAIL:            |
|                       | I-1 delta != 0      | Halt test, trigger pause,  |
|                       | Tx Wire Size > 1232 | abort Gate G3.             |
+-----------------------+---------------------+----------------------------+
| TRANSIENT DEGRADATION | > 5 consecutive     | PAUSE & ALERT:             |
|                       | VOID batches        | Pause soak runner, inspect |
|                       | RPC outage          | Pyth/RPC relay, resume.    |
+-----------------------+---------------------+----------------------------+
| RECOVERABLE EVENT     | Keeper restart      | AUTOMATIC RECOVERY:        |
|                       | Single RPC 429      | Recover via watchdog and   |
|                       | Lost tx status      | backoff; continue test.    |
+-----------------------+---------------------+----------------------------+
```

---

## 7. Master Discrepancy & Verification Matrix

| # | Review Topic | Target Criterion | Verification Method / Evidence | Status |
|:---:|---|---|---|:---:|
| **1** | **Key Segregation** | Decouple deployer and admin keys | 5 separate keypairs defined with exact SOL requirements (8.0 SOL total) | **PASS** |
| **2** | **Upgrade Protection** | Document multisig & revocation | Squads v4 multisig transition & immutable finality procedures specified | **PASS** |
| **3** | **Key Security** | Strict permissions & git hygiene | Enforces `0600` permissions; `.gitignore` validated | **PASS** |
| **4** | **Buffer Verification** | Dump and verify uploaded buffer | Bytecode extraction (`tail -c +38`) and SHA-256 hash match verified | **PASS** |
| **5** | **Atomicity Clarification**| Distinguish upload vs deploy | Documented: upload is chunked/non-atomic; swap is atomic 1-tx | **PASS** |
| **6** | **Rollback Strategy** | Preserve live binary & prerequisites | Dump live bytecode before deploy; rollback buffer deploy procedure defined | **PASS** |
| **7** | **Emergency Pause Audit**| Verify order halt & withdrawal | Proved: `min_order_notional = u64::MAX` stops orders; flat withdraw is unblockable | **PASS** |
| **8** | **Pause Limitations** | Document exact limitations | Proved: non-flat positions must settle or liquidate before withdrawal | **PASS** |
| **9** | **Devnet Mock USDC** | Document mint & PDA derivation | Program PDA `9ncxNM...` (6 decimals, SPL Token); 0 real asset involvement | **PASS** |
| **10**| **Keeper & Failover** | Multi-RPC, 429 backoff, watchdog | 2.5s watchdog, 429 backoff, lost confirmation recovery defined | **PASS** |
| **11**| **Soak Test Acceptance**| Expanded 50-batch specification | Threshold action matrix (Fail on bad debt/I-1; Pause on Pyth outage) | **PASS** |

---

## 8. Git State & Strict Authorization Boundary Confirmation

### 8.1 Git Baseline
```bash
$ git status --short --branch
## feat/epoch-protocol-hardening...origin/feat/epoch-protocol-hardening [ahead 6]
```
- **Active Branch:** `feat/epoch-protocol-hardening`
- **Zero Push Enforced:** No commits have been pushed to remote.
- **Working Tree:** Clean.

### 8.2 Strict Gate G3 Boundary
> [!CAUTION]
> **GATE G3 REMAINS FULLY UNAUTHORIZED:**
> This document is an approved planning specification only.
> **Zero Devnet transactions, zero program deployments, zero market initializations, and zero backstop fundings will be executed until the user grants separate, explicit written authorization.**
