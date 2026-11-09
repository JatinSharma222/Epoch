# Epoch Protocol — Independent Security Audit Report

**Date:** November 2026  
**Auditor:** Independent Protocol Security Auditor  
**Scope:** Epoch Protocol Smart Contracts (`programs/epoch`), Cranker / Keeper Bot (`keeper/`), and Deployment Architecture (`docker/`, `scripts/`)  
**Target Git Branch:** `feat/epoch-multi-agent`  
**Classification:** Confidential Security Evaluation  

---

## 1. Executive Summary

An exhaustive and adversarial security audit of the Epoch Protocol codebase was conducted. The audit encompassed on-chain Rust smart contracts implemented in Anchor, the TypeScript off-chain keeper and cranker service, oracle integration layers (Pyth Network Receiver & Authority Oracle), and container deployment configurations.

The Epoch Protocol introduces an on-chain Frequent Batch Auction (FBA) perpetual futures exchange designed to eliminate transaction-ordering sandwich attacks and latency front-running by clearing orders in discrete batches at a uniform price.

### Overall Assessment & Security Posture
The mathematical core of the batch clearing ladder and discrete uniform price auction is rigorously constructed, but the surrounding protocol exhibits several **Critical** and **High-severity** architectural vulnerabilities. These vulnerabilities allow:
1. **Denial of Service (Protocol Halting):** Arithmetic underflows in partial funding residual settlement (`fee_pool` underflow) and order-cancellation bugs in backstop quoting permanently brick ring buffer slots, freezing all trading across the protocol.
2. **Centralization & Admin Backdoors:** Unconstrained parameter modification without range checks or timelocks permits single-transaction confiscation of user collateral; administrative bypasses in auction clearance and batch expiration violate the permissionless guarantees of the mechanism and grant the admin a risk-free cancellation option.
3. **Insolvency & Margin Escapes:** Absence of margin checks on the Backstop Vault during liquidations allows underwater positions to bankrupt the protocol vault; lack of auto-deleveraging (ADL) causes bad debt socialization to fall on the last solvent withdrawers.
4. **Operational & Secret Hygiene:** Default generation of keeper keypairs inside the working directory, lack of `.dockerignore`, fallback to the program deploy key in `docker-compose.yml`, and committed third-party API keys expose infrastructure to compromise.

### Vulnerability Summary Table

| ID | Title | Reported Severity | Verified Severity | Status / Verdict | Exploitability | Confidence |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **C-1** | Keeper Keypair Committed to Repository | CRITICAL | HIGH | Operational Risk Confirmed | Conditional | HIGH (95%) |
| **C-2** | Unconstrained Admin `update_market_params` Authority | CRITICAL | CRITICAL | Genuinely Exploitable | Immediate | HIGH (100%) |
| **H-1** | `fee_pool` Underflow in Negative Funding Residual Paths | HIGH | CRITICAL | Genuinely Exploitable | Immediate | HIGH (100%) |
| **H-2** | Admin Bypass in `clear_batch` Timing Validation | HIGH | HIGH | Genuinely Exploitable | Immediate | HIGH (100%) |
| **H-3** | Admin Bypass in `expire_and_release` | HIGH | HIGH | Genuinely Exploitable | Immediate | HIGH (100%) |
| **H-4** | Missing Vault Margin Validation During Liquidation | HIGH | HIGH | Genuinely Exploitable | Immediate | HIGH (100%) |
| **H-5** | Oracle Anchor-Price Window Manipulation & Selection Option | HIGH | HIGH | Genuinely Exploitable | Immediate | HIGH (95%) |
| **M-1** | Ring Slot Reuse Deadlock & Griefing | MEDIUM | HIGH | Genuinely Exploitable | Immediate | HIGH (100%) |
| **M-2** | Inefficient Keeper Liquidation Scanning | MEDIUM | MEDIUM | Operational Bottleneck | High Volatility | HIGH (100%) |
| **M-3** | Vault Margin Validation and Pending Lots | MEDIUM | MEDIUM | Genuinely Exploitable | Immediate | HIGH (100%) |
| **M-4** | `skipPreflight` Usage in Keeper | MEDIUM | MEDIUM | Operational Vulnerability | Rapid Gas Drain | HIGH (100%) |
| **M-5** | Missing `close_user` Instruction | MEDIUM | LOW | Resource Leakage | Cumulative | HIGH (100%) |
| **M-6** | Faucet Global Rate Limits | MEDIUM | MEDIUM | Sybil Exhaustion | Immediate | HIGH (100%) |
| **ADD-1** | Silent Ring Slot Bricking in `vault_quote.rs` Quote Cancellation | — | CRITICAL | Genuinely Exploitable | Immediate | HIGH (100%) |
| **ADD-2** | Non-Monotonic `next_batch_to_clear` Rollback in `clear_batch.rs` | — | MEDIUM | Architectural Flaw | Transient | HIGH (95%) |
| **ADD-3** | Permanent Capital Lock in Backstop Vault (No Withdrawal Flow) | — | HIGH | Architectural Flaw | Permanent | HIGH (100%) |
| **ADD-4** | Arithmetic Negation Overflow & Truncation in `expire_and_release` | — | MEDIUM | Edge-case Panic | Edge Case | HIGH (90%) |
| **ADD-5** | Missing Bad Debt Socialization / ADL Mechanism | — | HIGH | Insolvency Spillover | Extreme Volatility | HIGH (100%) |
| **ADD-6** | Committed Live Helius RPC API Key in Runbook | — | MEDIUM | Operational Credential Leak | Active Leak | HIGH (100%) |
| **ADD-7** | Insecure Docker Build Context & Program Deploy Key Exposure | — | HIGH | Supply Chain / Container Leak | Build Time | HIGH (95%) |

---

## 2. In-Depth Vulnerability Analysis

---

### [C-1] Keeper Keypair Committed to Repository & Secret Hygiene

- **Reported Severity:** CRITICAL
- **Verified Severity:** HIGH (Operational Risk)
- **Confidence:** HIGH (95%)
- **Source References:**
  - `scripts/generate_keeper_keypair.ts#L16`
  - `docker-compose.yml#L79`
  - `docker/bun.Dockerfile#L7`
  - `docs/KEEPER_RUNBOOK.md#L117-L118`, `L177`
  - `.gitignore#L36-L43`

#### 1. Source Code & Execution Path
In `scripts/generate_keeper_keypair.ts`:
```typescript
const targetPath = process.argv[2] || path.join(__dirname, "../keeper/keeper-keypair.json");
```
In `docker-compose.yml`:
```yaml
epoch-keeper:
  volumes:
    - ${EPOCH_KEEPER_KEYPAIR:-./target/deploy/epoch-keypair.json}:/run/secrets/keeper.json:ro
```
In `docker/bun.Dockerfile`:
```dockerfile
COPY ${SERVICE}/ ./
```

#### 2. Verification & Exploitability Analysis
1. **Git Commit History Verification:** An exhaustive commit-level scan (`git log --all --full-history`) verified that no actual raw private keypair JSON array has been committed to git history directly. `.gitignore` line 37 properly ignores `*keypair*.json`.
2. **Container Build Context Leakage:** The repository lacks a `.dockerignore` file. When an operator runs `scripts/generate_keeper_keypair.ts` without arguments, it generates `keeper/keeper-keypair.json` inside the `keeper/` directory. When building the Docker container (`docker build -f docker/bun.Dockerfile --build-arg SERVICE=keeper .`), Docker copies `keeper/` into the image via `COPY ${SERVICE}/ ./`. Any container image distributed, pushed to a registry, or inspected exposes the live private keypair.
3. **Program Upgrade Authority Exposure:** In `docker-compose.yml` line 79, if `EPOCH_KEEPER_KEYPAIR` is unset, it defaults to `./target/deploy/epoch-keypair.json`. This is the Solana program deploy/upgrade authority keypair. If run in this configuration, the automated keeper signs operational cranker transactions using the protocol deployer key, exposing the entire program upgrade authority to memory extraction, node compromise, and transaction fee drain.
4. **Third-Party Credential Leak:** In `docs/KEEPER_RUNBOOK.md` line 117 and line 177, a live Helius RPC API key (`7f051d79-ac86-4394-bae9-346f64974d1a`) is committed in plain text.

#### 3. Attack Scenario
An attacker pulls or inspects a published `epoch/keeper:dev` image or inspects the runbook documentation. The attacker retrieves the API key to exhaust RPC quotas, or extracts the keeper keypair to drain all SOL gas balances, halting all batch clearance and auction settlement across the network.

#### 4. Remediation
1. Change default output path in `scripts/generate_keeper_keypair.ts` to an external directory (e.g. `~/.config/epoch/keeper.json`), requiring explicit flag `--force-local` to write to the repository tree.
2. Add a root `.dockerignore` file explicitly ignoring `**/*keypair*.json`, `**/*.json`, `.env*`, and `keys/`.
3. In `docker-compose.yml`, remove the fallback to `./target/deploy/epoch-keypair.json`: require `${EPOCH_KEEPER_KEYPAIR:?Variable EPOCH_KEEPER_KEYPAIR must be set}`.
4. Revoke the exposed Helius RPC API key immediately and replace with an environment variable placeholder `${EPOCH_HELIUS_KEY}`.

---

### [C-2] Unconstrained Admin `update_market_params` Authority

- **Reported Severity:** CRITICAL
- **Verified Severity:** CRITICAL
- **Confidence:** HIGH (100%)
- **Source References:**
  - `programs/epoch/src/instructions/update_market_params.rs#L19-L28`
  - `programs/epoch/src/state/market.rs#L51-L79`

#### 1. Source Code & Execution Path
`handle_update_market_params` directly replaces the inline `market.params` struct with `new_params.into()` after calling `params.validate()`:
```rust
pub fn handle_update_market_params(
    ctx: Context<UpdateMarketParams>,
    new_params: InitializeMarketArgs,
) -> Result<()> {
    let params: crate::state::MarketParams = new_params.into();
    params.validate()?;

    let mut market = ctx.accounts.market.load_mut()?;
    market.params = params;
    Ok(())
}
```
Inspection of `MarketParams::validate()` in `programs/epoch/src/state/market.rs`:
```rust
pub fn validate(&self) -> Result<()> {
    require!(self.price_tick > 0, EpochError::InvalidMarketParameter);
    require!(self.base_lot > 0, EpochError::InvalidMarketParameter);
    require!(self.batch_slots > 0, EpochError::InvalidMarketParameter);
    require!(self.funding_period_slots > 0, EpochError::InvalidMarketParameter);
    require!(self.mmr_bps > 0, EpochError::InvalidMarketParameter);
    require!(self.imr_bps > self.mmr_bps, EpochError::InvalidMarketParameter);
    require!(self.imr_bps <= 10_000, EpochError::InvalidMarketParameter);
    require!(self.fee_bps <= 1000, EpochError::InvalidMarketParameter);
    require!(
        self.k_ticks > 0 && self.k_ticks % 2 == 1 && (self.k_ticks as usize) <= K_TICKS,
        EpochError::InvalidTick
    );
    require!(self.tick_bps > 0, EpochError::InvalidMarketParameter);
    require!(
        self.lookahead > 0 && (self.lookahead as usize) < (RING_SIZE as usize),
        EpochError::InvalidMarketParameter
    );
    require!(
        self.max_orders_per_batch > 0 && (self.max_orders_per_batch as usize) <= MAX_ORDERS,
        EpochError::InvalidMarketParameter
    );
    require!(self.max_oracle_age_secs > 0, EpochError::InvalidMarketParameter);
    require!(self.max_conf_bps > 0, EpochError::InvalidMarketParameter);
    require!(self.max_clear_delay_slots > 0, EpochError::InvalidMarketParameter);
    Ok(())
}
```

#### 2. Verification & Exploitability Analysis
1. **Missing Parameter Bounds:**
   - `self.liq_penalty_bps` has **zero** validation checks. An admin can set `liq_penalty_bps = 50_000` (500%).
   - `self.funding_cap_bps` has **zero** validation checks.
   - `self.min_order_lots` and `self.min_order_notional` have **zero** validation checks.
2. **Dynamic Mutation of Immutable Structural Constants:**
   The admin is permitted to update structural constants while trading is active:
   - `batch_slots`: Determines batch boundaries `batch_id = (slot - start_slot) / batch_slots`. Changing `batch_slots` dynamically desynchronizes all active batch accounts, lookahead calculations, and close slot timing.
   - `base_lot` and `price_tick`: Scalers for existing user positions (`base_position` in lots). If `base_lot` is changed from 1,000 to 10,000, existing positions are suddenly misdenominated by an order of magnitude.
   - `k_ticks`: If `k_ticks` is reduced while resting orders exist at ticks above the new `k_ticks`, clearing and array lookups trigger out-of-bounds panics or orphaned volume.
3. **Instantaneous Mass-Liquidation Rug Pull:**
   The admin can set `mmr_bps = 9999` (99.99%) and `imr_bps = 10_000` (100%). Instantly, every user on the platform has `user_equity < mmr_req`. The Backstop Vault (or keeper) then calls `liquidate` on all users, transferring all positions to the vault and seizing all user collateral into the insurance fund or fee pool.
4. **Governance Architecture:**
   There is no timelock, no two-step proposal/execution cycle, and no multi-signature requirement. A single compromised private key can unilaterally destroy or drain the protocol in a single block.

#### 3. Attack Scenario
A compromised admin key signs `update_market_params` setting `mmr_bps = 9999` and `liq_penalty_bps = 10_000`. The attacker immediately invokes `liquidate` against all open user accounts, wiping out all trader collateral and taking over all positions.

#### 4. Remediation
1. Partition `MarketParams` into **Immutable Parameters** (set once at initialization: `base_lot`, `price_tick`, `batch_slots`, `k_ticks`) and **Tunable Parameters** (`fee_bps`, `imr_bps`, `mmr_bps`, `max_conf_bps`, `max_oracle_age_secs`).
2. Add strict range bounds in `validate()`:
   ```rust
   require!(self.liq_penalty_bps <= 1000, EpochError::InvalidMarketParameter); // Max 10%
   require!(self.funding_cap_bps <= 500, EpochError::InvalidMarketParameter); // Max 5%
   require!(self.mmr_bps <= 2000, EpochError::InvalidMarketParameter); // Max 20%
   require!(self.imr_bps <= 5000, EpochError::InvalidMarketParameter); // Max 50%
   ```
3. Enforce a timelock or multi-sig requirement for parameter updates, emitting an on-chain proposal event with a delay (e.g. 24 hours).

#### 5. Regression Test Specification
- `test_update_market_params_rejects_unbounded_liq_penalty`: Assert setting `liq_penalty_bps > 1000` returns `EpochError::InvalidMarketParameter`.
- `test_update_market_params_rejects_immutable_param_changes`: Assert changing `batch_slots`, `base_lot`, or `k_ticks` returns an error after initialization.
- `test_update_market_params_rejects_mmr_above_cap`: Assert setting `mmr_bps > 2000` is rejected.

---

### [H-1] `fee_pool` Underflow in Negative Funding Residual Paths

- **Reported Severity:** HIGH
- **Verified Severity:** CRITICAL (Protocol Halting)
- **Confidence:** HIGH (100%)
- **Source References:**
  - `programs/epoch/src/instructions/settle_users.rs#L211-L225`
  - `programs/epoch/src/instructions/expire_and_release.rs#L179-L191`

#### 1. Source Code & Execution Path
In `settle_users.rs`:
```rust
// Spec §8: Funding residual (payers' round-ups minus receivers' round-downs) goes to fee_pool
if total_funding_residual > 0 {
    let residual_u64 = u64::try_from(total_funding_residual).map_err(|_| EpochError::MathOverflow)?;
    market.fee_pool = market
        .fee_pool
        .checked_add(residual_u64)
        .ok_or(EpochError::MathOverflow)?;
} else if total_funding_residual < 0 {
    let neg = u64::try_from(total_funding_residual.checked_abs().ok_or(EpochError::MathOverflow)?)
        .map_err(|_| EpochError::MathOverflow)?;
    market.fee_pool = market
        .fee_pool
        .checked_sub(neg)
        .ok_or(EpochError::MathOverflow)?;
}
```
In `expire_and_release.rs`:
```rust
if total_funding_residual > 0 {
    market.fee_pool = market
        .fee_pool
        .checked_add(total_funding_residual as u64)
        .ok_or(EpochError::MathOverflow)?;
} else if total_funding_residual < 0 {
    let neg = (-total_funding_residual) as u64;
    market.fee_pool = market
        .fee_pool
        .checked_sub(neg)
        .ok_or(EpochError::MathOverflow)?;
}
```

#### 2. Verification & Exploitability Analysis
1. **Mathematical Reality of Incremental Settlement:**
   - Mechanism Spec §8 assumes a closed universe where all long and short positions are settled simultaneously, in which case rounding up on payers (`ceil`) and rounding down on receivers (`floor`) produces a non-negative residual: $\Delta_{\text{total}} \ge 0$.
   - On Solana, transactions are limited to 16 user accounts per batch call. Users are settled asynchronously across different transactions, blocks, or batches.
   - When `settle_users` or `expire_and_release` runs on a batch containing a user who is **owed funding** (for example, a short position when `funding_index` drops, or a long position when `funding_index` rises):
     $$\text{prod} = \text{base\_position} \times \Delta_{\text{funding}} < 0$$
     $$\text{payment} = \frac{\text{prod}}{F\_SCALE} < 0$$
   - The user's quote position is credited (`user.quote_position -= payment`), and `total_funding_residual` accumulates `payment`, making `total_funding_residual < 0`.
2. **Deterministic Transaction Revert:**
   - If the counterparty payer is not included in the exact same transaction, `total_funding_residual` remains negative.
   - In a fresh or low-activity market, `market.fee_pool` starts at 0.
   - When line 223 executes:
     $$\text{market.fee\_pool.checked\_sub}(\text{neg}) \implies 0 - \text{neg} \implies \text{None}$$
   - The instruction throws `EpochError::MathOverflow` and aborts!
3. **Cascading Failure & Ring Freeze:**
   - Because `settle_users` fails with `MathOverflow`, the batch can **never** reach `BatchStatus::SETTLED` (`batch.settled_orders` remains `< batch.num_orders`).
   - The ring slot $r = \text{batch\_id} \pmod 8$ cannot be reused by `place_order` (which checks `is_reusable`), throwing `EpochError::RingSlotBusy` (error 6007).
   - Once all 8 ring slots encounter an unsettled negative funding user, the **entire trading protocol is permanently locked**.

#### 3. Attack Scenario
A user opens a position and waits for the funding index to accrue in their favor. When the batch closes, the keeper or user attempts to settle. Because `fee_pool` lacks sufficient accrued trading fees to cover the user's isolated funding payout, the settlement transaction reverts with `MathOverflow`. The user's margin is locked, the ring slot cannot be cleared, and all future orders targeting that slot fail.

#### 4. Remediation
Funding residuals should not be deducted from `market.fee_pool` during individual user settlements. `fee_pool` tracks accrued trading fees, not funding reserves.
1. Remove the negative residual deduction from `market.fee_pool` during incremental user settlement.
2. Funding is peer-to-peer across user `quote_position`s. Net funding across all accounts is zero-sum in exact math; integer rounding residuals should be tracked in a dedicated signed funding accumulator or absorbed into the insurance fund only when the market is fully consolidated.
3. At minimum, saturate the deduction rather than reverting:
   ```rust
   if total_funding_residual > 0 {
       let residual = total_funding_residual as u64;
       market.fee_pool = market.fee_pool.saturating_add(residual);
   } else if total_funding_residual < 0 {
       let neg = total_funding_residual.unsigned_abs() as u64;
       market.fee_pool = market.fee_pool.saturating_sub(neg);
   }
   ```

#### 5. Regression Test Specification
- `test_settle_users_single_receiver_zero_fee_pool`: Initialize market with `fee_pool = 0`. Fund a short user, advance funding index downward (user is owed funding), call `settle_users` with only that user in `remaining_accounts`. Verify transaction succeeds without `MathOverflow`.

---

### [H-2] Admin Bypass in `clear_batch` Timing Validation

- **Reported Severity:** HIGH
- **Verified Severity:** HIGH
- **Confidence:** HIGH (100%)
- **Source References:**
  - `programs/epoch/src/instructions/clear_batch.rs#L108-L111`

#### 1. Source Code & Execution Path
In `programs/epoch/src/instructions/clear_batch.rs`:
```rust
// 2. Validate timing (current slot >= close_slot)
let mut market = ctx.accounts.market.load_mut()?;
let current_slot = Clock::get()?.slot;
let current_ts = Clock::get()?.unix_timestamp;
let start_slot = market.start_slot;
let n_slots = market.params.batch_slots as u64;
let close_slot = start_slot + (batch_id + 1) * n_slots;

require!(
    current_slot >= close_slot || market.admin == ctx.accounts.cranker.key(),
    EpochError::BatchNotOpen
);
```

#### 2. Verification & Exploitability Analysis
1. **Mechanism Specification Violation:**
   - The fundamental premise of a Frequent Batch Auction is that the auction remains open for all participants until `current_slot >= close_slot`.
   - The clause `|| market.admin == ctx.accounts.cranker.key()` allows the admin to invoke `clear_batch` at any arbitrary slot while `current_slot < close_slot`.
2. **Premature Auction Cutoff & Sniping:**
   - The admin can observe resting retail orders placed early in the batch window.
   - If the current oracle price is favorable to the admin or Backstop Vault, the admin can trigger premature clearance, preventing subsequent counter-orders or user cancellations from being included.
3. **State Inconsistency:**
   - If cleared before `close_slot`, users attempting to cancel open orders via `cancel_order` (`current_slot < close_slot`) will fail because `batch.status` has been shifted to `CLEARED`.

#### 3. Remediation
Remove the admin bypass entirely:
```rust
require!(
    current_slot >= close_slot,
    EpochError::BatchNotOpen
);
```

#### 4. Regression Test Specification
- `test_clear_batch_rejects_admin_before_close_slot`: Call `clear_batch` signed by `market.admin` when `current_slot < close_slot`. Verify it strictly reverts with `EpochError::BatchNotOpen`.

---

### [H-3] Admin Bypass in `expire_and_release`

- **Reported Severity:** HIGH
- **Verified Severity:** HIGH
- **Confidence:** HIGH (100%)
- **Source References:**
  - `programs/epoch/src/instructions/expire_and_release.rs#L64-L68`

#### 1. Source Code & Execution Path
In `programs/epoch/src/instructions/expire_and_release.rs`:
```rust
// 3. Stale / Void check:
// Batch must either already be VOID, or be OPEN and past close_slot + max_clear_delay_slots
if batch.status == BatchStatus::OPEN {
    let is_stale = current_slot > close_slot.saturating_add(max_delay)
        || market.admin == ctx.accounts.caller.key();
    require!(is_stale, EpochError::BatchNotStale);

    // Transition batch to VOID
    batch.status = BatchStatus::VOID;
```

#### 2. Verification & Exploitability Analysis
1. **Unilateral Auction Annulment ("Free Option"):**
   - Under normal operation, an open batch cannot be voided until it exceeds `close_slot + max_clear_delay_slots` (staleness threshold).
   - The backdoor `|| market.admin == ctx.accounts.caller.key()` permits the admin to force-void an active, non-stale batch at slot $t = 0$.
2. **Economic Exploit:**
   - The Backstop Vault automatically quotes liquidity into active batches.
   - If the market experiences sudden adverse price action that would cause the vault to execute fills at a loss, the admin can call `expire_and_release`, voiding the batch and setting `matched_lots = 0`.
   - All genuine trader orders are discarded without fills, creating an unfair asymmetrical cancellation option for the protocol operator.

#### 3. Remediation
Remove `|| market.admin == ctx.accounts.caller.key()`:
```rust
if batch.status == BatchStatus::OPEN {
    let is_stale = current_slot > close_slot.saturating_add(max_delay);
    require!(is_stale, EpochError::BatchNotStale);
    batch.status = BatchStatus::VOID;
```

#### 4. Regression Test Specification
- `test_expire_and_release_rejects_admin_on_in_window_batch`: Attempt to call `expire_and_release` as `admin` on an open batch where `current_slot <= close_slot + max_delay`. Verify it fails with `EpochError::BatchNotStale`.

---

### [H-4] Missing Vault Margin Validation During Liquidation

- **Reported Severity:** HIGH
- **Verified Severity:** HIGH
- **Confidence:** HIGH (100%)
- **Source References:**
  - `programs/epoch/src/instructions/liquidate.rs#L138-L175`

#### 1. Source Code & Execution Path
In `liquidate.rs`:
```rust
// 8. Transfer position between user and Backstop Vault at oracle price m (spec §10.4)
let notional = ((abs_base * oracle_price as u128) / 1000) as u64;
let old_user_base = user.base_position;
let old_vault_base = vault_user.base_position;

if old_user_base > 0 {
    // Liquidatee was LONG: sells base position to vault
    user.base_position = 0;
    user.quote_position = user.quote_position.checked_add(notional as i128)?;

    vault_user.base_position = vault_user.base_position.checked_add(old_user_base)?;
    vault_user.quote_position = vault_user.quote_position.checked_sub(notional as i128)?;
} else {
    // Liquidatee was SHORT: buys base position from vault
    user.base_position = 0;
    user.quote_position = user.quote_position.checked_sub(notional as i128)?;

    vault_user.base_position = vault_user.base_position.checked_add(old_user_base)?;
    vault_user.quote_position = vault_user.quote_position.checked_add(notional as i128)?;
}
```

#### 2. Verification & Exploitability Analysis
1. **Zero Margin Check on Absorbing Party:**
   - The liquidatee's position and notional balance are transferred directly into `vault_user`.
   - `liquidate.rs` performs **no margin check** (`check_margin_requirement`) on `vault_user`.
   - `liquidate.rs` performs **no check against `vault_params.max_inventory_lots`**.
2. **Cascading Insolvency:**
   - If a whale trader with 50,000 lots is liquidated during high market volatility, `vault_user` is forced to absorb the 50,000 lots.
   - If the Backstop Vault only possesses $50,000 USDC of collateral, absorbing a massive position drives the vault's equity deeply negative:
     $$\text{vault\_equity} < 0$$
   - The vault becomes insolvent and cannot meet future liquidation obligations.
   - Furthermore, `vault_user.base_position` can exceed `max_inventory_lots` by orders of magnitude, breaking the risk limits configured in `VaultParams`.

#### 3. Attack Scenario
A malicious trader opens a maximum-leverage long position opposite the vault. The trader orchestrates a liquidation event during an external price dump. The entire toxic position is dumped into the Backstop Vault, wiping out 100% of the vault's LP collateral and creating systemic bad debt.

#### 4. Remediation
1. Verify that `vault_user` maintains sufficient maintenance margin after absorbing the liquidated position:
   ```rust
   let vault_equity = vault_user.collateral as i128 + vault_user.quote_position + 
       (vault_user.base_position as i128 * oracle_price as i128) / 1000;
   require!(vault_equity > 0, EpochError::InsufficientCollateral);
   ```
2. Enforce that absorption does not exceed vault risk bounds or trigger socialized auto-deleveraging (ADL) if the vault cannot absorb the size.

#### 5. Regression Test Specification
- `test_liquidation_rejects_if_vault_rendered_insolvent`: Set up a liquidation of a position exceeding vault collateral equity. Assert that liquidation either rejects or triggers protocol fallback rather than pushing vault equity below 0.

---

### [H-5] Oracle Anchor-Price Window Manipulation & Cranker Selection

- **Reported Severity:** HIGH
- **Verified Severity:** HIGH
- **Confidence:** HIGH (95%)
- **Source References:**
  - `programs/epoch/src/instructions/post_price.rs#L80-L119`
  - `programs/epoch/src/instructions/clear_batch.rs#L146-L158`
  - `docs/THREAT_MODEL.md#L61` (Risk R2)

#### 1. Source Code & Execution Path
In `programs/epoch/src/instructions/post_price.rs`:
```rust
// Layer B: Cumulative Anchor Bound (slower reference price updated at 75-slot / ~30s cadence)
if oracle.anchor_price == 0 {
    oracle.anchor_price = oracle.price;
    oracle.anchor_slot = clock.slot;
} else if clock.slot.saturating_sub(oracle.anchor_slot) >= 75 {
    // Window expired: anchor advances to previous window's closing price
    oracle.anchor_price = oracle.price;
    oracle.anchor_slot = clock.slot;
}

let anchor_delta = (price as i128 - oracle.anchor_price as i128).unsigned_abs();
let anchor_move_bps = (anchor_delta * 10_000) / oracle.anchor_price as u128;
require!(
    anchor_move_bps <= 30u128,
    EpochError::OraclePriceJumpTooLarge
);
```

#### 2. Verification & Exploitability Analysis
1. **Window Boundary Stacking Attack:**
   - An oracle update posted at slot $t = \text{anchor\_slot} + 74$ can push price by $+30\text{ bps}$ relative to `anchor_price`.
   - At the very next slot $t = \text{anchor\_slot} + 75$, `clock.slot - oracle.anchor_slot >= 75` evaluates to true.
   - The anchor price is instantly updated to `oracle.price` (the $+30\text{ bps}$ price), and `anchor_slot` resets.
   - In that same slot 75 or slot 76, the oracle signer can post another $+15\text{ to }+30\text{ bps}$ move.
   - Result: In just 1–2 slots, the price moves $+45\text{ to }+60\text{ bps}$, circumventing the intended rate-limiting design of 60 bps per minute.
2. **Oracle Lockout / Permanent DoS During Market Volatility:**
   - If an RPC disconnect or network lull lasts $>75$ slots, real market prices may move $>30\text{ bps}$ (e.g. SOL moves $1\%$).
   - Layer A correctly allows catch-up (up to 100 bps via `allowed_single_move_bps`).
   - However, Layer B strictly enforces `anchor_move_bps <= 30`. When `anchor_slot` advances, `anchor_price` resets to `oracle.price` (the old price from before the disconnect).
   - Any attempt to post the real market price ($+50\text{ bps}$) will **permanently revert** with `EpochError::OraclePriceJumpTooLarge`.
   - The oracle is completely deadlocked until the keeper posts multiple artificial dummy transactions spaced across 75-slot intervals.
3. **Cranker Oracle Selection Option (Pyth Mode):**
   In `clear_batch.rs` lines 147-154, any `PriceUpdateV2` with `close_slot <= posted_slot <= close_slot + max_clear_delay_slots` is accepted. If 5 price updates occurred in that window, the cranker possesses a "free look" option to submit the price that maximizes the cranker's fill profits.

#### 3. Remediation
1. Use an exponential moving average (EMA) or continuous sliding window instead of a discrete resetting 75-slot anchor.
2. Allow Layer B anchor bound to expand proportionally during outages (`saturating_sub(75)` slot allowance).
3. In `clear_batch.rs`, enforce strict determinism by requiring the **first** Pyth update with `posted_slot >= close_slot`.

---

### [M-1] Ring Slot Reuse Deadlock & Griefing

- **Reported Severity:** MEDIUM
- **Verified Severity:** HIGH
- **Confidence:** HIGH (100%)
- **Source References:**
  - `programs/epoch/src/instructions/place_order.rs#L128-L139`
  - `programs/epoch/src/instructions/vault_quote.rs#L156-L167`

#### 1. Source Code & Execution Path
```rust
let mut batch = ctx.accounts.batch.load_mut()?;
if batch.batch_id != target_batch {
    let is_reusable = batch.status == BatchStatus::EMPTY
        || batch.status == BatchStatus::SETTLED
        || batch.num_orders == 0
        || (batch.settled_orders >= batch.num_orders);

    if is_reusable {
        batch.reset_for_batch(target_batch);
    } else {
        return err!(EpochError::RingSlotBusy);
    }
}
```

#### 2. Verification & Exploitability Analysis
1. A ring slot $r \in [0, 7]$ represents batch sequence numbers $r, r+8, r+16, \dots$.
2. If any order in batch $B$ remains unsettled (`settled_orders < num_orders`), `is_reusable` returns `false`.
3. Any user attempting to place an order in batch $B + 8$ is rejected with `EpochError::RingSlotBusy` (error 6007).
4. **Denial of Service Griefing:** An attacker places an order in batch $B$. If the batch clears or voids, but the attacker never calls `settle_users`, the ring slot remains occupied. If the automated keeper fails or is delayed (e.g. Due to H-1 underflow), the slot remains permanently blocked.
5. Once all 8 ring slots contain 1 unsettled order, no user can place an order in any future batch.

#### 3. Remediation
Allow permissionless batched settlement or allow automated rollover where unsettled orders in stale batches are forcibly voided/settled during batch resetting if `current_slot > close_slot + max_delay * 2`.

---

### [M-2] Inefficient Keeper Liquidation Scanning

- **Reported Severity:** MEDIUM
- **Verified Severity:** MEDIUM
- **Confidence:** HIGH (100%)
- **Source References:**
  - `keeper/src/keeper.ts#L1095-L1146`

#### 1. Analysis & Impact
In `keeper/src/keeper.ts`:
```typescript
const users = await (this.program.account as any).userAccount.all();
```
On every liquidation scan tick, the keeper executes `getProgramAccounts` across the entire cluster to fetch all `UserAccount` instances.
- **RPC Denial of Service:** When the number of users grows into thousands, this query returns megabytes of data every few seconds, quickly hitting rate limits (HTTP 429) on public and private RPCs (Helius/Triton).
- **Event Loop Starvation:** Serial processing and JSON deserialization in Bun/Node.js blocks the thread, delaying the keeper's critical duty: calling `clearBatch` before `max_clear_delay_slots` expires.
- **Sequential Liquidation:** Liquidations are executed in a sequential `for` loop awaiting confirmation one-by-one.

#### 2. Remediation
1. Maintain an off-chain indexed cache of user positions, updating incrementally via WebSocket account subscriptions (`connection.onProgramAccountChange`).
2. Maintain an in-memory priority min-heap ordered by liquidation distance ($\text{equity} / \text{MMR}$).
3. Scan only accounts near the liquidation boundary.

---

### [M-3] Vault Margin Validation and Pending Lots

- **Reported Severity:** MEDIUM
- **Verified Severity:** MEDIUM
- **Confidence:** HIGH (100%)
- **Source References:**
  - `programs/epoch/src/instructions/liquidate.rs#L85-L88`
  - `programs/epoch/src/instructions/vault_quote.rs#L280-L295`

#### 1. Analysis & Impact
In `liquidate.rs`:
```rust
require!(
    user.pending_buy_lots == 0 && user.pending_sell_lots == 0 && user.active_orders == 0,
    EpochError::HasPendingOrders
);
```
The check verifies that the *liquidatee* has zero pending orders, but completely ignores `vault_user.pending_buy_lots` and `vault_user.pending_sell_lots`.
The Backstop Vault routinely maintains active quotes across multiple batches. If the vault is forced to absorb a liquidated position while it has large pending commitments in the auction book, the combination of absorbed inventory and pending auction fills can breach margin requirements or invert inventory limits when those batches clear.

#### 2. Remediation
In `liquidate.rs`, verify `vault_user` worst-case exposure including `pending_buy_lots` and `pending_sell_lots`.

---

### [M-4] `skipPreflight` Usage in Keeper

- **Reported Severity:** MEDIUM
- **Verified Severity:** MEDIUM
- **Confidence:** HIGH (100%)
- **Source References:**
  - `keeper/src/keeper.ts#L308`
  - `scripts/*.ts` (pervasive across automation scripts)

#### 1. Analysis & Impact
In `keeper/src/keeper.ts`:
```typescript
const sig = await sendAndConfirmTransaction(
  this.connection,
  tx,
  [this.keypair],
  { skipPreflight: true, commitment: "confirmed" }
);
```
`skipPreflight: true` bypasses local RPC simulation before broadcasting to validators.
- When an auction batch is missed, or a ring slot is busy, or math underflows, the transaction is broadcast anyway and included as a **failed transaction on-chain**.
- The keeper pays transaction fees and priority fees on 100% of failed transactions.
- During rapid loop errors (e.g. `RingSlotBusy` or RPC block height timeouts), the keeper sends dozens of failing transactions per minute, draining its SOL balance to zero in hours. When balance falls below `0.05 SOL`, the keeper shuts down.

#### 2. Remediation
Set `skipPreflight: false` by default, or run an initial local simulation via `connection.simulateTransaction`. Only skip preflight for time-critical clearance transactions if preceded by an in-memory state pre-check.

---

### [M-5] Missing `close_user` Instruction

- **Reported Severity:** MEDIUM
- **Verified Severity:** LOW
- **Confidence:** HIGH (100%)
- **Source References:**
  - `programs/epoch/src/instructions/create_user.rs`
  - `programs/epoch/src/state/user.rs`

#### 1. Analysis & Impact
`UserAccount` allocates $8 + 176 = 184\text{ bytes}$ on-chain, requiring $\approx 0.0022\text{ SOL}$ in rent-exempt lamports.
There is no `close_user` instruction in the program. Even if a user closes all positions, cancels all orders, and withdraws 100% of their collateral, their account cannot be closed.
- Permanent rent loss for users.
- State bloat on Solana validators.
- Exacerbates M-2 by forcing keeper `getProgramAccounts` to forever query dormant accounts.

#### 2. Remediation
Implement `close_user`:
```rust
#[derive(Accounts)]
pub struct CloseUser<'info> {
    #[account(
        mut,
        seeds = [b"user", owner.key().as_ref()],
        bump,
        close = owner,
        has_one = owner @ EpochError::Unauthorized,
        constraint = user.base_position == 0 @ EpochError::PositionNotFlat,
        constraint = user.collateral == 0 @ EpochError::CollateralRemaining,
        constraint = user.active_orders == 0 @ EpochError::HasPendingOrders,
    )]
    pub user: AccountLoader<'info, UserAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
}
```

---

### [M-6] Faucet Global Rate Limits

- **Reported Severity:** MEDIUM
- **Verified Severity:** MEDIUM
- **Confidence:** HIGH (100%)
- **Source References:**
  - `programs/epoch/src/instructions/faucet.rs#L37-L45`

#### 1. Analysis & Impact
`faucet.rs` tracks claim cooldowns per-recipient via PDA `seeds = [b"faucet", recipient.key().as_ref()]`.
- There is no global mint rate limit and no daily protocol-wide ceiling.
- An attacker can generate 10,000 ephemeral Solana keypairs and call `faucet` once per keypair, minting tens of millions of mock USDC.
- While mock USDC is devnet-only, an unconstrained faucet allows an attacker to flood the order books, overwhelm the 128-order buffer, or manipulate funding rates.

#### 2. Remediation
Add a global mint volume tracker in `Market` or an admin pause toggle for the faucet.

---

## 3. Additional Vulnerabilities Identified During Audit

---

### [ADD-1] Silent Ring Slot Bricking in `vault_quote.rs` Quote Cancellation

- **Severity:** CRITICAL
- **Confidence:** HIGH (100%)
- **Source Reference:** `programs/epoch/src/instructions/vault_quote.rs#L185-L206`

#### 1. Source Code & Flaw
In `vault_quote.rs`:
```rust
// Cancel any existing orders on the disallowed side (if updating an open batch)
for i in 0..(batch.num_orders as usize) {
    let (is_match, side, tick, lots) = {
        let o = &batch.orders[i];
        if o.user_pda == vault_user_pda && o.status == OrderStatus::OPEN {
            (true, o.side, o.tick as usize, o.lots)
        } else {
            (false, 0, 0, 0)
        }
    };

    if is_match {
        if side == OrderSide::BUY && !allow_bids {
            batch.bid_qty[tick] = batch.bid_qty[tick].saturating_sub(lots);
            vault_user.pending_buy_lots = vault_user.pending_buy_lots.saturating_sub(lots);
            batch.orders[i].status = OrderStatus::CANCELLED;
        } else if side == OrderSide::SELL && !allow_asks {
            batch.ask_qty[tick] = batch.ask_qty[tick].saturating_sub(lots);
            vault_user.pending_sell_lots = vault_user.pending_sell_lots.saturating_sub(lots);
            batch.orders[i].status = OrderStatus::CANCELLED;
        }
    }
}
```

#### 2. Exploitability & Impact Analysis
Notice what is missing compared to `cancel_order.rs`:
1. **`batch.settled_orders` is NOT incremented.**
2. **`vault_user.active_orders` is NOT decremented.**
3. In `settle_users.rs` line 108:
   ```rust
   if order.status == OrderStatus::SETTLED || order.status == OrderStatus::CANCELLED {
       continue;
   }
   ```
   `settle_users` explicitly skips `OrderStatus::CANCELLED` orders!
4. Therefore, `batch.settled_orders` can **never reach `batch.num_orders`**.
5. As a result:
   - `batch.status` will never transition to `SETTLED`.
   - When any future batch targets this ring index, `is_reusable` checks `batch.settled_orders >= batch.num_orders`, which is **false**.
   - The ring slot is **permanently bricked with `RingSlotBusy`**.
   - Additionally, `vault_user.active_orders` leaks upwards on every cancelled quote until it overflows `u8`.

#### 3. Remediation
In `vault_quote.rs` lines 199 and 203, add:
```rust
batch.settled_orders = batch.settled_orders.saturating_add(1);
vault_user.active_orders = vault_user.active_orders.saturating_sub(1);
```

---

### [ADD-2] Non-Monotonic `next_batch_to_clear` Rollback in `clear_batch.rs`

- **Severity:** MEDIUM
- **Confidence:** HIGH (95%)
- **Source Reference:** `programs/epoch/src/instructions/clear_batch.rs#L223`

#### 1. Source Code & Flaw
In `clear_batch.rs`:
```rust
market.next_batch_to_clear = batch_id + 1;
```
Compare with `expire_and_release.rs`:
```rust
if market.next_batch_to_clear <= batch_id {
    market.next_batch_to_clear = batch_id + 1;
}
```
If batch 10 is cleared first, `next_batch_to_clear` becomes 11. If batch 9 clears afterwards (within the permissible delay window), `next_batch_to_clear` is set to `9 + 1 = 10`, rolling the pointer backwards and corrupting off-chain keeper scheduling.

#### 2. Remediation
Change line 223 to:
```rust
if market.next_batch_to_clear <= batch_id {
    market.next_batch_to_clear = batch_id + 1;
}
```

---

### [ADD-3] Permanent Capital Lock in Backstop Vault (Missing Redemption Flow)

- **Severity:** HIGH
- **Confidence:** HIGH (100%)
- **Source Reference:** `programs/epoch/src/instructions/fund_vault.rs` & `withdraw.rs`

#### 1. Analysis & Impact
`fund_vault` allows any LP or admin to transfer USDC into `vault_user`.
However, `vault_user.owner` is `vault_authority` (a PDA).
In `withdraw.rs`, `owner` must be an ed25519 `Signer`.
There is no instruction in the entire Epoch protocol that permits withdrawing funds from `vault_user`. Any capital deposited into the Backstop Vault is permanently locked on-chain with zero redemption path.

#### 2. Remediation
Implement an admin/governance or share-token withdrawal instruction `withdraw_vault` using program PDA signer seeds.

---

### [ADD-4] Arithmetic Negation Overflow & Truncation in `expire_and_release.rs`

- **Severity:** MEDIUM
- **Confidence:** HIGH (90%)
- **Source Reference:** `programs/epoch/src/instructions/expire_and_release.rs#L186`

#### 1. Analysis & Impact
In `expire_and_release.rs`:
```rust
let neg = (-total_funding_residual) as u64;
```
1. If `total_funding_residual == i128::MIN`, negating it in Rust panics in debug mode.
2. In release mode with overflow wrapping, casting to `u64` truncates the upper 64 bits.
In `settle_users.rs`, `checked_abs()` and `u64::try_from()` are properly used.

#### 2. Remediation
Replace with:
```rust
let neg = u64::try_from(total_funding_residual.checked_abs().ok_or(EpochError::MathOverflow)?)
    .map_err(|_| EpochError::MathOverflow)?;
```

---

### [ADD-5] Missing Bad Debt Socialization / Auto-Deleveraging (ADL)

- **Severity:** HIGH
- **Confidence:** HIGH (100%)
- **Source Reference:** `programs/epoch/src/instructions/liquidate.rs#L224-L232`

#### 1. Analysis & Impact
When a user deficit exceeds `market.insurance_fund`, the shortfall is appended to `market.bad_debt`.
However, there is no Auto-Deleveraging (ADL) mechanism to haircut winning positions or socialize the deficit.
The physical token balance in `collateral_vault` is now less than the sum of solvent users' collateral balances. The protocol becomes a fractional reserve, and the last solvent traders attempting to withdraw will receive `InsufficientFunds` errors from the SPL token program.

#### 2. Remediation
Implement an on-chain ADL ranking or deficit socialization haircut before marking bad debt.

---

## 4. Architectural Invariant Assessment

| Invariant | Specification Requirement | Verification Status | Failure Mode / Vulnerability |
| :--- | :--- | :---: | :--- |
| **I-1** | Conservation of Vault Balance: $\sum (C + Q) + \text{fee\_pool} + \text{insurance} == \text{vault\_balance}$ | **BREACHED** | Broken when `bad_debt > 0` (uncollateralized shortfall) and by H-1 underflow aborts. |
| **I-2** | Net Position Conservation: $\sum \text{base\_position} == 0$ | **PRESERVED** | Fills and liquidations strictly conserve net base lots across users and vault. |
| **I-3** | Uniform Price Clearing: All matched orders in a batch clear at identical price $P^*$ | **PRESERVED** | In-batch ladder execution guarantees identical clearing price. |
| **I-4** | Fill Balance: Matched buy lots == Matched sell lots | **PRESERVED** | Auction engine strictly balances $M_b == M_a == Q^*$. |
| **I-5** | Margin Monotonicity: Order placement requires equity $\ge$ IMR | **PRESERVED** | `check_margin_requirement` correctly checks worst-case exposure. |
| **I-6** | Reduce-Only Invariant: Cannot increase position size | **PRESERVED** | Enforced at placement time; does not expand position. |
| **I-7** | Lookahead Horizon: Orders rejected beyond $L$ batches | **PRESERVED** | Checked in `place_order` and `vault_quote`. |
| **I-8** | Sequential Clearance: Batches cleared monotonically | **BREACHED** | ADD-2 allows `next_batch_to_clear` to roll backwards out-of-order. |
| **I-9** | Pyth Full Quorum: Oracle requires `VerificationLevel::Full` | **PRESERVED** | Checked on-chain in `oracle.rs`. |
| **I-10**| No Self-Liquidation: Cannot liquidate against self | **PRESERVED** | Explicit `require_keys_neq!` in `liquidate.rs`. |
| **I-11**| Bad Debt Accountability: Negative equity recorded in `bad_debt` | **BREACHED** | Recorded in counter, but lacks solvency recovery (ADD-5). |
| **I-12**| Order Settlement Conservation: Orders must settle before ring reuse | **BREACHED** | ADD-1 causes permanent order desync in ring reuse. |

---

## 5. Comprehensive Recommendations & Action Plan

### Priority 1: Critical Hotfixes (Immediate)
1. **Fix ADD-1 (`vault_quote.rs`):** Increment `batch.settled_orders` and decrement `vault_user.active_orders` when cancelling resting quotes on disallowed sides.
2. **Fix H-1 (`settle_users.rs` & `expire_and_release.rs`):** Remove fee pool deduction for negative funding residuals during partial user settlements. Use saturating subtraction or isolate funding residual accounting.
3. **Remove Admin Bypasses (H-2 & H-3):** Remove `|| market.admin == ...` from `clear_batch.rs` timing checks and `expire_and_release.rs` staleness checks.
4. **Constrain `update_market_params` (C-2):** Add upper bounds for `liq_penalty_bps` and `funding_cap_bps`. Disallow dynamic mutation of `batch_slots`, `base_lot`, and `k_ticks`.

### Priority 2: High Severity Remediations (Next Release)
1. **Vault Margin Verification in Liquidation (H-4):** Validate `vault_user` equity before position absorption.
2. **Oracle Rate Limiter Rework (H-5):** Transition from 75-slot discrete anchor to sliding window; allow outage catchup in Layer B.
3. **Secrets & Containers (C-1 & ADD-6):** Add `.dockerignore`, revoke exposed Helius key, and remove deploy key fallback from `docker-compose.yml`.
4. **Vault Capital Retrieval (ADD-3):** Implement `withdraw_vault` instruction for LPs.

### Priority 3: Medium / Quality Enhancements
1. **Fix `next_batch_to_clear` (ADD-2):** Monotonic clamp `if market.next_batch_to_clear <= batch_id`.
2. **Keeper Off-Chain Indexing (M-2):** Replace `userAccount.all()` with WebSocket-updated priority min-heap.
3. **Keeper Preflight Verification (M-4):** Run simulations prior to broadcast to eliminate fee burning.
4. **Implement `close_user` (M-5):** Allow flat users with zero collateral to recover account rent.
5. **Global Faucet Cap (M-6):** Implement protocol-wide mint limit.

---

## 6. Lead Architect Coordination Note

This independent audit confirms that while Epoch's core FBA clearing ladder is cryptographically and mathematically sound, the peripheral state machines (ring buffer lifecycle, funding residual accounting, and liquidation absorption) contain critical vulnerabilities that will cause denial of service under normal operational conditions.

Implementation should proceed strictly against the remediations specified above. All findings have been verified on source code without modifying production files.
