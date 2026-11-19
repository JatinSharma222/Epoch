"use client";

import React from "react";
import { GitCompare, Scale, Info, CheckCircle2 } from "lucide-react";
import { formatUsd, formatNumber } from "../lib/formatters";
import s1Data from "../../../evidence/simulations/sim_s1_adverse_selection.json";
import summaryData from "../../../evidence/simulations/summary.json";
import { Badge } from "./ui/Badge";

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
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-surface-canvas font-mono text-xs select-none">
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Simulation Banner */}
        <div className="p-3 rounded-lg bg-surface-card border border-trade-cyan/30 text-trade-cyan flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 shrink-0 text-trade-cyan" />
            <div>
              <strong className="font-bold text-content-primary">SIMULATED HEAD-TO-HEAD REPLAY:</strong> Empirical
              model results replaying 1,000 Binance SOL/USDT 1-minute candles ($120.56 mean price, P50 move 1.66 bps).
              All figures labeled <span className="font-bold text-content-primary">SIMULATED</span> under stated assumptions.
            </div>
          </div>
          <Badge variant="cyan" size="xs" className="shrink-0">
            SIMULATED (T-19)
          </Badge>
        </div>

        {/* Title Header */}
        <div className="pb-3 border-b border-line-default">
          <h2 className="text-lg font-sans font-bold text-content-primary flex items-center gap-2">
            <GitCompare className="w-5 h-5 text-trade-coral" />
            Market Structure: Continuous Order Book (Model) vs. Epoch FBA
          </h2>
          <p className="text-2xs text-content-muted mt-0.5">
            Theoretical side-by-side adverse selection, execution cost, and MEV extraction comparison across both monopoly (k=1) and competitive (k=5) regimes.
          </p>
        </div>

        {/* Equal Prominence: Side-by-Side k=1 vs k=5 Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card 1: k=5 Competitive */}
          <div className="p-4 rounded-lg bg-surface-card border border-line-default space-y-3">
            <div className="flex items-center justify-between border-b border-line-subtle pb-2">
              <div>
                <span className="text-[10px] text-content-muted uppercase font-sans tracking-wider block">
                  Regime 1: Highly Competitive
                </span>
                <span className="text-sm font-sans font-bold text-content-primary">
                  k = 5 Snipers (Bertrand Competition)
                </span>
              </div>
              <Badge variant="emerald" size="xs">
                -91.0% Adverse Loss
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-content-muted block">Continuous Order Book (Model):</span>
                <span className="text-trade-coral font-bold">
                  {dataK5.clobMakerLossBps.toFixed(3)} bps (${dataK5.clobMakerLossUsd.toFixed(2)} / $100k per jump)
                </span>
              </div>
              <div>
                <span className="text-content-muted block">Epoch FBA (Batched):</span>
                <span className="text-trade-emerald font-bold">
                  {dataK5.epochMakerLossBps.toFixed(3)} bps (${dataK5.epochMakerLossUsd.toFixed(2)} / $100k per jump)
                </span>
              </div>
            </div>
            <div className="pt-2 border-t border-line-subtle text-[11px] flex justify-between items-center">
              <span className="text-content-muted">Net Maker Benefit (Per Jump):</span>
              <span className="text-trade-emerald font-bold">
                +{dataK5.diffBps.toFixed(3)} bps (+${dataK5.diffUsd.toFixed(2)} / $100k) [SIMULATED]
              </span>
            </div>
            <div className="text-[10px] text-content-muted">
              95% Bootstrap CI: [{dataK5.ci95Bps[0].toFixed(3)}, {dataK5.ci95Bps[1].toFixed(3)}] bps (${dataK5.ci95Usd[0].toFixed(2)} – ${dataK5.ci95Usd[1].toFixed(2)} per $100k per jump)
            </div>
          </div>

          {/* Card 2: k=1 Monopoly */}
          <div className="p-4 rounded-lg bg-surface-card border border-line-default space-y-3">
            <div className="flex items-center justify-between border-b border-line-subtle pb-2">
              <div>
                <span className="text-[10px] text-content-muted uppercase font-sans tracking-wider block">
                  Regime 2: Low Competition
                </span>
                <span className="text-sm font-sans font-bold text-content-primary">
                  k = 1 Sniper (Monopoly Arbitrageur)
                </span>
              </div>
              <Badge variant="emerald" size="xs">
                -53.8% Adverse Loss
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-content-muted block">Continuous Order Book (Model):</span>
                <span className="text-trade-coral font-bold">
                  {dataK1.clobMakerLossBps.toFixed(3)} bps (${dataK1.clobMakerLossUsd.toFixed(2)} / $100k per jump)
                </span>
              </div>
              <div>
                <span className="text-content-muted block">Epoch FBA (Batched):</span>
                <span className="text-trade-emerald font-bold">
                  {dataK1.epochMakerLossBps.toFixed(3)} bps (${dataK1.epochMakerLossUsd.toFixed(2)} / $100k per jump)
                </span>
              </div>
            </div>
            <div className="pt-2 border-t border-line-subtle text-[11px] flex justify-between items-center">
              <span className="text-content-muted">Net Maker Benefit (Per Jump):</span>
              <span className="text-trade-emerald font-bold">
                +{dataK1.diffBps.toFixed(3)} bps (+${dataK1.diffUsd.toFixed(2)} / $100k) [SIMULATED]
              </span>
            </div>
            <div className="text-[10px] text-content-muted">
              95% Bootstrap CI: [{dataK1.ci95Bps[0].toFixed(3)}, {dataK1.ci95Bps[1].toFixed(3)}] bps (${dataK1.ci95Usd[0].toFixed(2)} – ${dataK1.ci95Usd[1].toFixed(2)} per $100k per jump)
            </div>
          </div>
        </div>

        {/* Side-by-Side Dual Comparison Table */}
        <div className="bg-surface-card rounded-lg border border-line-default overflow-hidden">
          <div className="p-3 border-b border-line-default bg-surface-panel flex items-center justify-between">
            <div className="font-sans font-bold text-content-primary text-xs flex items-center gap-2">
              <Scale className="w-4 h-4 text-trade-coral" />
              Comparative Execution Matrix: k = 5 vs k = 1 Regimes
            </div>
            <span className="text-[10px] text-content-muted font-mono">
              Model result under stated assumptions (Basis Points per Price Jump / Trade, $100k Notional)
            </span>
          </div>

          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="text-content-muted text-[10px] uppercase border-b border-line-default bg-surface-canvas font-sans">
                <th className="py-2.5 px-4">Metric / Dimension</th>
                <th className="py-2.5 px-4 text-trade-coral">Continuous Order Book (Model)</th>
                <th className="py-2.5 px-4 text-trade-emerald">Epoch FBA (k = 5 Snipers)</th>
                <th className="py-2.5 px-4 text-trade-cyan">Epoch FBA (k = 1 Sniper)</th>
              </tr>
            </thead>
            <tbody className="divide-y border-line-subtle text-content-primary">
              <tr className="hover:bg-surface-hover transition-colors">
                <td className="py-2.5 px-4 font-sans font-medium text-content-primary">Execution Matching</td>
                <td className="py-2.5 px-4 text-content-muted">Continuous serial matching</td>
                <td className="py-2.5 px-4 text-trade-emerald font-semibold">Discrete 2-slot batch (~477ms)</td>
                <td className="py-2.5 px-4 text-trade-cyan font-semibold">Discrete 2-slot batch (~477ms)</td>
              </tr>
              <tr className="hover:bg-surface-hover transition-colors">
                <td className="py-2.5 px-4 font-sans font-medium text-content-primary">Clearing Price</td>
                <td className="py-2.5 px-4 text-content-muted">Continuous price ladder</td>
                <td className="py-2.5 px-4 text-trade-emerald font-semibold">Single uniform price P*</td>
                <td className="py-2.5 px-4 text-trade-cyan font-semibold">Single uniform price P*</td>
              </tr>
              <tr className="hover:bg-surface-hover transition-colors">
                <td className="py-2.5 px-4 font-sans font-medium text-content-primary">Maker Adverse Loss (per jump)</td>
                <td className="py-2.5 px-4 text-trade-coral tabular-nums font-semibold">
                  0.035 bps ($0.35 / $100k)<br />
                  <span className="text-[10px] text-content-muted font-normal">Identical across k=1 and k=5</span>
                </td>
                <td className="py-2.5 px-4 text-trade-emerald tabular-nums font-semibold">
                  0.003 bps ($0.03 / $100k)<br />
                  <span className="text-[10px] text-trade-emerald font-bold">-91.0% (-0.032 bps / -$0.32)</span>
                </td>
                <td className="py-2.5 px-4 text-trade-cyan tabular-nums font-semibold">
                  0.016 bps ($0.16 / $100k)<br />
                  <span className="text-[10px] text-trade-cyan font-bold">-53.8% (-0.019 bps / -$0.19)</span>
                </td>
              </tr>
              <tr className="hover:bg-surface-hover transition-colors">
                <td className="py-2.5 px-4 font-sans font-medium text-content-primary">Priority MEV (Intra-Batch Sandwich)</td>
                <td className="py-2.5 px-4 text-trade-coral tabular-nums font-semibold">
                  3.00 bps ($30.00 / $100k)
                </td>
                <td className="py-2.5 px-4 text-trade-emerald tabular-nums font-semibold">
                  0.00 bps ($0.00) [100% Eliminated]
                </td>
                <td className="py-2.5 px-4 text-trade-cyan tabular-nums font-semibold">
                  0.00 bps ($0.00) [100% Eliminated]
                </td>
              </tr>
              <tr className="hover:bg-surface-hover transition-colors">
                <td className="py-2.5 px-4 font-sans font-medium text-content-primary">Uninformed Cost (per trade)</td>
                <td className="py-2.5 px-4 text-content-muted tabular-nums">
                  6.013 bps ($60.13 / $100k)
                </td>
                <td className="py-2.5 px-4 text-trade-emerald tabular-nums font-semibold">
                  5.993 bps ($59.93 / $100k)
                </td>
                <td className="py-2.5 px-4 text-trade-cyan tabular-nums font-semibold">
                  5.993 bps ($59.93 / $100k)
                </td>
              </tr>
              <tr className="hover:bg-surface-hover transition-colors">
                <td className="py-2.5 px-4 font-sans font-medium text-content-primary">Latency Defense Mechanism</td>
                <td className="py-2.5 px-4 text-content-muted">Hardware fiber & priority gas fees</td>
                <td className="py-2.5 px-4 text-trade-emerald">Uniform price clearing & pro-rata</td>
                <td className="py-2.5 px-4 text-trade-cyan">Uniform price clearing & pro-rata</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Detailed Assumptions & Methodological Transparency Box */}
        <div className="p-4 rounded-lg bg-surface-card border border-line-default space-y-3">
          <div className="font-sans font-bold text-content-primary text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-trade-emerald" />
            Simulation Assumptions & Methodological Disclosures
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] text-content-secondary">
            <div className="p-3 rounded bg-surface-panel border border-line-subtle space-y-1.5">
              <strong className="text-content-primary block font-sans">Model Parameters & Dataset:</strong>
              <div>• <strong>Batch Duration:</strong> 2 Solana slots (~477 ms cadence [MEASURED: 239ms/slot]).</div>
              <div>• <strong>Protocol Fees:</strong> 5.0 bps maker, 5.0 bps taker (symmetrical fee).</div>
              <div>• <strong>Standard Notional:</strong> $100,000 USD (1 bps = $10.00).</div>
              <div>• <strong>Dataset & Scaling:</strong> S-1 used 1,000 Binance SOL/USDT 1-minute historical candles (mean price $120.56, P50 move 1.66 bps). Sub-second volatility is modeled via standard Brownian motion square-root-of-time scaling (σ √Δt). This provides a continuous mathematical proxy for high-frequency tick behavior.</div>
            </div>

            <div className="p-3 rounded bg-surface-panel border border-line-subtle space-y-1.5">
              <strong className="text-content-primary block font-sans">Mechanism Boundary Disclosures:</strong>
              <div>• <strong>Ordering Sandwiches Eliminated:</strong> Because buy and sell orders within a batch execute at the exact same uniform clearing price P*, intra-batch ordering advantage and sandwich attacks are impossible by construction.</div>
              <div>• <strong>Threat R4 (Last-Look Advantage) Unaddressed:</strong> An informed sniper who observes external off-chain price jumps at T_close - ε can submit late limit orders into the closing batch. While batching reduces adverse selection when multiple snipers compete (k=5), it does not eliminate the informational advantage of the last observer.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
