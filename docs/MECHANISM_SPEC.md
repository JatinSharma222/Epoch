# Design spec; as-built deviations are in KNOWN_LIMITATIONS.md

This document defines the core mathematical mechanism specification for Epoch Protocol Frequent Batch Auctions (FBA). Both the Solana on-chain program (`programs/epoch`) and the off-chain reference engine (`crates/epoch-ref`) implement this specification.

Keywords MUST, SHOULD, and MAY are used in their standard RFC senses.

---

## 1. Numerics and Units

| Quantity | Representation | Notes |
|---|---|---|
| Quote (USDC) | `i64`/`i128` micro-USDC (6 decimals) | 1 USDC = 1,000,000 micro-USDC |
| Base (SOL) position | `i64` **lots** | 1 lot = 0.001 SOL |
| Price | `u64` micro-USDC per 1 SOL | e.g. $150.000 = 150,000,000 micro-USDC |
| Price tick | `price_tick = 1000` micro-USDC ($0.001) | Every price used in settlement MUST be an exact multiple of `price_tick` |
| Offset | `i16` basis points (1 bp = 0.01%) | Grid coordinate |
| Ticks | `u16` index in `[0, K−1]` | `K` odd (default 101). Offset of tick `t` is `(t − c) × tick_bps`, with `c = (K−1)/2` and `tick_bps = 1` |

**Notional of a fill:**
$$\text{notional} = \text{lots} \times \frac{\text{price}}{1000} \quad (\text{micro-USDC})$$

Because `price` is a multiple of 1,000 and 1 lot represents 0.001 SOL, this product is an **exact integer**, eliminating rounding drift from the quote ledger.

**Arithmetic rules:** All intermediate calculations MUST use `u128` or `i128`. All divisions MUST be specified as floor or ceiling. Overflow MUST return an error and never wrap.

---

## 2. Order Model

An order is represented as `(user, slot_id, side, tick, lots, flags)` targeting one specific batch:

- `side ∈ {BUY, SELL}`.
- `tick` represents the **limit**:
  - A BUY at tick $t$ is willing to pay up to $\text{oracle\_price} \times (1 + \text{offset}(t)/10,000)$.
  - A SELL at tick $t$ is willing to sell down to $\text{oracle\_price} \times (1 + \text{offset}(t)/10,000)$.
- **Market order:** BUY at tick $K-1$, SELL at tick $0$ (the boundary ticks of the band).
- Orders must meet `lots ≥ min_order_lots` and notional at oracle $\ge \$10$ to prevent dust spam.
- **Good-for-one-batch:** Unfilled lots expire when the target batch clears.
- `slot_id ∈ [0, 8)`: Allows concurrent independent orders per user per batch. The key `(user, batch, slot_id)` identifies an order; placing on an existing ID replaces the order.
- `flags`: `REDUCE_ONLY` (validated at placement time; see §5) and `LIQUIDATION` (protocol-generated).

---

## 3. Aggregation

For each batch, the program maintains two arrays of length $K$:

```
bid_qty[t] = total lots of BUY orders whose limit tick is exactly t
ask_qty[t] = total lots of SELL orders whose limit tick is exactly t
```

- `place_order` adds lots to the corresponding array index.
- `cancel_order` subtracts lots.
- Order replacement subtracts the old order and adds the replacement.
These arrays form public on-chain state from which crossing demand and supply curves are derived.

---

## 4. Uniform Price Clearing Algorithm

Inputs: `bid_qty[0..K)`, `ask_qty[0..K)`.  
Output: clearing tick $i^*$, matched volume $Q^*$, or "no trade".

### Cumulative Curves
$$D[t] = \sum_{j \ge t} \text{bid\_qty}[j] \quad \text{(Demand: cumulative lots demanded at offset } t \text{ or better)}$$
$$S[t] = \sum_{j \le t} \text{ask\_qty}[j] \quad \text{(Supply: cumulative lots offered at offset } t \text{ or lower)}$$
$$V[t] = \min(D[t], S[t]) \quad \text{(Executable crossing volume at tick } t\text{)}$$

$D[t]$ is non-increasing and $S[t]$ is non-decreasing with respect to $t$.

### Clearing Steps
1. **Maximum Volume:** $V_{max} = \max_t V[t]$. If $V_{max} == 0$, no trade occurs.
2. **Volume Plateau:** $P = \{ t : V[t] == V_{max} \}$. Because $V[t]$ is unimodal, $P$ is a contiguous tick interval.
3. **Minimum Imbalance:** Inside $P$, find $Q = \arg\min_t |D[t] - S[t]|$. Since $|D - S|$ is convex, $Q$ forms a contiguous interval $[lo, hi]$.
4. **Midpoint & Center Rounding:** $i^* = (lo + hi) / 2$. If $lo + hi$ is odd, the midpoint $x.5$ rounds toward the center tick $c$ (offset 0). The matched lots are $Q^* = V_{max}$.
5. **Uniform Clearing Price:** $\text{offset}^* = (i^* - c) \times \text{tick\_bps}$.
$$\text{price}^* = \text{round\_to\_price\_tick}\left( \text{oracle\_price} \times \frac{10,000 + \text{offset}^*}{10,000} \right)$$
Rounding resolves to the nearest multiple of `price_tick`, with exact ties resolving toward the oracle price. Every matched order in the batch trades at this single price $\text{price}^*$.

---

## 5. Fill Allocation

Every matched trade conserves volume: $\sum \text{buy\_fills} \equiv \sum \text{sell\_fills} \equiv Q^*$.  
Allocation follows **price priority, then pro-rata at the marginal tick, with a deterministic dust rule**.

### Buy-Side Allocation
Find the marginal buy tick $t_b = \max \{ t : D[t] \ge Q^* \}$:
- $\text{strictly\_better}_b = D[t_b + 1]$
- $M_b = Q^* - \text{strictly\_better}_b$
- $T_b = \text{bid\_qty}[t_b]$

Rules:
- BUY orders with $\text{tick} > t_b$ fill **in full**.
- BUY orders with $\text{tick} == t_b$ fill pro-rata: $\text{fill} = \lfloor \text{lots} \times M_b / T_b \rfloor$ plus deterministic dust.
- BUY orders with $\text{tick} < t_b$ receive zero fill.

### Sell-Side Allocation
Find the marginal sell tick $t_a = \min \{ t : S[t] \ge Q^* \}$:
- $\text{strictly\_better}_a = S[t_a - 1]$ (or 0 if $t_a = 0$)
- $M_a = Q^* - \text{strictly\_better}_a$
- $T_a = \text{ask\_qty}[t_a]$

Rules:
- SELL orders with $\text{tick} < t_a$ fill **in full**.
- SELL orders with $\text{tick} == t_a$ fill pro-rata: $\text{fill} = \lfloor \text{lots} \times M_a / T_a \rfloor$ plus deterministic dust.
- SELL orders with $\text{tick} > t_a$ receive zero fill.

### Deterministic Dust Rule
At the marginal tick with orders $o_1, \dots, o_n$ in order buffer sequence:
$$r_k = (\text{lots}_k \times M) \pmod T$$
$$\text{floor}_k = \lfloor \text{lots}_k \times M / T \rfloor$$
$$\text{dust} = M - \sum \text{floor}_k$$

The program awards $+1$ lot to the first $\text{dust}$ orders in arrival buffer order that have $r_k > 0$. This guarantees $\sum \text{fill}_k = M$ down to the single lot with zero float rounding.

### Rationality Proof
Because $Q^* \le D[i^*]$ and $Q^* \le S[i^*]$, allocating $Q^*$ from best price downward never touches ticks below $i^*$ on the buy side, nor ticks above $i^*$ on the sell side. Therefore, every filled buyer limit is $\ge \text{price}^*$ and every filled seller limit is $\le \text{price}^*$.

### Reduce-Only
Reduce-only validation is enforced at order placement time: order lots cannot exceed the trader's existing opposite-side position. Fills are not capped during settlement to preserve the fundamental conservation invariant $\sum \text{base\_position} = 0$.

---

## 6. Worked Examples

### Worked Example A: Basic Crossing
- Oracle price: $\$150.000$. Grid offsets in bps.

| Order | Side | Limit Offset | Lots |
|---|---|---|---|
| B1 | BUY | +5 | 10 |
| B2 | BUY | +3 | 20 |
| B3 | BUY | 0 | 15 |
| B4 | BUY | −2 | 30 |
| A1 | SELL | −4 | 12 |
| A2 | SELL | 0 | 18 |
| A3 | SELL | +3 | 25 |
| A4 | SELL | +6 | 10 |

**Cumulative Crossing Table:**

| Offset | D | S | V = min(D,S) | \|D−S\| |
|---|---|---|---|---|
| −4 | 75 | 12 | 12 | 63 |
| −2 | 75 | 12 | 12 | 63 |
| −1 | 45 | 12 | 12 | 33 |
| 0 | 45 | 30 | **30** | 15 |
| +1 | 30 | 30 | **30** | **0** |
| +2 | 30 | 30 | **30** | **0** |
| +3 | 30 | 55 | **30** | 25 |
| +4 | 10 | 55 | 10 | 45 |

- $V_{max} = 30$, plateau spans offsets 0 to +3.
- Minimum imbalance is 0 at ticks +1 and +2. Midpoint is 1.5, which rounds toward 0 to **+1 bp**.
- Execution: $\text{price}^* = \text{round}(150.000 \times 1.0001) = \$150.015$. Matched lots $Q^* = 30$.
- Fills:
  - Buy side: B1 (+5) fills 10 lots in full; B2 (+3) fills 20 lots in full; B3 and B4 receive 0.
  - Sell side: A1 (−4) fills 12 lots in full; A2 (0) fills 18 lots in full; A3 and A4 receive 0.
  - Every fill executes at the identical uniform price of $\$150.015$.

### Worked Example B: Pro-Rata and Dust
- Marginal tick holds two orders: 20 lots and 30 lots ($T = 50$). Available lots $M = 20$.
  - Fills: $\lfloor 20 \times 20 / 50 \rfloor = 8$ lots and $\lfloor 30 \times 20 / 50 \rfloor = 12$ lots. Total = 20 lots (0 dust).
- Dust scenario: Three orders of 7 lots each ($T = 21$), with $M = 10$.
  - $\lfloor 7 \times 10 / 21 \rfloor = 3$ lots each. $\sum \text{floor} = 9$, leaving $\text{dust} = 1$.
  - First order in buffer order receives $+1$ lot: fills are 4, 3, and 3 lots (total = 10).

### Worked Example C (§6.1): Market Buy Against Vault Quoting Ladder
Vault Asks: 500 lots @ +12 bps, 1,000 lots @ +18 bps, 2,000 lots @ +25 bps (total depth: 3.5 SOL).  
Taker: 1,000 lots market buy (limit +50 bps).

- Supply $S$: 500 on offsets [12..17], 1,500 on [18..24], and 3,500 on [25..50].
- Demand $D$: 1,000 across [12..50].
- $V = \min(D, S)$ is 500 on [12..17] and 1,000 on [18..50]. Thus $V_{max} = 1,000$.
- The plateau spans [18..50].
- Imbalance $|D - S|$: 500 on [18..24], and 2,500 on [25..50].
- The minimum imbalance plateau is [18..24], whose midpoint is **+21 bps**.
- **Uniform Clearing Result:** All 1,000 lots clear at **+21 bps**. Total taker cost is $+21\text{ bps} + 5\text{ bps fee} = 26\text{ bps}$ one-way.
- For a 10-lot buy against the same ladder, the minimum imbalance spans [12..17], with midpoint 14.5 rounding toward 0 to **+14 bps**.

---

## 7. Position & Quote Accounting

Each user account maintains `base_position` (lots), `quote_position` (micro-USDC), and `collateral` (micro-USDC).

### Applying a Fill
For fill volume $f$ at price $\text{price}^*$:
$$\text{notional} = f \times \frac{\text{price}^*}{1000}$$
- BUY: $\text{base\_position} \mathrel{+}= f$; $\text{quote\_position} \mathrel{-}= \text{notional}$
- SELL: $\text{base\_position} \mathrel{-}= f$; $\text{quote\_position} \mathrel{+}= \text{notional}$
- Protocol Fee: $\text{fee} = \lceil \text{notional} \times \text{fee\_bps} / 10,000 \rceil$; deducted from `collateral` and credited to `market.fee_pool`.

### Mark-to-Market Equity
$$\text{equity} = \text{collateral} + \text{quote\_position} + \text{base\_position} \times \frac{m}{1000}$$
where $m$ is the Pyth oracle mark price.

Because every fill is paired, $\sum \text{base\_position} \equiv 0$ always. Realized PnL is folded into collateral when positions return to flat (`base_position == 0`).

---

## 8. Funding Accrual

Funding anchors the perpetual futures contract to the oracle price without requiring a separate spot market index:
- Premium per cleared batch: $\text{premium\_bps} = \text{offset}^*$ for batches with $Q^* > 0$.
- Rate clamp: $\text{rate} = \text{clamp}(\text{premium\_bps}, -\text{funding\_cap\_bps}, +\text{funding\_cap\_bps})$.
- Global funding index accrues per batch:
$$\Delta \text{index} = \frac{\text{rate\_bps} \times (m / 1000) \times N \times 10^9}{10,000 \times \text{funding\_period\_slots}}$$
- Per-user funding payment: $\text{payment} = \text{base\_position} \times (\text{index} - \text{snapshot}) / 10^9$. Longs pay shorts when the index rises. Rounding residuals accrue to `market.fee_pool`.

---

## 9. Margin Requirements

- **Initial Margin Requirement (IMR):** 1,000 bps (10x maximum leverage).
- **Maintenance Margin Requirement (MMR):** 500 bps (5%).

On `place_order`:
$$\text{worst\_abs} = \max\left(|\text{base} + \text{pending\_buys} + \text{this\_buy}|, |\text{base} - \text{pending\_sells} - \text{this\_sell}|\right)$$
$$\text{slip\_reserve} = (\text{total\_pending\_lots} + \text{this\_order}) \times \frac{m \times \text{band\_bps}}{10,000 \times 1000}$$
$$\text{required\_margin} = \frac{\text{imr\_bps} \times \text{worst\_abs} \times m_{hi}}{10,000 \times 1000} + \text{slip\_reserve}$$
Order submission requires $\text{equity}(m) \ge \text{required\_margin}$.

An account becomes liquidatable when:
$$\text{equity}(m) < \frac{\text{mmr\_bps} \times |\text{base\_position}| \times m}{10,000 \times 1000}$$

---

## 10. Liquidation

1. Anyone may invoke `liquidate(user)`.
2. The program verifies $\text{equity}(m) < \text{MMR}$.
3. The liquidator clears the undercollateralized position directly against the Backstop Vault at the oracle mark price $m$.
4. Liquidation penalty (`liq_penalty_bps = 100`) transfers from the liquidated account's remaining equity into `insurance_fund`.
5. If equity is negative, the insurance fund absorbs the deficit. Any remaining unbacked deficit is transparently recorded in `market.bad_debt`.

---

## 11. Core Mathematical Invariants

| ID | Invariant | Description |
|---|---|---|
| **I-1** | **Conservation** | $\sum_{\text{users}} (\text{collateral} + \text{quote\_position}) + \text{fee\_pool} + \text{insurance\_fund} \equiv \text{vault token balance}$, and $\sum \text{base\_position} \equiv 0$. |
| **I-2** | **Single Price** | Every fill in batch $b$ trades at the identical uniform price $\text{price}^*(b)$. |
| **I-3** | **Rationality** | Zero trade-through: no buyer fills above limit offset; no seller fills below limit offset. |
| **I-4** | **Volume Balance** | $\sum \text{buy\_fills} \equiv \sum \text{sell\_fills} \equiv Q^*$. |
| **I-5** | **Maximality** | No executable order strictly better than $i^*$ remains unfilled. |
| **I-6** | **Determinism** | Identical inputs generate bit-for-bit identical outputs across on-chain Rust and reference engines. |
| **I-7** | **Bounds** | $0 \le \text{fill}_k \le \text{lots}_k$ for all orders. |
| **I-8** | **Aggregate Consistency** | Arrays `bid_qty` and `ask_qty` strictly equal sum of active orders in the buffer. |
| **I-9** | **Order Independence** | Arrival order within a batch does not alter the clearing tick or fill amounts (except $+1$ dust at the marginal tick). |
| **I-10** | **No Silent Overflow** | All arithmetic either succeeds exactly or produces a runtime error. |
| **I-11** | **Post-Liquidation Safety** | Equity cannot drop below 0 without recording bad debt. |
| **I-12** | **Settlement Completeness** | A batch transitions to `SETTLED` if and only if all matched orders have settled. |

---

## 12. Reference Clearing Algorithm

```rust
pub struct Marginal { pub tick: u16, pub alloc: u64, pub total: u64 }
pub struct Clear {
    pub tick: u16,            // i*
    pub matched: u64,         // Q*
    pub bid: Marginal,        // (t_b, M_b, T_b)
    pub ask: Marginal,        // (t_a, M_a, T_a)
}

pub fn clear(bid_qty: &[u64], ask_qty: &[u64]) -> Option<Clear> {
    let k = bid_qty.len();
    let c = (k - 1) / 2;
    let mut d = vec![0u64; k + 1];
    for t in (0..k).rev() { d[t] = d[t + 1] + bid_qty[t]; }
    let mut s = vec![0u64; k];
    let mut acc = 0u64;
    for t in 0..k { acc += ask_qty[t]; s[t] = acc; }

    let v = |t: usize| d[t].min(s[t]);
    let vmax = (0..k).map(v).max().unwrap();
    if vmax == 0 { return None; }

    let plateau: Vec<usize> = (0..k).filter(|&t| v(t) == vmax).collect();
    let imb = |t: usize| d[t].abs_diff(s[t]);
    let m = plateau.iter().map(|&t| imb(t)).min().unwrap();
    let q: Vec<usize> = plateau.into_iter().filter(|&t| imb(t) == m).collect();
    let (lo, hi) = (*q.first().unwrap(), *q.last().unwrap());
    let sum = lo + hi;
    let mut i_star = sum / 2;
    if sum % 2 == 1 && c > i_star {
        i_star += 1;
    }

    let qstar = vmax;
    let t_b = (0..k).rev().find(|&t| d[t] >= qstar).unwrap();
    let t_a = (0..k).find(|&t| s[t] >= qstar).unwrap();
    let m_b = qstar - d[t_b + 1];
    let m_a = qstar - if t_a == 0 { 0 } else { s[t_a - 1] };

    Some(Clear {
        tick: i_star as u16,
        matched: qstar,
        bid: Marginal { tick: t_b as u16, alloc: m_b, total: bid_qty[t_b] },
        ask: Marginal { tick: t_a as u16, alloc: m_a, total: ask_qty[t_a] },
    })
}
```
