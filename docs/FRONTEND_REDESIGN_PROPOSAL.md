# EPOCH PROTOCOL — COMPLETE FRONTEND UI/UX REDESIGN PROPOSAL & DESIGN SYSTEM SPECIFICATION

**Document Version:** 1.0.0  
**Status:** PROPOSED & READY FOR USER REVIEW  
**Branch:** `feat/epoch-protocol-hardening` / `main`  
**Target Application:** [`app/`](file:///Users/jatinsharma/Projects/Solana-Hackathon/Colosseum/Epoch/app/) (Next.js 14 App Router, TypeScript, TailwindCSS)  
**Engineering Workstreams:** Lead Architect, Frontend Engineer, QA Engineer, Security Auditor, Infrastructure Engineer  
**Date:** November 19, 2026  

---

## Table of Contents
1. [Executive Summary & Strategic Objective](#1-executive-summary--strategic-objective)
2. [Current Architecture & Codebase Inspection](#2-current-architecture--codebase-inspection)
3. [Design Deficiencies & UX Friction in Current Implementation](#3-design-deficiencies--ux-friction-in-current-implementation)
4. [Target Information Architecture & Terminal Layout](#4-target-information-architecture--terminal-layout)
5. [System Health Experience Architecture](#5-system-health-experience-architecture)
6. [Complete Design System Specification](#6-complete-design-system-specification)
   - 6.1 [Color Palette & Semantic Tokens](#61-color-palette--semantic-tokens)
   - 6.2 [Typography System & Numerical Formatting](#62-typography-system--numerical-formatting)
   - 6.3 [Spacing, Grid, Radii & Depth Layering](#63-spacing-grid-radii--depth-layering)
   - 6.4 [Core Reusable Component Primitives](#64-core-reusable-component-primitives)
7. [Financial & Transaction Safety Guardrails](#7-financial--transaction-safety-guardrails)
8. [Multi-Device Responsive Strategy](#8-multi-device-responsive-strategy)
9. [QA Verification & Automated Regression Strategy](#9-qa-verification--automated-regression-strategy)
10. [Manageable Implementation Milestones & Workstream Matrix](#10-manageable-implementation-milestones--workstream-matrix)

---

## 1. Executive Summary & Strategic Objective

The Epoch perpetuals exchange is architected around Frequent Batch Auctions (FBA) on Solana, offering deterministic clearing, uniform pricing, MEV elimination, and discrete $\pm 50\text{ bps}$ collar matching. While the core protocol mechanism and reference clearing engine are rigorously proven, the user interface currently reflects an early-stage hackathon prototype:
- Visual clutter caused by hardcoded, competing color palettes (`#E54040` brand red, `#00F0FF` cyan, `#EAB308` amber, `#00C087` green).
- Oversized warning banners stacked vertically across the viewport that consume up to 35% of vertical screen height.
- A rigid left navigation sidebar that wastes horizontal real estate necessary for high-density depth and candlestick visualization.
- Demo-era frontend heuristics (such as simulated balance adjustments in `catch` blocks and placeholder liquidation equations).

### Strategic Benchmark
The objective of this complete redesign is to elevate Epoch to the standard of elite derivatives terminals—benchmarked directly against **Hyperliquid** and **dYdX v4**, while establishing a distinctive, authoritative Epoch brand identity:
1. **Charcoal & Deep Navy Surfaces (`#07090E` to `#111622`)**: Sophisticated dark-mode palette that prevents eye fatigue while providing high contrast for tabular financial data.
2. **Restrained Emerald (`#10B981`) & Coral (`#F43F5E`) Accents**: Reserved strictly for directional market movements, order actions, and margin health.
3. **Institutional 3-Column Terminal Layout**: Clean navigation in a slim 44px top header, freeing horizontal space for a 3-column layout: High-performance Chart (flex-1) + Discrete Tick Order Book (300px) + Precision Order Ticket (300px), floating over a resizable docked Ledger (180px–360px).
4. **Unified System Health Center**: Replacing intrusive multi-banner alerts with a single non-intrusive status pill linked to an on-demand slide-over diagnostic drawer.
5. **Absolute Financial & Transaction Integrity**: Preserving 100% of underlying Solana on-chain logic, eliminating mock balance mutations, computing exact on-chain liquidation thresholds, and maintaining zero database dependencies.

---

## 2. Current Architecture & Codebase Inspection

The frontend codebase is located under [`app/`](file:///Users/jatinsharma/Projects/Solana-Hackathon/Colosseum/Epoch/app/). An inspection reveals the following structure:

```
app/
├── package.json                   # Next.js 14.2.15, React 18.3.1, Anchor 0.32.0, Web3.js 1.98.0
├── next.config.mjs                # Node polyfills (fs: false, net: false, tls: false)
├── tailwind.config.ts             # Custom bp-* palette tokens and typography definitions
├── tsconfig.json                  # Strict TypeScript configuration
└── src/
    ├── app/
    │   ├── globals.css            # Base CSS variables (--bg-base, --green, --red) & utility classes
    │   ├── layout.tsx             # Root layout with Inter & JetBrains Mono font loading
    │   └── page.tsx               # Monolithic state container (833 lines) & tab router
    ├── components/
    │   ├── Header.tsx             # Top header bar with market selector, prices, batch stats
    │   ├── Sidebar.tsx            # Left collapsible navigation sidebar (56px/180px)
    │   ├── TradingChart.tsx       # Custom SVG candlestick canvas + SMA + volume bars
    │   ├── OrderBook.tsx          # Discrete tick order book (±10 bps) + Binance L2 reference tab
    │   ├── OrderTicket.tsx        # Order entry form, pegged offset, leverage slider
    │   ├── BottomLedger.tsx       # Fixed 210px docking ledger (balances, positions, orders, history)
    │   ├── BatchLogView.tsx       # Standalone historical batch clearance table
    │   ├── EvidenceView.tsx       # 700-line empirical evidence & CU benchmark view
    │   ├── ComparisonView.tsx     # Continuous CLOB vs FBA adverse selection comparison
    │   ├── BatchAuctionCrossingCurve.tsx # Standalone SVG supply/demand step-curve
    │   ├── MarketSelector.tsx     # Asset selector dropdown (SOL-PERP + upcoming assets)
    │   ├── MarketTickerBanner.tsx # Top scrolling market ticker banner
    │   ├── ReferencePriceStrip.tsx# Secondary ticker strip
    │   ├── WalletMenu.tsx         # Connected wallet menu with balance displays & actions
    │   ├── WalletContextProvider.tsx # Solana wallet adapter provider
    │   ├── DepositWithdrawModal.tsx # Collateral deposit/withdrawal dialog
    │   └── FaucetModal.tsx        # Devnet mock USDC faucet dialog
    └── lib/
        ├── clearingEngine.ts      # Pure TS reference clearing algorithm (discrete tie-breaking)
        ├── clearingEngine.test.ts # Bun unit tests asserting parity with epoch_ref.wasm
        ├── epoch_ref.wasm         # Standalone compiled Rust reference engine (583 kB)
        ├── constants.ts           # Program ID, PDA derivations (market, batch, user, vault)
        ├── epoch.config.json      # Program deployment registry
        ├── epoch_idl.json         # Anchor IDL
        ├── formatters.ts          # Financial formatting helpers (USD, lots, bps, funding)
        ├── errors.ts              # Custom on-chain error parsing
        └── marketData.ts          # Binance L2 & Pyth live data polling
```

### Current Runtime & Build Performance (Measured)
- **First Load JS:** **272 kB** (Route `/`), well below the **350 kB** budget ceiling with **78 kB (22.3%)** headroom.
- **Production Build:** `next build` compiles in **~6.5s** with 100% static page prerendering (`4/4` pages).
- **Clearing Parity Tests:** `bun test app/src/lib/clearingEngine.test.ts` passes with 2/2 tests verified against WASM.
- **Data Architecture:** 100% headless, chain-native execution. Direct communication with Solana RPC; zero dependency on external backend databases (`epoch-postgres`) for core trade execution.

---

## 3. Design Deficiencies & UX Friction in Current Implementation

| Component | Current State & Friction Points | Institutional Remediation (Redesign Target) |
|---|---|---|
| **Layout & Navigation** | Rigid left sidebar (`w-[56px]` or `w-[180px]`) consumes valuable horizontal width. Duplicate top marquee strips (`MarketTickerBanner` and `ReferencePriceStrip`) create visual redundancy. | Eliminate the left sidebar entirely. Relocate all navigation tabs (`Trade`, `Batches`, `Evidence`, `Comparison`, `Docs`) into a sleek, unified top header bar (`44px` height), maximizing chart and book canvas space. |
| **System Alerts** | Three full-width warning banners (`Keeper Offline`, `Devnet RPC Outage`, `Vault Inventory Warning`) stack vertically over the workspace, stealing up to 140px of vertical space. | Replace stacked banners with a single unified `SystemStatusPill` in the header (`● Devnet · Keeper 1.2s · 239ms/slot`). Clicking expands a slide-over `DiagnosticDrawer` with detailed telemetry. Critical outages freeze the interactive controls gracefully. |
| **Trading Chart** | Custom SVG implementation (`viewBox="0 0 940 380"`) stretches non-linearly on ultra-wide or high-DPI displays. Tab buttons switch the entire canvas away from price action. | Implement high-performance, GPU-accelerated canvas charting (TradingView Lightweight Charts v4.2+). Provide side-by-side split view for the FBA Crossing Curve without unmounting price candles. |
| **Order Book** | Fixed 300px column with basic row lists. Lacks visual depth representation and clear pro-rata fill indicators. | Add horizontal cumulative depth bars (depth heatmap) behind bid/ask rows. Highlight the uniform clearing price $P^*$ with an unmistakable cyan indicator. Clearly label pro-rata allocation percentages (`M/T %`) on marginal rows. |
| **Order Ticket** | Cluttered ticket with 14 inputs, competing button colors (cyan, green, red, amber), confusing "Lifetime (1–4 batches)" button group, and hardcoded liquidation price heuristic. | Streamline into an institutional order console: Long/Short selector tabs, clean Market/Limit tabs, single numeric input with auto-pegged bps collar display, smooth slider, and high-contrast execution button. Advanced parameters (lifetime, reduce-only) collapse into clean secondary toggle. |
| **Bottom Ledger** | Fixed 210px container with no vertical resizing. Lacks 1-click market close actions. Tab badges use harsh green borders. | Provide an adjustable drag handle (160px to 450px height). Add 1-click Market Close and Position Details modal. Ensure monospace tabular alignment across all columns. |
| **Analytical Pages** | `EvidenceView`, `ComparisonView`, and `BatchLogView` appear as disconnected, static pages with raw text blocks. | Redesign into premium institutional research and auditing suites with interactive KPI metric cards, compute unit benchmark visualizations, and verifiable on-chain proof explorers. |

---

## 4. Target Information Architecture & Terminal Layout

### 4.1 Master Terminal Layout Wireframe
```
+------------------------------------------------------------------------------------------------------------------------------------+
| [EPOCH] SOL-PERP $119.60 (+2.45%)  Oracle $119.58 | Trade  Batches  Analytics  Compare  Docs | [● Devnet · Keeper 1.2s]  [Wallet $50.00] |
+------------------------------------------------------------------------------------------------------------------------------------+
|                                                          |                                    |                                    |
|  TRADING CHART (flex-1)                                  |  ORDER BOOK (300px)                |  ORDER TICKET (300px)              |
|  - Candlestick & Reference Overlay                       |  - K=101 Discrete Tick Ladder      |  - [ Buy / Long ] [ Sell / Short ] |
|  - 1m  5m  15m  1h  4h  1D                               |  - Dynamic Cumulative Depth Bars   |  - [ Market ] [ Limit ]            |
|  - Sub-pane: Batch Crossing Curve (Step-Line)            |  - Uniform Clearing Price Line P*  |  - Price Input & Pegged Offset     |
|                                                          |  - Marginal Pro-Rata Badges (M/T)  |  - Size Input & Leverage Slider    |
|                                                          |  - User Resting Order Dots         |  - Margin & Liq Price Breakdown    |
|                                                          |                                    |  - High-Contrast Submit CTA        |
+----------------------------------------------------------+------------------------------------+------------------------------------+
| BOTTOM LEDGER (Docked & Resizable: 180px – 360px) [Drag Handle: ===]                                                               |
| [ Positions (1) ]  [ Open Orders (2) ]  [ Trade History ]  [ Account Balances ]  [ Batch Clearance Log ]                           |
| Market     Side     Size Lots   Entry Price   Mark Price   Liq Price    Margin Ratio   Unrealized PnL         Actions              |
| SOL-PERP   LONG     +1,000      $119.20       $119.60      $108.40      14.2%          +$40.00 (+3.35%)       [ Market Close ]     |
+------------------------------------------------------------------------------------------------------------------------------------+
```

### 4.2 Structural Breakpoints & Viewport Adaptation
- **Desktop (≥1440px):** Full 3-column layout (Chart + Order Book + Order Ticket) with docked resizable bottom ledger.
- **Laptop (1024px – 1439px):** Optimized 3-column layout. Order Book scales to 260px, Ticket to 280px; secondary market statistics collapse into a popover.
- **Tablet (768px – 1023px):** 2-column layout. Chart (60%) on the left; tabbed switcher between `[ Order Book ]` and `[ Order Ticket ]` (40%) on the right. Ledger collapses into an expandable drawer.
- **Mobile (<768px):** Dedicated mobile layout. Bottom navigation bar (`Chart`, `Book`, `Trade`, `Positions`). Floating action button opens a slide-up order ticket bottom sheet.

---

## 5. System Health Experience Architecture

### 5.1 Elimination of Warning Banner Stacking
Currently, three separate warning banners stack at the top of the viewport when alerts trigger. This creates severe layout shifts and hides the chart.

### 5.2 Unified `SystemStatusCenter`
The redesign replaces all warning banners with a single, high-density status pill located in the top navigation header:

```
[ ● Devnet · Keeper 1.2s · 239ms/slot ]
```

#### Health States:
1. **Optimal (Emerald `●`):** Keeper heartbeat $<3\text{s}$, RPC latency $<300\text{ms}$, Vault inventory within normal bounds ($<80\%$).
2. **Degraded (Amber `●`):** Keeper latency between $3\text{s}$ and $15\text{s}$, or Vault inventory $>80\%$ of capacity. Trading remains operational with subtle warning indicators.
3. **Critical (Coral `●` with Ping Animation):** Keeper latency $>15\text{s}$ (offline), Pyth oracle stale ($>60\text{s}$), or Solana RPC disconnected.

### 5.3 Interactive Slide-Over Diagnostic Drawer
Clicking the status pill opens a non-intrusive right slide-over drawer providing real-time telemetry:
- **Solana RPC Cluster:** Connected endpoint, current slot number, WebSocket heartbeat status, measured round-trip ping.
- **Keeper Daemon Liveness:** Last batch cleared slot, timestamp of last clearing execution, measured clearance duration ($239\text{ms}$ average).
- **Pyth Oracle Freshness:** Feed address, price confidence interval ($\pm \text{bps}$), timestamp of latest oracle update, stale threshold ($60\text{s}$).
- **Backstop Vault Inventory:** Current base position ($+X / \text{MAX}$ lots), quoting status (bids/asks active), and inventory rebalance indicator.

### 5.4 Graceful Outage Protection
If the RPC cluster fails or is unreachable:
- Interactive controls are disabled to prevent duplicate, blind transactions.
- The interface applies a subtle overlay (`opacity-70 grayscale-[20%]`).
- An authoritative notification appears within the terminal: *"Solana Devnet RPC Unreachable — Live widgets frozen until connection restored."*
- **Strict Prohibition:** Absolutely zero simulated or synthetic ticks will be generated when the live data feed is interrupted.

---

## 6. Complete Design System Specification

### 6.1 Color Palette & Semantic Tokens

```css
:root {
  /* Surface Layers (Deep Navy & Charcoal) */
  --surface-base:        #07090E; /* Deepest canvas background */
  --surface-panel:       #0B0F17; /* Terminal panels, header, book background */
  --surface-card:        #111622; /* Elevated cards, ledger rows, inputs */
  --surface-elevated:    #161D2B; /* Dropdowns, popovers, dialogs */
  --surface-hover:       #1D2638; /* Row hover states, secondary button hover */
  --surface-active:      #243046; /* Active selection background */

  /* Border Layers */
  --border-subtle:       rgba(255, 255, 255, 0.04); /* Internal dividers */
  --border-default:      #1A2232;                   /* Standard panel borders */
  --border-strong:       #2A374E;                   /* Focused borders, active tabs */
  --border-focus:        #00D8F6;                   /* High-contrast focus ring */

  /* Typography Colors */
  --text-primary:        #F8FAFC; /* Slate 50: Primary headlines, active values */
  --text-secondary:      #94A3B8; /* Slate 400: Labels, secondary metrics */
  --text-muted:          #64748B; /* Slate 500: Subtitles, table headers */
  --text-disabled:       #334155; /* Slate 700: Inactive states */

  /* Directional & Financial Semantics */
  --color-emerald:        #10B981; /* Bullish / Long / Buy / Matched */
  --color-emerald-hover:  #059669;
  --color-emerald-bg:     rgba(16, 185, 129, 0.08);
  --color-emerald-border: rgba(16, 185, 129, 0.25);

  --color-coral:          #F43F5E; /* Bearish / Short / Sell / Liquidation */
  --color-coral-hover:    #E11D48;
  --color-coral-bg:       rgba(244, 63, 94, 0.08);
  --color-coral-border:   rgba(244, 63, 94, 0.25);

  /* Operational Indicators */
  --color-cyan:           #00D8F6; /* Interactive highlight, uniform clearing line P* */
  --color-cyan-bg:        rgba(0, 216, 246, 0.10);
  --color-amber:          #F59E0B; /* Warnings, rate limits, oracle lag */
  --color-amber-bg:       rgba(245, 158, 11, 0.10);
}
```

### 6.2 Typography System & Numerical Formatting
- **Interface Font:** `Inter, Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- **Tabular / Financial Font:** `JetBrains Mono, "Geist Mono", monospace` with `font-variant-numeric: tabular-nums`

#### Type Hierarchy
| Scale Token | Font Size / Line Height | Font Weight | Target Usage |
|---|---|---|---|
| `text-2xs` | `10px / 13px` | Medium / SemiBold | Micro tags, tick offsets, column subtitles, status dots |
| `text-xs` | `11px / 15px` | Regular / Medium | Table rows, order book sizes, secondary labels |
| `text-sm` | `12px / 16px` | Medium / SemiBold | Standard terminal text, button labels, navigation links |
| `text-base` | `13px / 18px` | SemiBold | Panel titles, ticket headers, dropdown items |
| `text-lg` | `15px / 20px` | Bold (Mono) | Active ticker mark price, major input values |
| `text-xl` | `18px / 24px` | Bold | Header stats highlight, modal titles |
| `text-2xl` | `24px / 32px` | Bold (Mono) | Top KPI figures, wallet equity total |

### 6.3 Spacing, Grid, Radii & Depth Layering
- **Base Grid:** `4px` grid system (`4px`, `8px`, `12px`, `16px`, `24px`, `32px`).
- **Corner Radii:**
  - `rounded-xs`: `2px` (micro tags, pro-rata allocation badges).
  - `rounded-sm`: `4px` (buttons, inputs, tabs, table rows).
  - `rounded-md`: `6px` (dropdown panels, dialog cards).
  - `rounded-lg`: `8px` (primary modals, diagnostic drawer).
- **Z-Index Hierarchy:**
  - `z-0`: Base workspace & charts.
  - `z-10`: Fixed header & docking ledger.
  - `z-20`: Resizer handles & floating chart overlays.
  - `z-30`: Dropdowns, popovers, and tooltips.
  - `z-40`: Toast alerts & diagnostic drawer.
  - `z-50`: Modals & backdrop overlays.

### 6.4 Core Reusable Component Primitives
The redesign will implement 10 reusable primitives located under `app/src/components/ui/`:

1. **`Button`:**
   - Variants: `primary` (cyan), `buy` (emerald), `sell` (coral), `secondary` (card surface with subtle border), `ghost` (transparent hover), `destructive`.
   - Sizes: `xs` (22px), `sm` (28px), `md` (36px).
   - Features: Loading spinner, disabled state, keyboard navigation.
2. **`Input`:**
   - Currency/number input with tabular mono formatting, step increment buttons, right-hand token ticker label, and inline error validation tooltip.
3. **`Tabs`:**
   - Terminal-style underline slider tabs or segmented pill controls. Supports numerical count badges (e.g. `Positions (1)`).
4. **`Dropdown / Popover`:**
   - Accessible headless popover with keyboard arrow navigation, search input, and click-outside dismissal.
5. **`Tooltip`:**
   - Fast, non-blocking hover tooltip for explaining complex mechanism concepts (e.g. "Pegged Offset ±50 bps collar", "Pro-rata Marginal Ratio").
6. **`Table`:**
   - Institutional data table primitive with sticky header, sorted columns, right-aligned tabular figures, and row-click selection.
7. **`StatusIndicator`:**
   - Color-coded glowing pulse dot (`emerald`, `amber`, `coral`) paired with concise operational health copy.
8. **`Badge`:**
   - Compact tag (`xs`, `sm`) for leverage badges (`10x`), execution flags (`REDUCE_ONLY`), and cluster tags (`Devnet`).
9. **`Modal`:**
   - Accessible dialog with backdrop blur, keyboard escape listener, and smooth scale-in animation.
10. **`Toast`:**
    - Non-intrusive floating snackbar notification system (replaces full-width header alert bars for transaction confirmations and fleeting warnings).

---

## 7. Financial & Transaction Safety Guardrails

In collaboration with the Security Auditor, the redesign establishes **10 Non-Negotiable Guardrails**:

1. **[G-01] Zero Simulated Balance Mutations:** Never mutate `collateral`, `quotePosition`, or `activeOrders` in a `catch` block. If an on-chain transaction fails, display the parsed Solana error and retain on-chain truth.
2. **[G-02] Exact Mathematical Formulas:** Discard all hardcoded heuristics (e.g., `liqPrice = markPrice * 0.8` or `marginRatio = 10.0`). Compute exact liquidation prices and margin ratios using [`app/src/lib/clearingEngine.ts`](file:///Users/jatinsharma/Projects/Solana-Hackathon/Colosseum/Epoch/app/src/lib/clearingEngine.ts).
3. **[G-03] Dynamic User Slot Tracking:** Track user order slots ($0 \le \text{slot\_id} < 8$) dynamically. Eliminate hardcoded `slotId: 0` to prevent unintended upsert overwrites in the contract.
4. **[G-04] Collar & Range Validation:** Validate limit prices against the $\pm 50\text{ bps}$ collar. Reject out-of-bounds orders with clear inline warnings rather than silently clipping prices.
5. **[G-05] Lots Truncation & Notional Floor:** Truncate order lots using `Math.floor(qtySol * 1000)` to prevent fractional lot overcommitment. Enforce the on-chain $\$10.00$ minimum notional floor.
6. **[G-06] Reduce-Only Safety:** Disable and reject reduce-only orders when the user's position is flat or order size exceeds active position lots.
7. **[G-07] Flat Position Withdrawal Guard:** Disable withdraw actions when base position or active orders are non-zero, matching on-chain protocol rules.
8. **[G-08] Degraded Mode Prominence:** Display prominent indicators when the Keeper is offline ($>15\text{s}$), Oracle is stale ($>60\text{s}$), or Backstop Vault inventory is saturated.
9. **[G-09] RPC Outage Freeze:** If RPC communication fails, freeze all live widgets and display the RPC outage banner. Do not simulate slot progression or batch clearing.
10. **[G-10] Reactive Disconnect Purging:** Reactively purge all private account data (balances, positions, orders) immediately upon wallet disconnection or key change.

---

## 8. Multi-Device Responsive Strategy

| Viewport | Target Resolution | Layout Structure | Key Responsive Optimizations |
|---|---|---|---|
| **Desktop 4K / QHD** | `2560 x 1440` | 3-Column Max Density | Extended candle history, full 41-row order book, persistent bottom ledger with all columns visible. |
| **Desktop Full HD** | `1920 x 1080` | 3-Column Standard | Flex-1 Chart, 300px Order Book, 300px Order Ticket, 240px docked Ledger. |
| **Laptop** | `1440 x 900` / `1280 x 720` | 3-Column Compact | Order Book scaled to 260px, Ticket to 280px; secondary market metrics move to popover; 0px horizontal overflow. |
| **Tablet** | `1024 x 768` | 2-Column Hybrid | Chart (60%) on left; right column features tabbed switch between `[ Order Book ]` and `[ Order Ticket ]` (40%). Bottom ledger collapses into expandable drawer. |
| **Mobile** | `375 x 812` (iPhone) | 1-Column Dedicated | Stacked single column with bottom navigation (`Trade`, `Book`, `Chart`, `Portfolio`). Floating action button opens slide-up order ticket bottom sheet. |

---

## 9. QA Verification & Automated Regression Strategy

The QA Engineer will enforce a 3-tier gating protocol across every milestone:

### 9.1 Test Suites Executed per Milestone
1. **TypeScript Strict Linter:** `tsc -p app/tsconfig.json --noEmit` (0 errors).
2. **ESLint & Next.js Linter:** `cd app && bun run lint` (0 errors).
3. **Production Build Gate:** `next build` (0 build errors, `<350 kB` First Load JS budget verified).
4. **WASM Parity Unit Tests:** `bun test app/src/lib/clearingEngine.test.ts` (2/2 passing).
5. **UX Conformance Suite:** `bun run scripts/test_ux_suite.ts` (UX-1 through UX-21 conformance).
6. **Playwright Multi-Viewport Test:** `bun run scripts/verify_ux3_playwright.ts` (0px horizontal overflow, zero console errors across 5 viewports).

### 9.2 Automated Multi-Resolution Visual Capture
Using [`scripts/capture_screenshots.ts`](file:///Users/jatinsharma/Projects/Solana-Hackathon/Colosseum/Epoch/scripts/capture_screenshots.ts), automated screenshots will be captured and archived in `evidence/screenshots/redesign/` at every milestone:
- `1920x1080` (Desktop Full HD)
- `1440x900` (Laptop Standard)
- `1024x768` (Tablet)
- `375x812` (Mobile iPhone)

---

## 10. Manageable Implementation Milestones & Workstream Matrix

Implementation will proceed through 5 structured milestones. Each milestone requires passing all build, test, and visual verification checks before proceeding to the next:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    Milestone Execution Roadmap                             │
├─────────────────┬──────────────────────────────────────────────────────────┤
│ Milestone 1     │ Design System Tokens & 10 Core UI Primitives             │
│ Milestone 2     │ Main Trading Terminal (Header, Chart, Book, Ticket)      │
│ Milestone 3     │ Portfolio & Account Experience (Bottom Ledger, Fills)     │
│ Milestone 4     │ Analytical & Auxiliary Views (Evidence, Compare, Modals) │
│ Milestone 5     │ Responsive Breakpoints & Accessibility Polish            │
└─────────────────┴──────────────────────────────────────────────────────────┘
```

### Detailed Milestone Breakdown

```
+---------------+------------------------------------------------------+---------------------+-------------------------------+
| Milestone     | Scope & Key Deliverables                             | Lead Workstream     | Verification & Exit Criteria  |
+---------------+------------------------------------------------------+---------------------+-------------------------------+
| Milestone 1   | - Update globals.css with new CSS variables          | Frontend Engineer   | - Next.js build succeeds      |
| Design System | - Update tailwind.config.ts color tokens & fonts     | Infrastructure Eng. | - First Load JS < 280 kB      |
|               | - Build 10 core primitives in components/ui/         | QA Engineer         | - Unit tests for primitives   |
|               | - Button, Input, Tabs, Dropdown, Tooltip, Table,     |                     | - axe-core contrast check     |
|               |   StatusIndicator, Badge, Modal, Toast               |                     |                               |
+---------------+------------------------------------------------------+---------------------+-------------------------------+
| Milestone 2   | - Slim 44px Header with market selector & health pill| Frontend Engineer   | - Next.js build succeeds      |
| Trading       | - Unified SystemStatusCenter & DiagnosticDrawer      | Security Auditor    | - Zero mock balance mutations |
| Terminal      | - Upgraded TradingChart (Lightweight Charts canvas)  | QA Engineer         | - Order collar check active   |
|               | - OrderBook with cumulative depth bars & P* highlight|                     | - WASM parity tests pass      |
|               | - Streamlined OrderTicket with pegged collar slider  |                     | - Screenshots at 1920x1080    |
+---------------+------------------------------------------------------+---------------------+-------------------------------+
| Milestone 3   | - Resizable BottomLedger (180px–360px drag handle)   | Frontend Engineer   | - Exact PnL reconciliation    |
| Portfolio &   | - Positions tab with 1-click market close action     | Security Auditor    | - Real liq price calculation  |
| Ledger        | - Open Orders tab with batch countdown chips         | QA Engineer         | - Reactive disconnect purge   |
|               | - Trade History & Balances double-entry ledger       |                     | - 0 ghost positions           |
+---------------+------------------------------------------------------+---------------------+-------------------------------+
| Milestone 4   | - Redesigned BatchLogView with ring-buffer filters   | Frontend Engineer   | - Next.js build succeeds      |
| Remaining     | - Modernized EvidenceView (dynamic CU metrics)       | Infrastructure Eng. | - Dynamic evidence verified   |
| Pages         | - Interactive ComparisonView (MEV slippage tool)     | QA Engineer         | - Modal accessibility verified|
|               | - DepositWithdrawModal & FaucetModal styling         |                     | - First Load JS < 330 kB      |
+---------------+------------------------------------------------------+---------------------+-------------------------------+
| Milestone 5   | - Tablet 2-column layout & drawer adaptation         | Frontend Engineer   | - Playwright across 4 viewports|
| Responsive &  | - Dedicated Mobile layout with bottom navigation     | QA Engineer         | - 0px horizontal overflow     |
| Polish        | - Full keyboard tab-through audit & ARIA landmarks   | Lead Architect      | - 0 console errors/warnings   |
|               | - Final screenshots & regression report generation   |                     | - First Load JS < 350 kB      |
+---------------+------------------------------------------------------+---------------------+-------------------------------+
```

---
*Submitted for user review and milestone authorization.*
