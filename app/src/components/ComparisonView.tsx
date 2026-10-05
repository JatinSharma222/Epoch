"use client";

import React, { useState } from "react";
import { GitCompare, ShieldAlert, Cpu, ArrowUpRight, Scale, Info, CheckCircle2 } from "lucide-react";
import { formatUsd, formatNumber } from "../lib/formatters";
import s1Data from "../../../evidence/simulations/sim_s1_adverse_selection.json";
import summaryData from "../../../evidence/simulations/summary.json";

export const ComparisonView: React.FC = () => {
  // Standard notional for dollar calculations
  const standardNotional = 100_000;

  const k5Raw = s1Data.snipers_sweep.k_5;
  const k1Raw = s1Data.snipers_sweep.k_1;

  const dataK5 = {
    title: "Competitive Latency Snipers (k = 5)",
    description: "Bertrand competition between 5 latency snipers in high-volatility windows.",
    clobMakerLossBps: k5Raw.clob_maker_adverse_loss_mean_bps, // 0.035 bps per jump
    clobMakerLossUsd: (k5Raw.clob_maker_adverse_loss_mean_bps / 10_000) * standardNotional, // $0.35 / $100k
    epochMakerLossBps: k5Raw.epoch_maker_adverse_loss_mean_bps, // 0.003 bps per jump
    epochMakerLossUsd: (k5Raw.epoch_maker_adverse_loss_mean_bps / 10_000) * standardNotional, // $0.03 / $100k
    diffBps: parseFloat((k5Raw.clob_maker_adverse_loss_mean_bps - k5Raw.epoch_maker_adverse_loss_mean_bps).toFixed(4)), // 0.032 bps per jump
    diffUsd: ((k5Raw.clob_maker_adverse_loss_mean_bps - k5Raw.epoch_maker_adverse_loss_mean_bps) / 10_000) * standardNotional, // $0.32 / $100k
    reductionPct: k5Raw.maker_loss_reduction_pct, // 91.0%
    ci95Bps: k5Raw.difference_bootstrap_95ci, // [0.028, 0.035] bps
    ci95Usd: [
      (k5Raw.difference_bootstrap_95ci[0] / 10_000) * standardNotional,
      (k5Raw.difference_bootstrap_95ci[1] / 10_000) * standardNotional,
    ],
    clobUninformedCostBps: k5Raw.clob_uninformed_cost_mean_bps, // 6.013 bps
    clobUninformedCostUsd: (k5Raw.clob_uninformed_cost_mean_bps / 10_000) * standardNotional,
    epochUninformedCostBps: k5Raw.epoch_uninformed_cost_mean_bps, // 5.993 bps
    epochUninformedCostUsd: (k5Raw.epoch_uninformed_cost_mean_bps / 10_000) * standardNotional,
    priorityMevBps: 3.0,
    priorityMevUsd: (3.0 / 10_000) * standardNotional,
    epochPriorityMevBps: 0.0,
    epochPriorityMevUsd: 0.0,
  };

  const dataK1 = {
    title: "Single Monopoly Sniper (k = 1)",
    description: "Single dominant latency sniper without rival latency competition.",
    clobMakerLossBps: k1Raw.clob_maker_adverse_loss_mean_bps, // 0.035 bps per jump
    clobMakerLossUsd: (k1Raw.clob_maker_adverse_loss_mean_bps / 10_000) * standardNotional, // $0.35 / $100k
    epochMakerLossBps: k1Raw.epoch_maker_adverse_loss_mean_bps, // 0.016 bps per jump
    epochMakerLossUsd: (k1Raw.epoch_maker_adverse_loss_mean_bps / 10_000) * standardNotional, // $0.16 / $100k
    diffBps: parseFloat((k1Raw.clob_maker_adverse_loss_mean_bps - k1Raw.epoch_maker_adverse_loss_mean_bps).toFixed(4)), // 0.019 bps per jump
    diffUsd: ((k1Raw.clob_maker_adverse_loss_mean_bps - k1Raw.epoch_maker_adverse_loss_mean_bps) / 10_000) * standardNotional, // $0.19 / $100k
    reductionPct: k1Raw.maker_loss_reduction_pct, // 53.8%
    ci95Bps: k1Raw.difference_bootstrap_95ci, // [0.017, 0.021] bps
    ci95Usd: [
      (k1Raw.difference_bootstrap_95ci[0] / 10_000) * standardNotional,
      (k1Raw.difference_bootstrap_95ci[1] / 10_000) * standardNotional,
    ],
    clobUninformedCostBps: k1Raw.clob_uninformed_cost_mean_bps, // 6.012 bps
    clobUninformedCostUsd: (k1Raw.clob_uninformed_cost_mean_bps / 10_000) * standardNotional,
    epochUninformedCostBps: k1Raw.epoch_uninformed_cost_mean_bps, // 5.993 bps
    epochUninformedCostUsd: (k1Raw.epoch_uninformed_cost_mean_bps / 10_000) * standardNotional,
    priorityMevBps: 3.0,
    priorityMevUsd: (3.0 / 10_000) * standardNotional,
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
                  {dataK5.clobMakerLossBps.toFixed(3)} bps (${dataK5.clobMakerLossUsd.toFixed(2)} / $100k per jump)
                </span>
              </div>
              <div>
                <span className="text-[#848E9C] block">Epoch FBA (Batched):</span>
                <span className="text-[#0ECB81] font-bold">
                  {dataK5.epochMakerLossBps.toFixed(3)} bps (${dataK5.epochMakerLossUsd.toFixed(2)} / $100k per jump)
                </span>
              </div>
            </div>
            <div className="pt-2 border-t bp-border text-[11px] flex justify-between items-center">
              <span className="text-[#848E9C]">Net Maker Benefit (Per Jump):</span>
              <span className="text-[#0ECB81] font-bold">
                +{dataK5.diffBps.toFixed(3)} bps (+${dataK5.diffUsd.toFixed(2)} / $100k) [SIMULATED]
              </span>
            </div>
            <div className="text-[10px] text-[#848E9C]">
              95% Bootstrap CI: [{dataK5.ci95Bps[0].toFixed(3)}, {dataK5.ci95Bps[1].toFixed(3)}] bps (${dataK5.ci95Usd[0].toFixed(2)} – ${dataK5.ci95Usd[1].toFixed(2)} per $100k per jump)
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
                  {dataK1.clobMakerLossBps.toFixed(3)} bps (${dataK1.clobMakerLossUsd.toFixed(2)} / $100k per jump)
                </span>
              </div>
              <div>
                <span className="text-[#848E9C] block">Epoch FBA (Batched):</span>
                <span className="text-[#0ECB81] font-bold">
                  {dataK1.epochMakerLossBps.toFixed(3)} bps (${dataK1.epochMakerLossUsd.toFixed(2)} / $100k per jump)
                </span>
              </div>
            </div>
            <div className="pt-2 border-t bp-border text-[11px] flex justify-between items-center">
              <span className="text-[#848E9C]">Net Maker Benefit (Per Jump):</span>
              <span className="text-[#0ECB81] font-bold">
                +{dataK1.diffBps.toFixed(3)} bps (+${dataK1.diffUsd.toFixed(2)} / $100k) [SIMULATED]
              </span>
            </div>
            <div className="text-[10px] text-[#848E9C]">
              95% Bootstrap CI: [{dataK1.ci95Bps[0].toFixed(3)}, {dataK1.ci95Bps[1].toFixed(3)}] bps (${dataK1.ci95Usd[0].toFixed(2)} – ${dataK1.ci95Usd[1].toFixed(2)} per $100k per jump)
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
              Model result under stated assumptions (Basis Points per Price Jump / Trade, $100k Notional)
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
                <td className="py-2.5 px-4 font-sans font-medium text-white">Maker Adverse Loss (per jump)</td>
                <td className="py-2.5 px-4 text-[#F6465D] tabular-nums font-semibold">
                  0.035 bps ($0.35 / $100k)<br />
                  <span className="text-[10px] text-[#848E9C] font-normal">Identical across k=1 and k=5</span>
                </td>
                <td className="py-2.5 px-4 text-[#0ECB81] tabular-nums font-semibold">
                  0.003 bps ($0.03 / $100k)<br />
                  <span className="text-[10px] text-[#0ECB81] font-bold">-91.0% (-0.032 bps / -$0.32)</span>
                </td>
                <td className="py-2.5 px-4 text-[#00F0FF] tabular-nums font-semibold">
                  0.016 bps ($0.16 / $100k)<br />
                  <span className="text-[10px] text-[#00F0FF] font-bold">-53.8% (-0.019 bps / -$0.19)</span>
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-sans font-medium text-white">Session Cumulative Maker Saving</td>
                <td className="py-2.5 px-4 text-[#F6465D] tabular-nums font-semibold">
                  Baseline (0 bps)
                </td>
                <td className="py-2.5 px-4 text-[#0ECB81] tabular-nums font-semibold">
                  +8.45 bps (+84.50 / $100k)<br />
                  <span className="text-[10px] text-[#848E9C] font-normal">~265 jumps active session</span>
                </td>
                <td className="py-2.5 px-4 text-[#00F0FF] tabular-nums font-semibold">
                  +4.82 bps (+48.20 / $100k)<br />
                  <span className="text-[10px] text-[#848E9C] font-normal">~250 jumps active session</span>
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
                <td className="py-2.5 px-4 font-sans font-medium text-white">Uninformed Cost (per trade)</td>
                <td className="py-2.5 px-4 text-[#848E9C] tabular-nums">
                  6.013 bps ($60.13 / $100k)
                </td>
                <td className="py-2.5 px-4 text-[#0ECB81] tabular-nums font-semibold">
                  5.993 bps ($59.93 / $100k)
                </td>
                <td className="py-2.5 px-4 text-[#00F0FF] tabular-nums font-semibold">
                  5.993 bps ($59.93 / $100k)
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
