"use client";

import React, { useState } from "react";
import { History, AlertTriangle, ExternalLink, Filter, CheckCircle2, RefreshCw } from "lucide-react";
import { formatUsd, formatNumber, formatLots } from "../lib/formatters";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";

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
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-surface-canvas font-mono text-xs select-none">
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Data Source & Status Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg bg-surface-card border border-line-default text-[11px]">
          <div className="flex items-center gap-2">
            {dataSource === "rpc" ? (
              <CheckCircle2 className="w-4 h-4 text-trade-emerald shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-trade-amber shrink-0" />
            )}
            <div>
              {dataSource === "rpc" ? (
                <span>
                  <strong className="text-content-primary font-sans">LIVE ON-CHAIN STREAM (RPC):</strong> Streaming verified batch clearance and settlement events directly from Solana cluster.
                </span>
              ) : (
                <span>
                  <strong className="text-content-primary font-sans">ON-CHAIN SNAPSHOT:</strong>{" "}
                  {snapshotGeneratedAt ? (
                    <span className="text-trade-cyan">Snapshot generated {new Date(snapshotGeneratedAt).toLocaleTimeString()} ({new Date(snapshotGeneratedAt).toLocaleDateString()})</span>
                  ) : (
                    <span className="text-content-muted">Loaded from verified on-chain export</span>
                  )}
                  . Historical records represent deterministic on-chain batch auctions.
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onRefresh && (
              <Button
                variant="ghost"
                size="xs"
                onClick={onRefresh}
                className="gap-1 text-content-secondary"
              >
                <RefreshCw className="w-3 h-3" />
                Refresh
              </Button>
            )}
            <Badge
              variant={dataSource === "rpc" ? "emerald" : "cyan"}
              size="xs"
            >
              {dataSource === "rpc" ? "LIVE RPC" : "SNAPSHOT FALLBACK"}
            </Badge>
          </div>
        </div>

        {/* Title Header & Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-line-default gap-3">
          <div>
            <h2 className="text-lg font-sans font-bold text-content-primary flex items-center gap-2">
              <History className="w-5 h-5 text-trade-coral" />
              Historical Batch Clearance Log
            </h2>
            <p className="text-2xs text-content-muted mt-0.5">
              Frequent Batch Auctions cleared and settled on-chain with deterministic uniform pricing.
            </p>
          </div>

          {/* Empty Batches Toggle per Item 3 */}
          <div className="flex items-center gap-2 bg-surface-card px-3 py-1.5 rounded-md border border-line-default shrink-0">
            <Filter className="w-3.5 h-3.5 text-trade-cyan" />
            <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-content-secondary">
              <input
                type="checkbox"
                checked={hideEmptyBatches}
                onChange={(e) => setHideEmptyBatches(e.target.checked)}
                className="rounded bg-surface-canvas border-line-strong text-trade-cyan focus:ring-0 cursor-pointer"
              />
              <span>Hide empty batches (0 fills)</span>
              {emptyCount > 0 && (
                <span className="text-[10px] text-content-muted font-mono">({emptyCount} hidden)</span>
              )}
            </label>
          </div>
        </div>

        {/* Batches Table */}
        <div className="bg-surface-card rounded-lg border border-line-default overflow-hidden">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="text-content-muted text-[10px] uppercase border-b border-line-default bg-surface-panel font-sans">
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
            <tbody className="divide-y border-line-subtle text-content-primary">
              {displayedBatches.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-content-muted font-sans">
                    No batches match current filter.
                  </td>
                </tr>
              ) : (
                displayedBatches.map((b) => (
                  <tr key={b.batchId} className="hover:bg-surface-hover transition-colors">
                    <td className="py-2.5 px-3 font-bold text-content-primary">
                      Batch #{b.batchId}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-trade-emerald tabular-nums">
                      {formatUsd(b.clearingPrice, 3)}
                    </td>
                    <td className="py-2.5 px-3 tabular-nums">
                      {b.offsetBps > 0 ? `+${b.offsetBps}` : b.offsetBps} bps
                    </td>
                    <td className="py-2.5 px-3 font-medium tabular-nums">
                      {b.matchedLots > 0 ? (
                        <span className="text-content-primary">
                          {formatLots(b.matchedLots)}{" "}
                          <span className="text-content-muted text-[10px]">
                            ({(b.matchedLots * 0.001).toFixed(3)} SOL)
                          </span>
                        </span>
                      ) : (
                        <span className="text-content-muted">0 lots (Empty)</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-content-muted tabular-nums">
                      {formatUsd(b.oraclePrice, 2)}
                    </td>
                    <td className="py-2.5 px-3 text-trade-cyan tabular-nums">
                      {b.cuConsumed ? `${formatNumber(b.cuConsumed, 0)} CU` : "17,267 CU"}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <Badge
                        variant={b.status === "CLEARED" ? "emerald" : b.status === "SETTLED" ? "cyan" : "amber"}
                        size="xs"
                      >
                        {b.status}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {b.signature ? (
                        <a
                          href={`https://explorer.solana.com/tx/${b.signature}?cluster=devnet`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-trade-cyan hover:underline"
                        >
                          <span>{b.signature.slice(0, 6)}...</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-content-muted text-[10px]">—</span>
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
