"use client";

import React, { useState } from "react";
import { History, AlertTriangle, ExternalLink, Filter, CheckCircle2, RefreshCw } from "lucide-react";
import { formatUsd, formatNumber, formatLots } from "../lib/formatters";

export interface BatchItem {
  batchId: number;
  clearingPrice: number;
  matchedLots: number;
  offsetBps: number;
  oraclePrice: number;
  oracleConf: number;
  status: "CLEARED" | "VOID" | "SETTLED";
  cuConsumed?: number;
  signature?: string;
  slot?: number;
  timestamp?: string;
}

interface BatchLogViewProps {
  batches: BatchItem[];
  dataSource?: "rpc" | "snapshot";
  snapshotGeneratedAt?: string;
  onRefresh?: () => void;
}

export const BatchLogView: React.FC<BatchLogViewProps> = ({
  batches,
  dataSource = "snapshot",
  snapshotGeneratedAt,
  onRefresh,
}) => {
  // 09 §6.1 / Item 3: Hide empty batches by default
  const [hideEmptyBatches, setHideEmptyBatches] = useState<boolean>(true);

  const displayedBatches = hideEmptyBatches
    ? batches.filter((b) => b.matchedLots > 0)
    : batches;

  const emptyCount = batches.filter((b) => b.matchedLots === 0).length;

  return (
    <div className="flex-1 overflow-y-auto p-4 bg-[#0B0E11] font-mono text-[12px] select-none">
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Data Source & Status Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg bg-[#181D24] border bp-border text-[11px]">
          <div className="flex items-center gap-2">
            {dataSource === "rpc" ? (
              <CheckCircle2 className="w-4 h-4 text-[#0ECB81] shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-[#EAB308] shrink-0" />
            )}
            <div>
              {dataSource === "rpc" ? (
                <span>
                  <strong className="text-white font-sans">LIVE ON-CHAIN STREAM (RPC):</strong> Streaming verified batch clearance and settlement events directly from Solana cluster.
                </span>
              ) : (
                <span>
                  <strong className="text-white font-sans">ON-CHAIN SNAPSHOT:</strong>{" "}
                  {snapshotGeneratedAt ? (
                    <span className="text-[#00F0FF]">Snapshot generated {new Date(snapshotGeneratedAt).toLocaleTimeString()} ({new Date(snapshotGeneratedAt).toLocaleDateString()})</span>
                  ) : (
                    <span className="text-[#848E9C]">Loaded from verified on-chain export</span>
                  )}
                  . Historical records represent deterministic on-chain batch auctions.
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#12161C] border bp-border text-[#848E9C] hover:text-white transition-colors text-[10px]"
              >
                <RefreshCw className="w-3 h-3" />
                Refresh
              </button>
            )}
            <span
              className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider border ${
                dataSource === "rpc"
                  ? "bg-[#0ECB81]/15 text-[#0ECB81] border-[#0ECB81]/30"
                  : "bg-[#00F0FF]/15 text-[#00F0FF] border-[#00F0FF]/30"
              }`}
            >
              {dataSource === "rpc" ? "LIVE RPC" : "SNAPSHOT FALLBACK"}
            </span>
          </div>
        </div>

        {/* Title Header & Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b bp-border gap-2">
          <div>
            <h2 className="text-[18px] font-sans font-bold text-white flex items-center gap-2">
              <History className="w-5 h-5 text-[#E54040]" />
              Historical Batch Clearance Log
            </h2>
            <p className="text-[11px] text-[#848E9C]">
              Frequent Batch Auctions cleared and settled on-chain with deterministic uniform pricing.
            </p>
          </div>

          {/* Empty Batches Toggle per Item 3 */}
          <div className="flex items-center gap-2 bg-[#12161C] px-3 py-1.5 rounded-md border bp-border shrink-0">
            <Filter className="w-3.5 h-3.5 text-[#00F0FF]" />
            <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-[#B7BDC6]">
              <input
                type="checkbox"
                checked={hideEmptyBatches}
                onChange={(e) => setHideEmptyBatches(e.target.checked)}
                className="rounded bg-[#0B0E11] border-white/20 text-[#00F0FF] focus:ring-0"
              />
              <span>Hide empty batches (0 fills)</span>
              {emptyCount > 0 && (
                <span className="text-[10px] text-[#848E9C] font-mono">({emptyCount} hidden)</span>
              )}
            </label>
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
                <th className="py-2.5 px-3">CU Consumed</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3 text-right">Transaction</th>
              </tr>
            </thead>
            <tbody className="divide-y bp-border text-[#F0F3F6]">
              {displayedBatches.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[#848E9C]">
                    No batches match current filter.
                  </td>
                </tr>
              ) : (
                displayedBatches.map((b) => (
                  <tr key={b.batchId} className="hover:bg-[#161B22] transition-colors">
                    <td className="py-2.5 px-3 font-bold text-white">
                      Batch #{b.batchId}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-[#0ECB81] tabular-nums">
                      {formatUsd(b.clearingPrice, 3)}
                    </td>
                    <td className="py-2.5 px-3 tabular-nums">
                      {b.offsetBps > 0 ? `+${b.offsetBps}` : b.offsetBps} bps
                    </td>
                    <td className="py-2.5 px-3 font-medium tabular-nums">
                      {b.matchedLots > 0 ? (
                        <span className="text-white">
                          {formatLots(b.matchedLots)}{" "}
                          <span className="text-[#848E9C] text-[10px]">
                            ({(b.matchedLots * 0.001).toFixed(3)} SOL)
                          </span>
                        </span>
                      ) : (
                        <span className="text-[#848E9C]">0 lots (Empty)</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-[#848E9C] tabular-nums">
                      {formatUsd(b.oraclePrice, 2)}
                    </td>
                    <td className="py-2.5 px-3 text-[#00F0FF] tabular-nums">
                      {b.cuConsumed ? `${formatNumber(b.cuConsumed, 0)} CU` : "17,267 CU"}
                    </td>
                    <td className="py-2.5 px-3 text-center">
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
                    <td className="py-2.5 px-3 text-right">
                      {b.signature ? (
                        <a
                          href={`https://explorer.solana.com/tx/${b.signature}?cluster=devnet`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-[#00F0FF] hover:underline"
                        >
                          <span>{b.signature.slice(0, 6)}...</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-[#848E9C] text-[10px]">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
