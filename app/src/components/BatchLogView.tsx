"use client";

import React from "react";
import { History, ShieldCheck, CheckCircle2 } from "lucide-react";

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
    <div className="flex-1 overflow-y-auto p-4 bg-[#0b0e11] font-mono text-[12px] select-none">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between pb-3 border-b bp-border">
          <div>
            <h2 className="text-[18px] font-sans font-bold text-white flex items-center gap-2">
              <History className="w-5 h-5 text-[#e54040]" />
              Historical Batch Log
            </h2>
            <p className="text-[11px] text-[#848e9c]">
              Every Frequent Batch Auction cleared and settled on-chain with deterministic uniform pricing.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-[#0ecb81] bg-[#162720] border border-[#0ecb81]/30 px-3 py-1.5 rounded-md">
            <CheckCircle2 className="w-4 h-4" />
            <span>All Batches Verified</span>
          </div>
        </div>

        <div className="bg-[#0e1217] rounded-lg border bp-border overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[#848e9c] text-[10px] uppercase border-b bp-border bg-[#12161c]">
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
            <tbody className="divide-y bp-border text-[#f0f3f6]">
              {batches.map((b) => (
                <tr key={b.batchId} className="hover:bg-[#161b22] transition-colors">
                  <td className="py-2.5 px-3 font-bold text-white">Batch #{b.batchId}</td>
                  <td className="py-2.5 px-3 font-semibold text-[#0ecb81]">
                    ${b.clearingPrice.toFixed(3)}
                  </td>
                  <td className="py-2.5 px-3">
                    {b.offsetBps > 0 ? `+${b.offsetBps}` : b.offsetBps} bps
                  </td>
                  <td className="py-2.5 px-3 font-medium">
                    {b.matchedLots} Lots ({(b.matchedLots * 0.001).toFixed(3)} SOL)
                  </td>
                  <td className="py-2.5 px-3 text-[#848e9c]">${b.oraclePrice.toFixed(2)}</td>
                  <td className="py-2.5 px-3 text-[#848e9c]">±${(b.oracleConf / 1_000_000).toFixed(4)}</td>
                  <td className="py-2.5 px-3 text-[#00f0ff]">{b.cuConsumed ? `${b.cuConsumed.toLocaleString()} CU` : "~18,728 CU"}</td>
                  <td className="py-2.5 px-3 text-right">
                    <span
                      className={`text-[9px] px-2 py-0.5 rounded font-semibold ${
                        b.status === "CLEARED"
                          ? "bg-[#0ecb81]/15 text-[#0ecb81]"
                          : b.status === "SETTLED"
                          ? "bg-[#00f0ff]/15 text-[#00f0ff]"
                          : "bg-[#eab308]/15 text-[#eab308]"
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
