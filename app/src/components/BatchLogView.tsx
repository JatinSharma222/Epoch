"use client";

import React from "react";
import { History, AlertTriangle } from "lucide-react";
import { formatUsd, formatNumber, formatLots } from "../lib/formatters";

interface BatchLogViewProps {
  batches: Array<{
    batchId: number;
    clearingPrice: number;
    matchedLots: number;
    offsetBps: number;
    oraclePrice: number;
    oracleConf: number;
    status: "CLEARED" | "VOID" | "SETTLED";
    cuConsumed?: number;
  }>;
}

export const BatchLogView: React.FC<BatchLogViewProps> = ({ batches }) => {
  return (
    <div className="flex-1 overflow-y-auto p-4 bg-[#0B0E11] font-mono text-[12px] select-none">
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Sample Data Banner per 09 §6.1 */}
        <div className="p-3 rounded-lg bg-[#2B1D0E] border border-[#EAB308]/40 text-[#EAB308] flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-[#EAB308]" />
            <div>
              <strong className="font-bold">SAMPLE DATA (DEVNET DEMO):</strong> Historical batch
              log records represent replay demonstration data. Batches are cleared and settled
              deterministically via consensus.
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-[#EAB308]/20 text-[#EAB308] font-bold uppercase tracking-wider shrink-0 border border-[#EAB308]/30">
            DEMO STREAM
          </span>
        </div>

        {/* Title Header */}
        <div className="flex items-center justify-between pb-3 border-b bp-border">
          <div>
            <h2 className="text-[18px] font-sans font-bold text-white flex items-center gap-2">
              <History className="w-5 h-5 text-[#E54040]" />
              Historical Batch Clearance Log
            </h2>
            <p className="text-[11px] text-[#848E9C]">
              Frequent Batch Auctions cleared and settled on-chain with deterministic uniform pricing.
            </p>
          </div>
        </div>

        {/* Batches Table */}
        <div className="bg-[#0E1217] rounded-lg border bp-border overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[#848E9C] text-[10px] uppercase border-b bp-border bg-[#12161C] font-sans">
                <th className="py-2.5 px-3">Batch ID</th>
                <th className="py-2.5 px-3">Uniform Price</th>
                <th className="py-2.5 px-3">Offset (bps)</th>
                <th className="py-2.5 px-3">Volume Matched</th>
                <th className="py-2.5 px-3">Oracle Mark</th>
                <th className="py-2.5 px-3">Confidence</th>
                <th className="py-2.5 px-3">CU Consumed</th>
                <th className="py-2.5 px-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y bp-border text-[#F0F3F6]">
              {batches.map((b) => (
                <tr key={b.batchId} className="hover:bg-[#161B22] transition-colors">
                  <td className="py-2.5 px-3 font-bold text-white">Batch #{b.batchId}</td>
                  <td className="py-2.5 px-3 font-semibold text-[#0ECB81] tabular-nums">
                    {formatUsd(b.clearingPrice, 3)}
                  </td>
                  <td className="py-2.5 px-3 tabular-nums">
                    {b.offsetBps > 0 ? `+${b.offsetBps}` : b.offsetBps} bps
                  </td>
                  <td className="py-2.5 px-3 font-medium tabular-nums">
                    {formatLots(b.matchedLots)} ({(b.matchedLots * 0.001).toFixed(3)} SOL)
                  </td>
                  <td className="py-2.5 px-3 text-[#848E9C] tabular-nums">{formatUsd(b.oraclePrice, 2)}</td>
                  <td className="py-2.5 px-3 text-[#848E9C] tabular-nums">±{formatUsd(b.oracleConf / 1_000_000, 4)}</td>
                  <td className="py-2.5 px-3 text-[#00F0FF] tabular-nums">
                    {b.cuConsumed ? `${formatNumber(b.cuConsumed, 0)} CU` : "18,728 CU"}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <span
                      className={`text-[9px] px-2 py-0.5 rounded font-semibold ${
                        b.status === "CLEARED"
                          ? "bg-[#0ECB81]/15 text-[#0ECB81] border border-[#0ECB81]/30"
                          : b.status === "SETTLED"
                          ? "bg-[#00F0FF]/15 text-[#00F0FF] border border-[#00F0FF]/30"
                          : "bg-[#EAB308]/15 text-[#EAB308] border border-[#EAB308]/30"
                      }`}
                    >
                      {b.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
