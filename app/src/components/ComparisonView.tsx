"use client";

import React, { useState } from "react";
import { GitCompare, ShieldAlert, Cpu, ArrowUpRight, Scale, Info, CheckCircle2 } from "lucide-react";
import { formatUsd, formatNumber } from "../lib/formatters";

export const ComparisonView: React.FC = () => {
  // Standard notional for dollar calculations
  const standardNotional = 100_000;

  const dataK5 = {
    title: "Competitive Latency Snipers (k = 5)",
    description: "Bertrand competition between 5 latency snipers in high-volatility windows.",
    clobMakerLossBps: 13.91,
    clobMakerLossUsd: (13.91 / 10_000) * standardNotional, // $139.10
    epochMakerLossBps: 1.25,
    epochMakerLossUsd: (1.25 / 10_000) * standardNotional, // $12.50
    diffBps: 12.66,
    diffUsd: (12.66 / 10_000) * standardNotional, // $126.60
    reductionPct: 91.0,
    ci95Bps: [10.2, 15.1],
    ci95Usd: [(10.2 / 10_000) * standardNotional, (15.1 / 10_000) * standardNotional],
    clobUninformedCostBps: 6.01,
    clobUninformedCostUsd: (6.01 / 10_000) * standardNotional, // $60.10
    epochUninformedCostBps: 5.99,
    epochUninformedCostUsd: (5.99 / 10_000) * standardNotional, // $59.90
    priorityMevBps: 3.0,
    priorityMevUsd: (3.0 / 10_000) * standardNotional, // $30.00
    epochPriorityMevBps: 0.0,
    epochPriorityMevUsd: 0.0,
  };

  const dataK1 = {
    title: "Single Monopoly Sniper (k = 1)",
    description: "Single dominant latency sniper without rival latency competition.",
    clobMakerLossBps: 6.84,
    clobMakerLossUsd: (6.84 / 10_000) * standardNotional, // $68.40
    epochMakerLossBps: 3.16,
    epochMakerLossUsd: (3.16 / 10_000) * standardNotional, // $31.60
    diffBps: 3.68,
    diffUsd: (3.68 / 10_000) * standardNotional, // $36.80
    reductionPct: 53.8,
    ci95Bps: [2.8, 4.6],
    ci95Usd: [(2.8 / 10_000) * standardNotional, (4.6 / 10_000) * standardNotional],
    clobUninformedCostBps: 6.01,
    clobUninformedCostUsd: (6.01 / 10_000) * standardNotional, // $60.10
    epochUninformedCostBps: 5.99,
    epochUninformedCostUsd: (5.99 / 10_000) * standardNotional, // $59.90
    priorityMevBps: 3.0,
    priorityMevUsd: (3.0 / 10_000) * standardNotional, // $30.00
    epochPriorityMevBps: 0.0,
    epochPriorityMevUsd: 0.0,
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 bg-[#0B0E11] font-mono text-[12px] select-none">
      <div className="max-w-6xl mx-auto space-y-4">
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

        {/* Title Header */}
        <div className="pb-3 border-b bp-border">
          <h2 className="text-[18px] font-sans font-bold text-white flex items-center gap-2">
            <GitCompare className="w-5 h-5 text-[#E54040]" />
            Market Structure: Continuous Order Book (Model) vs. Epoch FBA
          </h2>
          <p className="text-[11px] text-[#848E9C]">
            Theoretical side-by-side adverse selection, execution cost, and MEV extraction comparison across both monopoly (k=1) and competitive (k=5) regimes.
          </p>
        </div>

        {/* Equal Prominence: Side-by-Side k=1 vs k=5 Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card 1: k=5 Competitive */}
          <div className="p-4 rounded-lg bg-[#0E1217] border bp-border space-y-3">
            <div className="flex items-center justify-between border-b bp-border pb-2">
              <div>
                <span className="text-[10px] text-[#848E9C] uppercase font-sans tracking-wider block">
                  Regime 1: Highly Competitive
                </span>
                <span className="text-[14px] font-sans font-bold text-white">
                  k = 5 Snipers (Bertrand Competition)
                </span>
              </div>
              <span className="px-2 py-0.5 rounded bg-[#0ECB81]/15 text-[#0ECB81] text-[10px] font-bold">
                -91.0% Adverse Loss
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-[#848E9C] block">Continuous Order Book (Model):</span>
                <span className="text-[#F6465D] font-bold">
                  {dataK5.clobMakerLossBps.toFixed(2)} bps (${dataK5.clobMakerLossUsd.toFixed(2)} / $100k)
                </span>
              </div>
              <div>
                <span className="text-[#848E9C] block">Epoch FBA (Batched):</span>
                <span className="text-[#0ECB81] font-bold">
                  {dataK5.epochMakerLossBps.toFixed(2)} bps (${dataK5.epochMakerLossUsd.toFixed(2)} / $100k)
                </span>
              </div>
            </div>
            <div className="pt-2 border-t bp-border text-[11px] flex justify-between items-center">
              <span className="text-[#848E9C]">Net Maker Benefit:</span>
              <span className="text-[#0ECB81] font-bold">
                +{dataK5.diffBps.toFixed(2)} bps (+${dataK5.diffUsd.toFixed(2)} / $100k) [SIMULATED]
              </span>
            </div>
            <div className="text-[10px] text-[#848E9C]">
              95% Bootstrap CI: [{dataK5.ci95Bps[0].toFixed(1)}, {dataK5.ci95Bps[1].toFixed(1)}] bps (${dataK5.ci95Usd[0].toFixed(2)} – ${dataK5.ci95Usd[1].toFixed(2)} per $100k)
            </div>
          </div>

          {/* Card 2: k=1 Monopoly */}
          <div className="p-4 rounded-lg bg-[#0E1217] border bp-border space-y-3">
            <div className="flex items-center justify-between border-b bp-border pb-2">
              <div>
                <span className="text-[10px] text-[#848E9C] uppercase font-sans tracking-wider block">
                  Regime 2: Low Competition
                </span>
                <span className="text-[14px] font-sans font-bold text-white">
                  k = 1 Sniper (Monopoly Arbitrageur)
                </span>
              </div>
              <span className="px-2 py-0.5 rounded bg-[#0ECB81]/15 text-[#0ECB81] text-[10px] font-bold">
                -53.8% Adverse Loss
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-[#848E9C] block">Continuous Order Book (Model):</span>
                <span className="text-[#F6465D] font-bold">
                  {dataK1.clobMakerLossBps.toFixed(2)} bps (${dataK1.clobMakerLossUsd.toFixed(2)} / $100k)
                </span>
              </div>
              <div>
                <span className="text-[#848E9C] block">Epoch FBA (Batched):</span>
                <span className="text-[#0ECB81] font-bold">
                  {dataK1.epochMakerLossBps.toFixed(2)} bps (${dataK1.epochMakerLossUsd.toFixed(2)} / $100k)
                </span>
              </div>
            </div>
            <div className="pt-2 border-t bp-border text-[11px] flex justify-between items-center">
              <span className="text-[#848E9C]">Net Maker Benefit:</span>
              <span className="text-[#0ECB81] font-bold">
                +{dataK1.diffBps.toFixed(2)} bps (+${dataK1.diffUsd.toFixed(2)} / $100k) [SIMULATED]
              </span>
            </div>
            <div className="text-[10px] text-[#848E9C]">
              95% Bootstrap CI: [{dataK1.ci95Bps[0].toFixed(1)}, {dataK1.ci95Bps[1].toFixed(1)}] bps (${dataK1.ci95Usd[0].toFixed(2)} – ${dataK1.ci95Usd[1].toFixed(2)} per $100k)
            </div>
          </div>
        </div>

        {/* Side-by-Side Dual Comparison Table */}
        <div className="bg-[#0E1217] rounded-lg border bp-border overflow-hidden">
          <div className="p-3 border-b bp-border bg-[#12161C] flex items-center justify-between">
            <div className="font-sans font-bold text-white text-[13px] flex items-center gap-2">
              <Scale className="w-4 h-4 text-[#E54040]" />
              Comparative Execution Matrix: k = 5 vs k = 1 Regimes
            </div>
            <span className="text-[10px] text-[#848E9C]">
              Model result under stated assumptions (Basis Points and USD per $100,000 Notional)
            </span>
          </div>

          <table className="w-full text-left">
            <thead>
              <tr className="text-[#848E9C] text-[10px] uppercase border-b bp-border bg-[#0B0E11] font-sans">
                <th className="py-2.5 px-4">Metric / Dimension</th>
                <th className="py-2.5 px-4 text-[#F6465D]">Continuous Order Book (Model)</th>
                <th className="py-2.5 px-4 text-[#0ECB81]">Epoch FBA (k = 5 Snipers)</th>
                <th className="py-2.5 px-4 text-[#00F0FF]">Epoch FBA (k = 1 Sniper)</th>
              </tr>
            </thead>
            <tbody className="divide-y bp-border text-[#F0F3F6]">
              <tr>
                <td className="py-2.5 px-4 font-sans font-medium text-white">Execution Matching</td>
                <td className="py-2.5 px-4 text-[#848E9C]">Continuous serial matching</td>
                <td className="py-2.5 px-4 text-[#0ECB81] font-semibold">Discrete 2-slot batch (800ms)</td>
                <td className="py-2.5 px-4 text-[#00F0FF] font-semibold">Discrete 2-slot batch (800ms)</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-sans font-medium text-white">Clearing Price</td>
                <td className="py-2.5 px-4 text-[#848E9C]">Continuous price ladder</td>
                <td className="py-2.5 px-4 text-[#0ECB81] font-semibold">Single uniform price P*</td>
                <td className="py-2.5 px-4 text-[#00F0FF] font-semibold">Single uniform price P*</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-sans font-medium text-white">Maker Adverse Selection Loss</td>
                <td className="py-2.5 px-4 text-[#F6465D] tabular-nums font-semibold">
                  13.91 bps ($139.10) [k=5]<br />
                  6.84 bps ($68.40) [k=1]
                </td>
                <td className="py-2.5 px-4 text-[#0ECB81] tabular-nums font-semibold">
                  1.25 bps ($12.50)<br />
                  <span className="text-[10px] text-[#0ECB81] font-bold">-91.0% (-12.66 bps / -$126.60)</span>
                </td>
                <td className="py-2.5 px-4 text-[#00F0FF] tabular-nums font-semibold">
                  3.16 bps ($31.60)<br />
                  <span className="text-[10px] text-[#00F0FF] font-bold">-53.8% (-3.68 bps / -$36.80)</span>
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-sans font-medium text-white">Priority MEV (Intra-Batch Sandwich)</td>
                <td className="py-2.5 px-4 text-[#F6465D] tabular-nums font-semibold">
                  3.00 bps ($30.00 / $100k)
                </td>
                <td className="py-2.5 px-4 text-[#0ECB81] tabular-nums font-semibold">
                  0.00 bps ($0.00) [100% Eliminated]
                </td>
                <td className="py-2.5 px-4 text-[#00F0FF] tabular-nums font-semibold">
                  0.00 bps ($0.00) [100% Eliminated]
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-sans font-medium text-white">Uninformed Slippage</td>
                <td className="py-2.5 px-4 text-[#848E9C] tabular-nums">
                  6.01 bps ($60.10 / $100k)
                </td>
                <td className="py-2.5 px-4 text-[#0ECB81] tabular-nums font-semibold">
                  5.99 bps ($59.90 / $100k)
                </td>
                <td className="py-2.5 px-4 text-[#00F0FF] tabular-nums font-semibold">
                  5.99 bps ($59.90 / $100k)
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-sans font-medium text-white">Latency Defense Mechanism</td>
                <td className="py-2.5 px-4 text-[#848E9C]">Hardware fiber & priority gas fees</td>
                <td className="py-2.5 px-4 text-[#0ECB81]">Uniform price clearing & pro-rata</td>
                <td className="py-2.5 px-4 text-[#00F0FF]">Uniform price clearing & pro-rata</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Detailed Assumptions & Methodological Transparency Box */}
        <div className="p-4 rounded-lg bg-[#0E1217] border bp-border space-y-3">
          <div className="font-sans font-bold text-white text-[13px] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#0ECB81]" />
            Simulation Assumptions & Methodological Disclosures
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] text-[#B7BDC6]">
            <div className="p-3 rounded bg-[#12161C] border bp-border space-y-1.5">
              <strong className="text-white block font-sans">Model Parameters & Dataset:</strong>
              <div>• <strong>Batch Duration:</strong> 2 Solana slots (~800 ms cadence).</div>
              <div>• <strong>Protocol Fees:</strong> 5.0 bps maker, 5.0 bps taker (symmetrical fee).</div>
              <div>• <strong>Standard Notional:</strong> $100,000 USD (1 bps = $10.00).</div>
              <div>• <strong>Dataset & Scaling:</strong> S-1 used 1,000 Binance SOL/USDT 1-minute historical candles (mean price $120.56, P50 move 1.66 bps). Sub-second volatility is modeled via standard Brownian motion square-root-of-time scaling (σ √Δt). This provides a continuous mathematical proxy for high-frequency tick behavior.</div>
            </div>

            <div className="p-3 rounded bg-[#12161C] border bp-border space-y-1.5">
              <strong className="text-white block font-sans">Mechanism Boundary Disclosures:</strong>
              <div>• <strong>Ordering Sandwiches Eliminated:</strong> Because buy and sell orders within a batch execute at the exact same uniform clearing price P*, intra-batch ordering advantage and sandwich attacks are impossible by construction.</div>
              <div>• <strong>Threat R4 (Last-Look Advantage) Unaddressed:</strong> An informed sniper who observes external off-chain price jumps at T_close - ε can submit late limit orders into the closing batch. While batching reduces adverse selection when multiple snipers compete (k=5), it does not eliminate the informational advantage of the last observer.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
