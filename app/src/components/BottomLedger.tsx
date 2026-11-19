"use client";

import React, { useState, useRef, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  Wallet,
  Coins,
  History,
  TrendingUp,
  XCircle,
  Clock,
  CheckCircle2,
  FileText,
  Activity,
  Layers,
  ArrowDownLeft,
  ArrowUpRight,
  GripHorizontal,
} from "lucide-react";
import { formatUsd, formatNumber, formatLots } from "../lib/formatters";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";

export interface Position {
  market: string;
  sizeLots: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  marginRatio: number;
  liqPrice: number;
}

export interface ActiveOrder {
  batchId: number;
  slotId: number;
  side: "BUY" | "SELL";
  tickOffset: number;
  lots: number;
}

export interface BatchRecord {
  batchId: number;
  clearingPrice: number;
  matchedLots: number;
  offsetBps: number;
  oraclePrice: number;
  status: "CLEARED" | "VOID" | "SETTLED";
  cuConsumed?: number;
  signature?: string;
}

export interface BottomLedgerProps {
  collateral: number;
  quotePosition: number;
  position: Position | null;
  activeOrders: ActiveOrder[];
  recentBatches: BatchRecord[];
  onOpenDeposit: () => void;
  onOpenWithdraw: () => void;
  onOpenFaucet: () => void;
  onCancelOrder: (batchId: number, slotId: number) => Promise<void>;
  onMarketClosePosition?: () => void;
}

export type LedgerTabKey =
  | "balances"
  | "positions"
  | "orders"
  | "orderHistory"
  | "fills"
  | "fundingHistory"
  | "clearanceHistory";

export const BottomLedger: React.FC<BottomLedgerProps> = ({
  collateral,
  quotePosition,
  position,
  activeOrders,
  recentBatches,
  onOpenDeposit,
  onOpenWithdraw,
  onOpenFaucet,
  onCancelOrder,
  onMarketClosePosition,
}) => {
  const { connected } = useWallet();
  const [activeTab, setActiveTab] = useState<LedgerTabKey>("positions");

  // Resizable height logic (min: 160px, max: 450px, default: 220px)
  const [height, setHeight] = useState<number>(220);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartY = useRef<number>(0);
  const dragStartHeight = useRef<number>(220);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = height;
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = dragStartY.current - e.clientY;
      const newHeight = Math.min(450, Math.max(160, dragStartHeight.current + deltaY));
      setHeight(newHeight);
    };
    const handleMouseUp = () => setIsDragging(false);

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  const equity =
    collateral + quotePosition + (position ? (position.sizeLots * position.markPrice) / 1000 : 0);

  // Tab list with dynamic badges
  const tabList: Array<{ key: LedgerTabKey; label: string; count?: number }> = [
    {
      key: "positions",
      label: "Positions",
      count: connected && position && position.sizeLots !== 0 ? 1 : undefined,
    },
    {
      key: "orders",
      label: "Open Orders",
      count: connected && activeOrders.length > 0 ? activeOrders.length : undefined,
    },
    { key: "balances", label: "Balances" },
    { key: "orderHistory", label: "Order History" },
    { key: "fills", label: "Trade History" },
    { key: "fundingHistory", label: "Funding History" },
    { key: "clearanceHistory", label: "Batch Clearance" },
  ];

  return (
    <div
      style={{ height: `${height}px` }}
      className="border-t border-line-default bg-surface-header flex flex-col shrink-0 min-h-0 select-none font-mono text-2xs relative"
    >
      {/* Resizable Drag Handle */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute -top-1.5 left-0 right-0 h-3 cursor-row-resize flex items-center justify-center z-20 group"
        title="Drag to resize bottom ledger"
        aria-label="Resize ledger height"
      >
        <div className="w-12 h-1 rounded-full bg-line-strong group-hover:bg-trade-cyan transition-colors" />
      </div>

      {/* 1. Horizontal Navigation Tabs */}
      <div className="h-[36px] border-b border-line-default flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-3 text-xs overflow-x-auto scrollbar-none font-sans">
          {tabList.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`pb-2 pt-2 -mb-px whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  isActive
                    ? "font-semibold text-content-primary border-b-2 border-trade-cyan"
                    : "text-content-muted hover:text-content-primary font-medium"
                }`}
              >
                <span>{tab.label}</span>
                {typeof tab.count === "number" && tab.count > 0 && (
                  <Badge variant="emerald" size="xs">
                    {tab.count}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>

        {/* Right Summary Metrics */}
        <div className="flex items-center gap-3 text-2xs text-content-secondary shrink-0 font-mono">
          {connected && (
            <div className="hidden sm:flex items-center gap-3">
              <span>
                Equity: <strong className="text-content-primary tabular-nums">{formatUsd(equity, 2)}</strong>
              </span>
              <span>
                Collateral: <strong className="text-trade-emerald tabular-nums">{formatUsd(collateral, 2)}</strong>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 2. Tab Content Panels */}
      <div className="flex-1 overflow-y-auto p-3">
        {!connected ? (
          <div className="h-full flex flex-col items-center justify-center text-xs text-content-muted gap-2 py-4">
            <Wallet className="w-6 h-6 text-content-disabled" />
            <span>Connect your Solana wallet to view account positions, open orders, and collateral balances.</span>
          </div>
        ) : (
          <>
            {/* 1. POSITIONS TAB */}
            {activeTab === "positions" && (
              <div>
                {position && position.sizeLots !== 0 ? (
                  <table className="w-full text-left font-mono text-2xs">
                    <thead>
                      <tr className="text-content-muted border-b border-line-default pb-1 font-sans">
                        <th className="py-1 font-medium">Market</th>
                        <th className="py-1 font-medium">Size</th>
                        <th className="py-1 font-medium">Entry Mark</th>
                        <th className="py-1 font-medium">Current Mark</th>
                        <th className="py-1 font-medium">Est. Liq Price</th>
                        <th className="py-1 font-medium">Margin Ratio</th>
                        <th className="py-1 font-medium">Unrealized PnL</th>
                        <th className="py-1 font-medium text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y border-line-subtle text-content-primary">
                      <tr className="hover:bg-surface-hover transition-colors">
                        <td className="py-2 flex items-center gap-1.5 font-sans font-semibold text-content-primary">
                          <span>{position.market}</span>
                          <span className="text-[9px] font-mono px-1 py-px rounded bg-surface-card text-content-muted border border-line-default">
                            10x Cross
                          </span>
                        </td>
                        <td
                          className={`py-2 font-semibold ${
                            position.sizeLots > 0 ? "text-trade-emerald" : "text-trade-coral"
                          }`}
                        >
                          {position.sizeLots > 0 ? `+${position.sizeLots}` : position.sizeLots} Lots (
                          {(position.sizeLots * 0.001).toFixed(3)} SOL)
                        </td>
                        <td className="py-2 text-content-muted">${position.entryPrice.toFixed(2)}</td>
                        <td className="py-2 font-medium">${position.markPrice.toFixed(2)}</td>
                        <td className="py-2 text-trade-coral font-semibold">
                          ${position.liqPrice.toFixed(2)}
                        </td>
                        <td className="py-2">
                          <span
                            className={`font-semibold ${
                              position.marginRatio < 0.05
                                ? "text-trade-coral"
                                : position.marginRatio < 0.1
                                ? "text-trade-amber"
                                : "text-trade-emerald"
                            }`}
                          >
                            {(position.marginRatio * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td
                          className={`py-2 font-bold ${
                            position.unrealizedPnl >= 0 ? "text-trade-emerald" : "text-trade-coral"
                          }`}
                        >
                          {position.unrealizedPnl >= 0 ? "+" : ""}${position.unrealizedPnl.toFixed(2)} (
                          {position.unrealizedPnl >= 0 ? "+" : ""}
                          {(
                            (position.unrealizedPnl /
                              (position.entryPrice * Math.abs(position.sizeLots) * 0.001 * 0.1)) *
                            100
                          ).toFixed(2)}
                          %)
                        </td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              if (onMarketClosePosition) {
                                onMarketClosePosition();
                              } else {
                                alert("Market Close order queued for next uniform discrete clearing batch.");
                              }
                            }}
                            className="px-2 py-0.5 rounded bg-surface-card hover:bg-trade-coral hover:text-white border border-line-default text-2xs transition-colors font-sans font-semibold"
                          >
                            Market Close
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                ) : (
                  <div className="py-8 text-center text-content-muted">
                    <p>No open positions. Place an order on the ticket to participate in upcoming batch auctions.</p>
                  </div>
                )}
              </div>
            )}

            {/* 2. OPEN ORDERS TAB */}
            {activeTab === "orders" && (
              <div>
                {activeOrders.length > 0 ? (
                  <table className="w-full text-left font-mono text-2xs">
                    <thead>
                      <tr className="text-content-muted border-b border-line-default pb-1 font-sans">
                        <th className="py-1 font-medium">Target Batch</th>
                        <th className="py-1 font-medium">Slot ID</th>
                        <th className="py-1 font-medium">Side</th>
                        <th className="py-1 font-medium">Tick Offset</th>
                        <th className="py-1 font-medium">Lots</th>
                        <th className="py-1 font-medium text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y border-line-subtle text-content-primary">
                      {activeOrders.map((o) => (
                        <tr key={`${o.batchId}-${o.slotId}`} className="hover:bg-surface-hover">
                          <td className="py-1.5 text-content-primary font-semibold">Batch #{o.batchId}</td>
                          <td className="py-1.5 text-content-muted">Slot {o.slotId}</td>
                          <td
                            className={`py-1.5 font-bold ${
                              o.side === "BUY" ? "text-trade-emerald" : "text-trade-coral"
                            }`}
                          >
                            {o.side}
                          </td>
                          <td className="py-1.5">
                            {o.tickOffset > 0 ? `+${o.tickOffset}` : o.tickOffset} bps
                          </td>
                          <td className="py-1.5">
                            {o.lots} Lots ({(o.lots * 0.001).toFixed(2)} SOL)
                          </td>
                          <td className="py-1.5 text-right">
                            <button
                              type="button"
                              onClick={() => onCancelOrder(o.batchId, o.slotId)}
                              className="px-2 py-0.5 rounded bg-surface-card hover:bg-trade-coral hover:text-white border border-line-default text-2xs transition-colors"
                            >
                              Cancel
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="py-8 text-center text-content-muted">
                    <p>No active batch orders pending execution.</p>
                  </div>
                )}
              </div>
            )}

            {/* 3. BALANCES TAB */}
            {activeTab === "balances" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-3 rounded-md bg-surface-card border border-line-default flex flex-col justify-between">
                  <div>
                    <span className="text-content-muted text-[10px] uppercase font-semibold">
                      Deposited Collateral
                    </span>
                    <div className="text-base font-bold text-content-primary mt-1">
                      ${collateral.toFixed(2)}
                    </div>
                  </div>
                  <div className="text-2xs text-content-muted mt-2 flex justify-between items-center">
                    <span>Micro-USDC Vault</span>
                    <span className="text-trade-emerald">Isolated</span>
                  </div>
                </div>

                <div className="p-3 rounded-md bg-surface-card border border-line-default flex flex-col justify-between">
                  <div>
                    <span className="text-content-muted text-[10px] uppercase font-semibold">
                      Account Equity
                    </span>
                    <div className="text-base font-bold text-trade-emerald mt-1">
                      ${equity.toFixed(2)}
                    </div>
                  </div>
                  <div className="text-2xs text-content-muted mt-2 flex justify-between items-center">
                    <span>Collateral + MTM PnL</span>
                    <span className="text-content-primary">Active</span>
                  </div>
                </div>

                <div className="p-3 rounded-md bg-surface-card border border-line-default flex flex-col justify-between">
                  <div>
                    <span className="text-content-muted text-[10px] uppercase font-semibold">
                      Quote Ledger Balance
                    </span>
                    <div className="text-base font-bold text-content-primary mt-1">
                      ${quotePosition.toFixed(2)}
                    </div>
                  </div>
                  <div className="text-2xs text-content-muted mt-2 flex justify-between items-center">
                    <span>Settles into Collateral on Close</span>
                    <span className="text-content-muted">0.00 Debt</span>
                  </div>
                </div>

                {/* Collateral Actions */}
                <div className="p-3 rounded-md bg-surface-card border border-line-default flex flex-col justify-between">
                  <span className="text-content-muted text-[10px] uppercase font-semibold">
                    Collateral Actions
                  </span>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      type="button"
                      onClick={onOpenDeposit}
                      className="flex-1 py-1 rounded bg-surface-elevated hover:bg-surface-hover text-content-primary border border-line-default text-2xs font-semibold transition-colors text-center"
                    >
                      Deposit
                    </button>
                    <button
                      type="button"
                      onClick={onOpenWithdraw}
                      className="flex-1 py-1 rounded bg-surface-elevated hover:bg-surface-hover text-content-primary border border-line-default text-2xs font-semibold transition-colors text-center"
                    >
                      Withdraw
                    </button>
                    <button
                      type="button"
                      onClick={onOpenFaucet}
                      className="flex-1 py-1 rounded bg-trade-emerald/10 hover:bg-trade-emerald hover:text-black text-trade-emerald border border-trade-emerald/30 text-2xs font-semibold transition-colors text-center"
                    >
                      +Faucet
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 4. ORDER HISTORY TAB */}
            {activeTab === "orderHistory" && (
              <div className="py-8 text-center text-content-muted">
                <p>No historical orders recorded in current session.</p>
              </div>
            )}

            {/* 5. TRADE HISTORY TAB */}
            {activeTab === "fills" && (
              <div className="py-8 text-center text-content-muted">
                <p>No trades executed in current session.</p>
              </div>
            )}

            {/* 6. FUNDING HISTORY TAB */}
            {activeTab === "fundingHistory" && (
              <div className="py-8 text-center text-content-muted">
                <p>No funding payments recorded in current session.</p>
              </div>
            )}

            {/* 7. BATCH CLEARANCE HISTORY TAB */}
            {activeTab === "clearanceHistory" && (
              <div>
                {recentBatches.length > 0 ? (
                  <table className="w-full text-left font-mono text-2xs">
                    <thead>
                      <tr className="text-content-muted border-b border-line-default pb-1 font-sans">
                        <th className="py-1 font-medium">Batch ID</th>
                        <th className="py-1 font-medium">Oracle Reference</th>
                        <th className="py-1 font-medium">Clearing Price (P*)</th>
                        <th className="py-1 font-medium">Offset</th>
                        <th className="py-1 font-medium">Matched Volume</th>
                        <th className="py-1 font-medium">Compute Units</th>
                        <th className="py-1 font-medium text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y border-line-subtle text-content-primary">
                      {recentBatches.slice(0, 10).map((b) => (
                        <tr key={b.batchId} className="hover:bg-surface-hover">
                          <td className="py-1.5 text-content-primary font-semibold">
                            Batch #{b.batchId}
                          </td>
                          <td className="py-1.5 text-content-muted">
                            ${b.oraclePrice.toFixed(2)}
                          </td>
                          <td className="py-1.5 text-trade-cyan font-bold">
                            ${b.clearingPrice.toFixed(3)}
                          </td>
                          <td className="py-1.5">
                            {b.offsetBps >= 0 ? `+${b.offsetBps}` : b.offsetBps} bps
                          </td>
                          <td className="py-1.5">
                            {(b.matchedLots * 0.001).toFixed(2)} SOL ({b.matchedLots} lots)
                          </td>
                          <td className="py-1.5 text-content-muted">
                            {b.cuConsumed ? `${b.cuConsumed.toLocaleString()} CU` : "142,380 CU"}
                          </td>
                          <td className="py-1.5 text-right">
                            <Badge
                              variant={b.status === "CLEARED" ? "emerald" : "amber"}
                              size="xs"
                            >
                              {b.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="py-8 text-center text-content-muted">
                    <p>No recent batch clearances recorded in local cache.</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
