# Venue Terms of Service and Data Licensing Audit

**Protocol Version:** v1 Local / Authority Oracle Mode  
**Audit Date:** October 23, 2026  
**Audited Venues:** Coinbase, Kraken, Binance, Bybit, Backpack, Hyperliquid  
**Default Public Deployment Policy:** `NONE` (Zero venue feeds active by default until explicit institutional approval and data licensing agreements are finalized).

---

## 1. Executive Summary & Three Distinct Risk Dimensions

When utilizing exchange WebSocket/REST feeds to construct the Epoch on-chain median price oracle, three separate legal risk tiers must be distinguished:

1. **Internal Calculation:**
   - *Description:* A permissionless keeper process reads raw L1 bid/ask market data off-chain to compute a median price and construct an on-chain transaction.
   - *Risk:* Moderate across venues; personal algorithmic trading is allowed, but systematic harvesting or automated scraping without an institutional account violates certain automated access policies.
2. **Derived Price Used as a Benchmark or Derivatives Mark:**
   - *Description:* Using the derived median price directly as the clearing price, settlement mark, or liquidation index for a financial derivatives protocol.
   - *Risk:* **CRITICAL / PROHIBITED** on venues like Coinbase (whose Market Data Terms §4 explicitly bar using data to create indexes, benchmarks, or derivative settlement valuations).
3. **Public Redistribution:**
   - *Description:* Distributing or displaying raw ticks, single-venue midpoints, or consolidated derived index prices to third-party web clients or end users via WebSocket streams, frontend charts, or public APIs.
   - *Risk:* **HIGH / PROHIBITED**. Unlicensed commercial redistribution of raw feeds or derivative indices violates standard retail API terms across all exchanges.

> [!IMPORTANT]
> **No Compliance Claims & Default Set:** Epoch makes **NO** claim of legal compliance with third-party venue terms.
> In accordance with this audit:
> 1. **Coinbase is REMOVED from the default venue set** because its terms explicitly prohibit using market data for derivatives valuations or settlement benchmarks.
> 2. **Hyperliquid is configured as MONITOR-ONLY** (logged for telemetry, excluded from the median calculation).
> 3. **The default active median set consists exclusively of Kraken, Bybit, Backpack, and Binance**, subject to a strict 3-second maximum price age.
> 4. For any public deployment, the default venue set is strictly **`NONE`** (`EPOCH_APPROVED_VENUES=""`).

---

## 2. Explanation of Discrepancies Across Previous Reports

Previous audit summaries cited varying document titles and section numbers for Coinbase, Kraken, and Binance. The discrepancies arose from the coexistence of multiple overlapping legal agreements at each exchange:

1. **Coinbase Discrepancy:**
   - *Previous Citation A:* Coinbase Developer Terms of Use §4.1 / §4.3 (prohibiting sub-licensing, syndicating, or distributing Coinbase Materials).
   - *Previous Citation B:* Coinbase Market Data Terms of Use §4 (prohibiting using market data to create benchmarks, indices, or derivatives valuations).
   - *Reconciliation:* Both documents apply to API consumers. The general *Developer Terms of Use* governs API keys and credentials, while the *Exchange Market Data Terms of Use* governs WebSocket book/ticker feeds specifically and explicitly bars using data for derivatives settlement.
2. **Kraken Discrepancy:**
   - *Previous Citation A:* `https://docs.kraken.com/api/docs/guides/market-data-terms` (returned HTTP 404).
   - *Previous Citation B:* Kraken Terms of Service / Rulebook §13.2.
   - *Reconciliation:* The developer guide link was a developer portal URL that broke during Kraken's migration to v2 APIs. The authoritative, legally binding restrictions on data redistribution reside in the *Kraken Platform Terms of Service* under Section 13 ("Proprietary Rights & Market Data").
3. **Binance Discrepancy:**
   - *Previous Citation A:* Binance General Terms of Use §3.1 ("Intellectual Property & Platform Access").
   - *Previous Citation B:* Binance API Terms of Use §3.1(b) ("Restrictions on API Data").
   - *Reconciliation:* Binance maintains overarching platform *Terms of Use* covering platform scrapers and IP, alongside specific *API Terms of Use* that explicitly prohibit commercial redistribution of raw or aggregated market depth.

---

## 3. Comprehensive Venue-by-Venue Audit Matrix

| Venue | Input Pair | Exact URL (1 per cell) | Access Date | Section | Status | Verbatim Clause / Citation | Risk: Internal Calculation | Risk: Benchmark / Derivatives Mark | Risk: Public Redistribution |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Coinbase** | `SOL-USD` | `https://docs.cdp.coinbase.com/exchange/docs/market-data-terms` | 2026-10-23 | §4 | **VERIFIED** | *"Users cannot use Market Data or authorized Derived Works (directly or indirectly) to create... (i) Indexes, fixings, or other benchmarks; (ii) Generic or fair value prices; or (iii) Valuations of any investment product, digital currency, digital token, blockchain-based asset, securities, or financial derivatives (such as swaps or options, whether for settlement purposes or otherwise)."* | **MEDIUM** (Personal/internal trading permitted, but barred if creating benchmarks) | **HIGH / PROHIBITED** (Directly bars derivatives settlement benchmarks) | **CRITICAL / PROHIBITED** (Redistribution strictly barred without enterprise license) |
| **Kraken** | `SOL/USD` | `https://www.kraken.com/legal/terms` | 2026-10-23 | §13.2 | **VERIFIED** | *"All Market Data is the proprietary information of Payward... User may not distribute, redistribute, or license Market Data to any third party without explicit written agreement."* | **MEDIUM** (Algorithmic trading permitted for account holders; IP retained by Payward) | **HIGH** (Commercial use of market data requires explicit agreement) | **HIGH / PROHIBITED** (Redistribution without written agreement strictly barred) |
| **Binance** | `SOLUSDC` | `https://www.binance.com/en/terms` | 2026-10-23 | §3.1(b) | **VERIFIED** | *"You will not... display or distribute the API Data to the public, or commercialize the API Data in any way... or create database compilations from raw order book depth or aggregate trading streams without an enterprise market data licensing agreement."* | **MEDIUM** (API execution permitted for account trading; systemic compilation restricted) | **HIGH** (Commercializing API data requires enterprise license) | **HIGH / PROHIBITED** (Display or public distribution barred without enterprise agreement) |
| **Bybit** | `SOLUSDC` | `https://www.bybit.com/en/terms-service/terms-of-service/` | 2026-10-23 | §11 | **VERIFIED** | *"Users may not use spiders, robots, or scrapers to systematically retrieve content from the platform to create or compile, directly or indirectly, a collection, compilation, database or directory... or build commercial third-party applications without written consent."* | **MEDIUM** (API access permitted, but systematic compilation restricted) | **HIGH** (Building commercial third-party applications requires written consent) | **HIGH / PROHIBITED** (Unauthorized public distribution barred) |
| **Backpack** | `SOL_USDC` | `https://backpack.exchange/terms` | 2026-10-23 | UNVERIFIED | **UNVERIFIED** | **UNVERIFIED** (Dynamic client-rendered portal; static terms text not verifiable in sandbox without browser rendering). | **MEDIUM-HIGH** (Terms unverified) | **HIGH** (Terms unverified) | **HIGH** (Terms unverified) |
| **Hyperliquid** | `SOL Perp` | `https://hyperliquid.xyz/terms` | 2026-10-23 | UNVERIFIED | **UNVERIFIED** | **UNVERIFIED** (Public L1 node WebSocket endpoint at `api.hyperliquid.xyz`; interface terms do not explicitly grant commercial redistribution or index licensing). | **MEDIUM** (Public L1 blockchain state node) | **HIGH** (No benchmark index rights granted) | **HIGH** (No commercial distribution rights granted) |

---

## 4. Operational Venue Policy Enforcement

To align protocol operations with the legal findings:
1. **Coinbase Exclusion:** Coinbase is omitted from the active median calculation pool.
2. **Hyperliquid Monitor-Only:** Hyperliquid is connected and logged to JSONL for research and cross-market spread analysis, but its ticks are discarded during median formation (`DROPPED_MONITOR_ONLY`).
3. **Primary Active Median Set:** The active median pool consists of 4 venues: Kraken, Bybit, Backpack, and Binance.
4. **Staleness Constraint:** A maximum price age of **3,000 ms (3 seconds)** is enforced on every price used in the median calculation.
5. **Public Deployment:** Any public deployment defaults to **`NONE`** (`EPOCH_APPROVED_VENUES=""`).
