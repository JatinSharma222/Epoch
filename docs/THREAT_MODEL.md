# 03 — Threat Model and Risk Register

Status: PROPOSED (v0.1). Test IDs (`X-xx`, `S-x`, `C-1`, `L-1`, `E-1`, `P-x`) refer to `05-TEST_AND_EVIDENCE_PLAN.md`.

**Purpose:** list what can go wrong, what the design actually defends, and what we openly admit it does not. A judge who finds a hole we already documented is a good outcome. A judge who finds one we did not is a bad one.

## 1. What is being protected

| Asset | Threat |
|---|---|
| Users' collateral | Theft, incorrect accounting, bad debt |
| Fair execution | Being traded against at a worse price than a competing participant |
| Market maker quotes | Being picked off at stale prices |
| Liveness | Batches that never clear, or never settle |
| Credibility of our claims | Saying something the evidence does not support |

## 2. Trust assumptions

1. The Solana runtime executes the program correctly. Validators/leaders can **delay, reorder, or censor** transactions within their slot. We do not claim otherwise.
2. Pyth publishes a price that lags the true market by some amount and has a confidence interval. We treat the oracle as the reference price and lag as an attack surface.
3. The keeper is **untrusted**: it can be late or malicious but cannot cause an incorrect clearing result.
4. On devnet there is an **admin key** that can change parameters and fund the vault. This is a demo shortcut and not a decentralization claim.

## 3. Risk register (ranked)

Severity is the risk to the *project's claims and demo*, not a formal security rating.

| ID | Risk | Severity | Likelihood | Primary mitigation | Residual (what we still admit) | Test |
|---|---|---|---|---|---|---|
| R1 | **Oracle lag**: a fast trader knows the real price moved before Pyth does and trades against quotes anchored to the stale oracle | High | High | Confidence gate, maker offsets sized to expected lag, clear against the freshest post-close update, band cap, vault guards | **Cannot be removed.** It is the core economic risk of any oracle-anchored venue | S-2, S-3, X-01 |
| R2 | **Cranker's oracle-selection option**: whoever clears picks among Pyth updates posted inside the clear window | Medium | Medium | `posted_slot ≥ close_slot`, short `max_clear_delay_slots`, permissionless racing, VOID if window missed | Option value equals price variation inside the window; measured in S-4 | S-4, X-02 |
| R3 | **Landing latency** makes orders miss their target batch | Medium | High | Target-ahead policy (`L = 3`), oracle-relative content stays valid, rejection is harmless | Devnet showed 5 to 17 slots `[SOURCED: agent-run]`; mainnet unmeasured by us | L-1, E-1 |
| R4 | **Last-look / visible-order advantage**: orders are public, so a late participant can react to the visible book and to fresh information | Medium-High | Medium | Uniform price removes *ordering* advantage inside the batch | It does **not** remove informational advantage. Commit-reveal is out of scope | S-3, X-03 |
| R5 | **Capacity griefing**: filling the 128-order buffer to crowd out others | Medium | Medium | Per-user order cap (8), minimum notional, non-refundable placement fee, vault reserved capacity | A well-funded attacker with many accounts can still fill a batch; cost is `128 × (fee + min margin lock)` | X-05 |
| R6 | **Vault losses / cold start**: backstop vault is picked off, or no other liquidity exists | Medium (demo) | High | Wider vault offsets, inventory limits, confidence guard, report vault PnL honestly | The vault is demo liquidity, not proof of viable market making | S-2, E-1 |
| R7 | **Liquidation failure / bad debt** | Medium | Medium | IMR/MMR gap, penalty to insurance fund, oracle-price fallback | No ADL or socialization in v0; shortfalls are displayed | P-11, X-07 |
| R8 | **Rounding and dust** breaking conservation | Medium | Medium | Integer-exact notional (price tick), deterministic dust rule, `u128` math | Property tests must pass on millions of random cases | P-1, P-4, P-7, D-1 |
| R9 | **Compute or account-limit regression** as code grows | Medium | Medium | CU budget test in CI, gate G1, measured limits | If G1 fails, reduce `MAX_ORDERS` or `K`, or split clearing | C-1 |
| R10 | **Keeper liveness** (batch never cleared or settled; ring slot stuck) | Medium | Medium | Permissionless calls, multiple keepers, VOID path, ring of 8 | Ring slots can stay busy until someone settles | E-1, X-08 |
| R11 | **Oracle outage or stale feed** | Medium | Medium | VOID batches, freshness gate | While void, no trading; we say so | X-04 |
| R12 | **Multi-transaction Pyth posting**: pull-oracle updates may need several transactions, adding latency and failure modes to clearing | Medium | Medium | Keeper posts early and retries; measure landing of the full clear sequence | Adds seconds to clear latency; may affect `max_clear_delay_slots` | E-1, L-1 |
| R13 | **Funding manipulation**: wash trading to push the clearing offset (and therefore funding) | Medium | Low-Medium | Funding cap, fees on all fills, oracle mark for margin | A manipulator can shift funding within the cap at a fee cost | X-06 |
| R14 | **Admin key** (devnet) | Low (devnet) | n/a | Documented; no trustlessness claims | Would be High on mainnet | Review |
| R15 | **Toolchain or dependency drift** breaking builds | Medium | High | Pin versions in T-00, commit lockfiles | Known issue: newer crates require edition 2024 and break the SBF toolchain `[SOURCED: agent-run]` | G0 |
| R16 | **Claims outrunning evidence** | High | High | Claim policy in `06`, labeled evidence page, review checklist | Human discipline; no technical control | Review |
| R17 | **Faucet abuse** (mock USDC) | Low | Medium | Per-call cap and per-user daily cap | Demo only | X-09 |
| R18 | **Anchor/account-validation bugs** (missing signer, wrong owner, duplicate accounts, PDA misuse) | High | Medium | Review checklist in `04`, adversarial tests | Needs human review; agents commonly miss these | X-10, X-11 |
| R19 | **Indexer or database diverges from the chain** (missed events, ring-reuse race, RPC gaps) | Low-Medium | Medium | Database is non-authoritative; idempotent backfill; verifier against `finalized`; snapshot fallback; UI labels data source | History or evidence may lag or be wrong. The chain is the truth | E-2, X-12, X-13, X-14 |
| R20 | **Container and host hygiene** (port clashes, leaked keeper key, accidental global prune) | Low | Medium | `epoch` prefix everywhere, `127.0.0.1` binds, devnet-only keeper key mounted read-only, `.env` not committed | Human error | T-25 review |

## 4. Attack catalogue

| # | Attack | Attacker's cost | Does the design stop it? | Notes |
|---|---|---|---|---|
| A1 | **Sandwich** a victim's order | n/a | **Yes for ordering-based sandwiches.** Everyone in the batch trades at one price, so there is no "before" and "after" | A large order still moves the clearing price; that is price impact, not a sandwich |
| A2 | **Latency arbitrage against stale oracle quotes** | Priority fee | **Partly.** The batch removes the race *inside* the batch but not the informational edge | This is R1; the demo must show both competitive and single-sniper cases |
| A3 | **Single dominant sniper** (for example a bundle-capable searcher) captures the whole edge | Tip | **No.** Batching helps mainly when several snipers compete inside the batch | Our own simulation model shows the advantage nearly vanishes with one sniper `[SIMULATED, assumption-dependent]` |
| A4 | **Leader censorship** of a maker's cancel or order | Being a leader | **Partly.** Good-for-one-batch expiry limits the damage | Leaders still see and can drop transactions |
| A5 | **Spoof large size then cancel** | Margin lock, fees | **Yes.** Only final aggregates at clear matter. A spoof that is still there at clear will be filled at the attacker's own cost | Spoof-and-leave is just a real order |
| A6 | **Self-match / wash** to move clearing offset | Fees | **Partly** | Bounded by band and funding cap (R13) |
| A7 | **Fill the order buffer** to block others | Fees plus min margin | **Partly** | R5. Reserve capacity for known participants is a possible mitigation |
| A8 | **Choose which oracle update to clear with** | Being a keeper | **Partly** | R2, quantified in S-4 |
| A9 | **Submit orders that pass margin at placement, then become undercollateralized before clear** | Oracle move | **Mostly.** IMR/MMR gap and 3.2 s maximum horizon | Residual goes to bad debt |
| A10 | **Reinitialize or spoof accounts** (Anchor pitfalls) | Low | Depends on code review | See `04` security checklist |
| A11 | **Mint unlimited mock USDC** | Low | Per-call and per-user caps | Devnet only |
| A12 | **Cause overflow** with extreme sizes or prices | Low | Checked arithmetic, `u128` intermediates, bounds on inputs | P-10 |

## 5. What this design does and does not give you

**Gives you**

- No advantage from arriving earlier *inside* a batch. All fills execute at one price.
- No ordering-based sandwich attacks.
- Deterministic, independently reproducible fills, checked against a reference engine.
- No trusted solver: clearing is computed by the program.
- Self-expiring orders, so slow cancels matter less.

**Does not give you**

- Protection from oracle lag (R1). The exposure moves from "network speed" to "oracle freshness."
- Protection from a single well-positioned sniper (A3).
- Privacy. Orders are public until they clear.
- Censorship resistance beyond what Solana's leaders provide.
- Any guarantee of liquidity.

## 6. Statements we must not make

| Do not say | Say instead |
|---|---|
| "MEV-free", "eliminates front-running" | "Removes intra-batch ordering advantage; oracle lag and leader censorship remain" |
| "Protects market makers from latency arbitrage" | "Reduces the ordering race inside a batch; makers still bear oracle-lag risk, which we simulate and report" |
| "Sniping reduced by X%" | Only quote results from our own simulation with assumptions and confidence intervals attached |
| "First FBA perp on Solana" | Only after a fresh prior-art check; otherwise "batch-auction perp implemented as a Solana program" |
| "Production-ready market making" | "Demo liquidity from a backstop vault" |

## 7. Security review checklist (used in `04` before every merge)

- [ ] Every instruction that mutates a user account requires the owner as `Signer` or an explicit permissionless rule.
- [ ] All PDAs derived and verified with seeds and bump; no client-supplied PDAs trusted.
- [ ] `remaining_accounts` entries are checked for owner (our program), discriminator, expected PDA and **distinctness** (no duplicate mutable accounts).
- [ ] No account can be re-initialized; `init` used correctly; close authority explicit.
- [ ] All arithmetic is checked; unsigned/signed conversions are explicit; no `as` casts on untrusted values.
- [ ] Oracle account owner and feed id are verified; freshness, confidence and `posted_slot` are enforced.
- [ ] State transitions follow the batch state machine; illegal transitions are unreachable.
- [ ] Events never carry data that the on-chain state cannot reproduce.
- [ ] Admin functions are clearly separated and documented as devnet-only.
