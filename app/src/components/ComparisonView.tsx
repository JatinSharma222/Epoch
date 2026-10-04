"use client";

import React, { useState } from "react";
import { GitCompare, ShieldAlert, Cpu, ArrowUpRight, Scale, Info, CheckCircle2 } from "lucide-react";
import { formatUsd, formatNumber } from "../lib/formatters";

export const ComparisonView: React.FC = () => {
  const [selectedK, setSelectedK] = useState<"k5" | "k1">("k5");

  const data = {
    k5: {
      title: "Competitive Snipers (k = 5)",
      description: "Bertrand competition between multiple latency snipers in high-volatility windows.",
      clobMakerLossBps: 13.91,
      epochMakerLossBps: 1.25,
      reductionPct: 91.0,
      ci95: [10.2, 15.1],
      clobUninformedCostBps: 6.01,
      epochUninformedCostBps: 5.99,
      priorityMevBps: 3.0,
      epochPriorityMevBps: 0.0,
      summary: "Under k=5 snipers, rival snipers bid aggressively inside the batch window, bidding up the uniform clearing price until profits are competed away. This eliminates 91.0% of maker adverse selection.",
    },
    k1: {
      title: "Single Dominant Sniper (k = 1)",
      description: "Monopoly sniper scenario without rival latency competition.",
      clobMakerLossBps: 6.84,
      epochMakerLossBps: 3.16,
      reductionPct: 53.8,
      ci95: [2.8, 4.6],
      clobUninformedCostBps: 6.01,
      epochUninformedCostBps: 5.99,
      priorityMevBps: 3.0,
      epochPriorityMevBps: 0.0,
      summary: "With a single sniper (k=1), the lack of Bertrand competition leaves more residual surplus with the sniper. Adverse selection reduction drops to 53.8%, demonstrating that auction efficiency scales with keeper/arbitrageur competition.",
    },
  };

  const current = data[selectedK];

  return (
    <div className="flex-1 overflow-y-auto p-4 bg-[#0B0E11] font-mono text-[12px] select-none">
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Simulation Banner */}
        <div className="p-3 rounded-lg bg-[#181D24] border border-[#00F0FF]/30 text-[#00F0FF] flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 shrink-0 text-[#00F0FF]" />
            <div>
              <strong className="font-bold text-white">SIMULATED HEAD-TO-HEAD REPLAY:</strong> Empirical
              model results replaying 1,000 Binance SOL/USDT 1-minute candles ($120.56 mean price, P50 move 1.66 bps).
              All figures labeled <span className="font-bold text-white">SIMULATED</span> under stated assumptions.
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-[#00F0FF]/15 text-[#00F0FF] font-bold uppercase tracking-wider shrink-0 border border-[#00F0FF]/30">
            SIMULATED (T-19)
          </span>
        </div>

        {/* Title Header & Sniper Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b bp-border gap-3">
          <div>
            <h2 className="text-[18px] font-sans font-bold text-white flex items-center gap-2">
              <GitCompare className="w-5 h-5 text-[#E54040]" />
              Market Structure: Continuous CLOB vs. Epoch FBA
            </h2>
            <p className="text-[11px] text-[#848E9C]">
              Side-by-side adverse selection, execution cost, and MEV extraction comparison.
            </p>
          </div>

          {/* Sniper Switcher (k=5 vs k=1) */}
          <div className="flex items-center bg-[#12161C] p-0.5 rounded-lg border bp-border shrink-0">
            <button
              onClick={() => setSelectedK("k5")}
              className={`px-3 py-1 text-[11px] font-sans font-semibold rounded-md transition-all ${
                selectedK === "k5"
                  ? "bg-[#E54040] text-white shadow-sm"
                  : "text-[#848E9C] hover:text-white"
              }`}
            >
              k = 5 Snipers (Bertrand)
            </button>
            <button
              onClick={() => setSelectedK("k1")}
              className={`px-3 py-1 text-[11px] font-sans font-semibold rounded-md transition-all ${
                selectedK === "k1"
                  ? "bg-[#E54040] text-white shadow-sm"
                  : "text-[#848E9C] hover:text-white"
              }`}
            >
              k = 1 Sniper (Monopoly)
            </button>
          </div>
        </div>

        {/* Summary Metric Callouts */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-lg bg-[#0E1217] border bp-border space-y-1">
            <span className="text-[10px] text-[#848E9C] uppercase font-sans tracking-wider">
              Maker Loss Reduction
            </span>
            <div className="text-[20px] font-sans font-bold text-[#0ECB81] flex items-center gap-1.5">
              <span>{current.reductionPct.toFixed(1)}%</span>
              <span className="text-[11px] text-[#848E9C] font-normal font-mono">
                [SIMULATED]
              </span>
            </div>
            <p className="text-[10px] text-[#848E9C]">
              95% Bootstrap CI: [{current.ci95[0]}, {current.ci95[1]}] bps
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-[#0E1217] border bp-border space-y-1">
            <span className="text-[10px] text-[#848E9C] uppercase font-sans tracking-wider">
              Within-Batch Sandwiching
            </span>
            <div className="text-[20px] font-sans font-bold text-[#00F0FF] flex items-center gap-1.5">
              <span>0.0 bps</span>
              <span className="text-[11px] text-[#848E9C] font-normal font-mono">
                (100% Eliminated)
              </span>
            </div>
            <p className="text-[10px] text-[#848E9C]">
              Single uniform price P* eliminates ordering priority
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-[#0E1217] border bp-border space-y-1">
            <span className="text-[10px] text-[#848E9C] uppercase font-sans tracking-wider">
              Uninformed Trader Slippage
            </span>
            <div className="text-[20px] font-sans font-bold text-white flex items-center gap-1.5">
              <span>{current.epochUninformedCostBps} bps</span>
              <span className="text-[11px] text-[#848E9C] font-normal font-mono">
                vs {current.clobUninformedCostBps} bps
              </span>
            </div>
            <p className="text-[10px] text-[#848E9C]">
              Strictly non-worse execution cost for retail flow
            </p>
          </div>
        </div>

        {/* Side-by-Side Comparison Table */}
        <div className="bg-[#0E1217] rounded-lg border bp-border overflow-hidden">
          <div className="p-3 border-b bp-border bg-[#12161C] flex items-center justify-between">
            <div className="font-sans font-bold text-white text-[13px] flex items-center gap-2">
              <Scale className="w-4 h-4 text-[#E54040]" />
              Comparative Execution Matrix ({current.title})
            </div>
            <span className="text-[10px] text-[#848E9C]">
              Model result under stated assumptions
            </span>
          </div>

          <table className="w-full text-left">
            <thead>
              <tr className="text-[#848E9C] text-[10px] uppercase border-b bp-border bg-[#0B0E11] font-sans">
                <th className="py-2.5 px-4">Metric / Dimension</th>
                <th className="py-2.5 px-4 text-[#F6465D]">Continuous CLOB (Binance/Bybit)</th>
                <th className="py-2.5 px-4 text-[#0ECB81]">Epoch FBA (Solana Uniform Price)</th>
                <th className="py-2.5 px-4 text-right">Differential Delta</th>
              </tr>
            </thead>
            <tbody className="divide-y bp-border text-[#F0F3F6]">
              <tr>
                <td className="py-2.5 px-4 font-sans font-medium text-white">Execution Matching</td>
                <td className="py-2.5 px-4 text-[#848E9C]">Continuous serial order matching</td>
                <td className="py-2.5 px-4 text-[#0ECB81] font-semibold">Discrete 2-slot batch auctions</td>
                <td className="py-2.5 px-4 text-right tabular-nums text-white">Batched (800ms)</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-sans font-medium text-white">Clearing Price</td>
                <td className="py-2.5 px-4 text-[#848E9C]">Multiple prices per trade (tick ladder)</td>
                <td className="py-2.5 px-4 text-[#0ECB81] font-semibold">Single uniform market-clearing tick P*</td>
                <td className="py-2.5 px-4 text-right tabular-nums text-[#0ECB81]">1 Price / Batch</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-sans font-medium text-white">Maker Adverse Selection Loss</td>
                <td className="py-2.5 px-4 text-[#F6465D] tabular-nums font-semibold">
                  {current.clobMakerLossBps.toFixed(2)} bps [SIMULATED]
                </td>
                <td className="py-2.5 px-4 text-[#0ECB81] tabular-nums font-semibold">
                  {current.epochMakerLossBps.toFixed(2)} bps [SIMULATED]
                </td>
                <td className="py-2.5 px-4 text-right tabular-nums text-[#0ECB81] font-bold">
                  -{current.reductionPct.toFixed(1)}% (-{(current.clobMakerLossBps - current.epochMakerLossBps).toFixed(2)} bps)
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-sans font-medium text-white">Priority MEV (Sandwich / Frontrun)</td>
                <td className="py-2.5 px-4 text-[#F6465D] tabular-nums">
                  {current.priorityMevBps.toFixed(1)} bps extracted
                </td>
                <td className="py-2.5 px-4 text-[#00F0FF] tabular-nums font-semibold">
                  0.0 bps (Impossible by construction)
                </td>
                <td className="py-2.5 px-4 text-right tabular-nums text-[#00F0FF] font-bold">
                  -100% (-{current.priorityMevBps.toFixed(1)} bps)
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-sans font-medium text-white">Uninformed Slippage</td>
                <td className="py-2.5 px-4 text-[#848E9C] tabular-nums">
                  {current.clobUninformedCostBps.toFixed(2)} bps
                </td>
                <td className="py-2.5 px-4 text-white tabular-nums font-semibold">
                  {current.epochUninformedCostBps.toFixed(2)} bps
                </td>
                <td className="py-2.5 px-4 text-right tabular-nums text-[#848E9C]">
                  -{(current.clobUninformedCostBps - current.epochUninformedCostBps).toFixed(2)} bps
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-sans font-medium text-white">Latency Racing Defense</td>
                <td className="py-2.5 px-4 text-[#848E9C]">Requires sub-millisecond fiber & colocated bots</td>
                <td className="py-2.5 px-4 text-[#0ECB81]">Solved at market structure level via uniform clearing</td>
                <td className="py-2.5 px-4 text-right text-[#0ECB81] font-medium">Algorithmic</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Mechanism Note & Threat R4 Nuance */}
        <div className="p-3.5 rounded-lg bg-[#0E1217] border bp-border space-y-2">
          <div className="font-sans font-bold text-white text-[12px] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#0ECB81]" />
            Hypothesis H1 & H2 Verdict & Stated Limitations
          </div>
          <p className="text-[11px] text-[#B7BDC6] leading-relaxed">
            {current.summary}
          </p>
          <div className="p-2.5 rounded bg-[#12161C] border bp-border text-[11px] text-[#848E9C] space-y-1">
            <div className="font-semibold text-white">Methodological Transparency (Threat R4 Stated Boundary):</div>
            <div>
              1. <strong>Ordering Sandwiches Eliminated:</strong> Because buy and sell orders within a batch execute at the exact same uniform clearing price P*, ordering priority inside the batch cannot be exploited.
            </div>
            <div>
              2. <strong>Last-Look Advantage (Threat R4) Unaddressed:</strong> If an informed sniper observes external price movement immediately before batch close, they retain an informational advantage when submitting late orders into the closing batch. Batch auctions do not eliminate external informational latency.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
