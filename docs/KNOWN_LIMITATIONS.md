# Epoch Protocol: Known Architectural and Operational Limitations

This document provides a transparent, rigorous accounting of the current boundaries, trade-offs, and operational limitations of the Epoch Frequent Batch Auction (FBA) perpetual futures protocol as deployed on Solana Devnet.

---

## 1. Batch Execution and Capacity Boundaries

| Dimension | Current Specification / Limit | Architectural Rationale & Behavior at Limit |
| :--- | :--- | :--- |
| **Max Orders Per Batch** | **128 orders** | The batch accounts use zero-copy Borsh layouts fixed at 128 orders to fit within Solana account size and single-transaction clearing Compute Unit (CU) constraints. Orders exceeding 128 in a batch are rejected with `EpochError::BatchFull`. |
| **Ring Buffer Size ($R$)** | **8 ring slots** | Ring index is calculated as `batch_id % 8`. A ring slot cannot be reused while it holds unsettled orders (`RingSlotBusy`, error 6007). Lookahead window is constrained to $L = 3$ batches to prevent ring wrapping collisions under normal clearing latency. |
| **Batch Duration ($N$)** | **2 slots ($477\text{ ms}$ [MEASURED: 238.67 ms/slot])** | Nominally 2 slots. On Devnet, slot duration averages $\approx 238.67\text{ ms}$ (measured across 3,000 slots and 15,000 consensus samples), resulting in batch closure every $\approx 477\text{ ms}$. Batches close automatically on-chain based on slot height (`current_slot >= close_slot`). |
| **Lookahead Window ($L$)** | **3 batches ($6\text{ slots} = 1.43\text{ s}$)** | Orders may target batches up to $L = 3$ ahead ($1.43\text{ s}$ horizon), ensuring reliable landing under network jitter while preventing ring wrap collisions. |
| **Max Clearing Delay** | **20 slots ($4.78\text{ s}$ [MEASURED])** | If no keeper clears a batch within 20 slots ($4.78\text{ s}$) after closure, the batch becomes stale. Stale batches cannot clear matched trades; anyone may call `expire_and_release` to void the batch, release user pending orders, and unblock the ring slot. |

---

## 2. Market and Pricing Boundaries

| Dimension | Current Specification / Limit | Architectural Rationale & Behavior at Limit |
| :--- | :--- | :--- |
| **Single Market (v0)** | **SOL-PERP only** | The current on-chain deployment supports one primary market (`SOL-PERP`). Additional markets require distinct `Market` PDAs and ring buffers. |
| **Tick Discretization** | **101 ticks ($\pm 50\text{ bps}$, $1\text{ bps}$/tick)** | Uniform price clearing searches across 101 discrete offset ticks relative to oracle price. Offsets outside $[-50, +50]\text{ bps}$ are clamped at placement time or rejected. Far-out-of-the-money orders require multiple price bands or limit collars (scheduled for v1). |
| **Oracle Dependence & Verification** | **Pyth Network (Pull Oracle via Receiver Program)** | On-chain clearing, quoting, and liquidation strictly consume Pyth `PriceUpdateV2` accounts owned by the Pyth Receiver program (`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`). The program requires `VerificationLevel::Full`, feed ID match, age $\le 10\text{ s}$ (`max_oracle_age_secs`), confidence $\le 20\text{ bps}$ (`max_conf_bps`), and posting slot $\ge \text{close\_slot}$. Batches without a valid post-close update become `VOID`. Stored mark price (`last_oracle_price`) used in placement margin checks expires after $\approx 30$ slots without clearing. |
| **Last-Look & Visible Orders** | **Public Mempool & Ledger Transparency** | Orders submitted to a future batch are public on-chain or in the validator mempool. A participant placing orders in the final slot of a batch has informational advantage over orders submitted earlier. Uniform price clearing eliminates priority ordering advantage within the auction, but does NOT provide cryptographic privacy or eliminate last-look informational asymmetry (commit-reveal is required for full last-look elimination). |
| **Order Types Supported** | **Limit Orders & Market-at-Batch** | Limit orders with tick offset. Stop-loss, take-profit, and good-till-cancelled orders are not native in v0; they can be built as keeper-triggered off-chain conditional orders. |

---

## 3. Account and Settlement Boundaries

| Dimension | Current Specification / Limit | Architectural Rationale & Behavior at Limit |
| :--- | :--- | :--- |
| **Single-Page Settlement Limit** | **16 users / transaction** | Solana legacy transaction account limits cap single-transaction user settlements. If a batch contains $>16$ distinct users, clearing and settlement unbundle: `clear_batch` executes first, followed by paged calls to `settle_users` or `expire_and_release`. |
| **Withdrawal Requirements** | **Flat position ($b = 0$) & 0 active orders** | To strictly prevent margin evasion or front-running pending batch executions, collateral withdrawal requires $b = 0$ and `pending_lots == 0` (Invariants I-1, I-4, I-12). |
| **Leverage & Margin** | **Max 10x ($1000\text{ bps}$ IMR), 5% MMR ($500\text{ bps}$)** | Conservative initial parameters. Cross-margin or portfolio margin across multiple sub-accounts is not implemented in v0. |

---

## 4. Operational & Network Realities

1. **Pyth Hermes Streaming Liveness & Posting Overhead:**
   - The on-chain program does not fetch off-chain data itself. The keeper must continuously pull binary price updates from Pyth Hermes (`hermes.pyth.network`) and submit an on-chain transaction to post the update to a `PriceUpdateV2` account prior to calling `clear_batch`.
   - If Hermes experiences downtime, network partitions, or rate limits, the keeper cannot generate valid price accounts. Under Hermes outage, batches close but cannot be cleared, eventually exceeding `max_clear_delay_slots` and forcing `expire_and_release` (auction voiding).
   - Price posting incurs additional transaction latency and transaction fees (~5,000 to 10,000 lamports per post).
2. **Devnet RPC Rate-Limiting & Block Time Jitter:**
   - Public Solana Devnet RPC nodes (`api.devnet.solana.com`) periodically throttle client requests or experience slot time fluctuations (measured $239\text{--}280\text{ ms/slot}$).
   - The Epoch UI handles RPC outages via an explicit, non-simulated warning banner (`DEVNET RPC OUTAGE: Solana Devnet RPC cluster is unreachable. Live widgets are frozen.`), completely disabling synthetic fallbacks.
3. **Keeper Centralization in Devnet Release:**
   - While the on-chain protocol is 100% permissionless (anyone can crank `clear_batch`, `settle_users`, or `expire_and_release`), the automated keeper is currently provided as a local node daemon. In a production mainnet deployment, a distributed cranker network with MEV-resistant tips is required.

---

## 5. Privileged & Admin Instruction Audit (Round 12 Freeze Audit)

Epoch strictly enforces mathematical invariants ($I-1$ to $I-12$). An audit of all on-chain instructions confirms that **no privileged backdoor instructions exist for the admin to arbitrarily edit user positions, collaterals, or balances outside the standard invariant-constrained state machine (deposit, withdraw, auction settlement, and liquidation)**.

| Instruction | Privilege Level | Permitted Scope & Mutation Target | Impact on Positions / Balances |
| :--- | :--- | :--- | :--- |
| `initialize_market` | Initializer (One-time) | Initializes global `Market` PDA and sets initial risk bounds. | Cannot edit balances or positions. |
| `create_user` | Permissionless | Allocates new `UserAccount` PDA for caller. | Zero balance / zero position initialized. |
| `faucet` | Devnet/Testnet Only | Mints mock USDC SPL tokens to caller ATA (capped at $10,000$ USDC with 60s cooldown). | Does not alter internal margin ledger. |
| `deposit` | Permissionless (User) | Transfers SPL tokens into vault; credits caller collateral. | Conserves Invariant $I-1$ ($\Delta C = \text{tokens}$). |
| `withdraw` | Permissionless (User) | Debits caller collateral; transfers SPL tokens (flat position only). | Conserves Invariant $I-1$ ($b = 0$, pending $= 0$). |
| `initialize_batch` | Admin (`market.admin`) | Initializes zero-copy `Batch` ring buffer slot with ring index bounds. | Cannot edit user positions or balances. |
| `place_order` | Permissionless (User) | Enqueues user order into target batch; locks margin. | Standard order placement; user-signed only. |
| `cancel_order` | Permissionless (User) | Cancels pending order before batch close; unlocks margin. | Caller-owned orders only. |
| `clear_batch` | Permissionless (Cranker) | Computes uniform clearing price $P^*$ via socialized crossing. | Deterministic auction math; cannot inject fills. |
| `update_market_params` | Admin (`market.admin`) | Updates governance parameters (`batch_slots`, `imr_bps`, `fee_bps`). | **Cannot touch or edit user accounts or positions.** |
| `settle_users` | Permissionless (Cranker) | Executes uniform fills and updates base/quote positions. | Strictly conserves $\sum \text{base} = 0$ and $I-1$. |
| `initialize_vault_user` | Admin (`market.admin`) | One-time creation of Backstop Vault `UserAccount` PDA. | Cannot edit existing user accounts. |
| `fund_vault` | Permissionless | Deposits mock USDC into Backstop Vault collateral. | Increases vault equity; cannot alter user accounts. |
| `vault_quote` | Permissionless (Cranker) | Places deterministic liquidity rungs for Backstop Vault. | Governed by on-chain inventory limits & allowed sides. |
| `update_vault_params` | Admin (`market.admin`) | Updates vault risk parameters (`max_inventory_lots`, spread, skew). | **Cannot edit vault or user balances/positions.** |
| `liquidate` | Permissionless (Liquidator)| Liquidates undercollateralized accounts against vault. | Strictly verifies $\text{equity} < \text{MMR}$. |
| `expire_and_release` | Permissionless (Cranker) | Voids stale batches and unblocks ring slots. | Releases pending lots; preserves settled ledger. |

### Vault Rebalancing Mechanics (`scripts/rebalance_vault.ts`)
The protocol does **not** possess any backdoor instruction to reset or manipulate vault positions. As proven in Round 12, rebalancing the Backstop Vault is executed entirely through the permissionless clearing pipeline:
1. The admin calls `update_vault_params` to temporarily expand `max_inventory_lots` if required.
2. The admin places an offsetting market order via `place_order`.
3. The order clears against the vault via standard uniform-price auction (`clear_batch` and `settle_users`), guaranteeing that $\sum \text{base} = 0$ and Invariant $I-1$ hold at every step.
4. The admin restores `max_inventory_lots` to default ($10,000$ lots).

