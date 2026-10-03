"use client";

import React, { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  Wallet,
  Coins,
  History,
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  XCircle,
} from "lucide-react";

interface Position {
  market: string;
  sizeLots: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  marginRatio: number;
  liqPrice: number;
}

interface ActiveOrder {
  batchId: number;
  slotId: number;
  side: "BUY" | "SELL";
  tickOffset: number;
  lots: number;
}

interface BatchRecord {
  batchId: number;
  clearingPrice: number;
  matchedLots: number;
  offsetBps: number;
  oraclePrice: number;
  status: "CLEARED" | "VOID" | "SETTLED";
}

interface BottomLedgerProps {
  collateral: number;
  quotePosition: number;
  position: Position | null;
  activeOrders: ActiveOrder[];
  recentBatches: BatchRecord[];
  onOpenDeposit: () => void;
  onOpenWithdraw: () => void;
  onOpenFaucet: () => void;
  onCancelOrder: (batchId: number, slotId: number) => Promise<void>;
}

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
}) => {
  const { connected } = useWallet();
  const [activeTab, setActiveTab] = useState<"positions" | "orders" | "balances" | "history">("positions");

  const equity = collateral + quotePosition + (position ? (position.sizeLots * position.markPrice) / 1000 : 0);

  return (
    <div className="h-[210px] border-t bp-border bg-[#0e1217] flex flex-col shrink-0 min-h-0 select-none font-mono text-[11px]">
      {/* Tab Navigation Strip */}
      <div className="h-[36px] border-b bp-border flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-5 text-[12px] overflow-x-auto">
          <button
            onClick={() => setActiveTab("positions")}
            className={`pb-2 pt-2 -mb-[1px] transition-colors ${
              activeTab === "positions"
                ? "font-semibold text-white border-b-2 border-white"
                : "text-[#848e9c] hover:text-white font-medium"
            }`}
          >
            Positions {position && position.sizeLots !== 0 ? "(1)" : "(0)"}
          </button>

          <button
            onClick={() => setActiveTab("orders")}
            className={`pb-2 pt-2 -mb-[1px] transition-colors ${
              activeTab === "orders"
                ? "font-semibold text-white border-b-2 border-white"
                : "text-[#848e9c] hover:text-white font-medium"
            }`}
          >
            Active Batch Orders {activeOrders.length > 0 ? `(${activeOrders.length})` : "(0)"}
          </button>

          <button
            onClick={() => setActiveTab("balances")}
            className={`pb-2 pt-2 -mb-[1px] transition-colors ${
              activeTab === "balances"
                ? "font-semibold text-white border-b-2 border-white"
                : "text-[#848e9c] hover:text-white font-medium"
            }`}
          >
            Balances & Collateral
          </button>

          <button
            onClick={() => setActiveTab("history")}
            className={`pb-2 pt-2 -mb-[1px] transition-colors ${
              activeTab === "history"
                ? "font-semibold text-white border-b-2 border-white"
                : "text-[#848e9c] hover:text-white font-medium"
            }`}
          >
            Batch Log
          </button>
        </div>

        {/* Quick Collateral Summary */}
        {connected && (
          <div className="hidden sm:flex items-center gap-3 text-[11px] font-mono text-[#848e9c]">
            <span>Equity: <strong className="text-white">${equity.toFixed(2)}</strong></span>
            <span>Collateral: <strong className="text-[#0ecb81]">${collateral.toFixed(2)}</strong></span>
          </div>
        )}
      </div>

      {/* Tab Panels */}
      <div className="flex-1 overflow-y-auto p-3">
        {!connected ? (
          <div className="h-full flex items-center justify-center text-[#848e9c] text-[12px]">
            <span>Connect your Solana wallet to view positions, orders, and balance</span>
          </div>
        ) : (
          <>
            {/* 1. POSITIONS TAB */}
            {activeTab === "positions" && (
              <div>
                {position && position.sizeLots !== 0 ? (
                  <table className="w-full text-left font-mono text-[11px]">
                    <thead>
                      <tr className="text-[#848e9c] border-b bp-border-subtle pb-1">
                        <th className="py-1 font-normal">Market</th>
                        <th className="py-1 font-normal">Size</th>
                        <th className="py-1 font-normal">Entry Mark</th>
                        <th className="py-1 font-normal">Current Mark</th>
                        <th className="py-1 font-normal">Est. Liq Price</th>
                        <th className="py-1 font-normal">Margin Ratio</th>
                        <th className="py-1 font-normal">Unrealized PnL</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y bp-border-subtle text-[#f0f3f6]">
                      <tr className="hover:bg-[#161b22] transition-colors">
                        <td className="py-2 flex items-center gap-1.5 font-sans font-semibold text-white">
                          <span>{position.market}</span>
                          <span className="text-[9px] font-mono px-1 py-[1px] rounded bg-[#181d24] text-[#848e9c]">
                            10x FBA
                          </span>
                        </td>
                        <td
                          className={`py-2 font-semibold ${
                            position.sizeLots > 0 ? "text-[#0ecb81]" : "text-[#f6465d]"
                          }`}
                        >
                          {position.sizeLots > 0 ? `+${position.sizeLots}` : position.sizeLots} Lots (
                          {(position.sizeLots * 0.001).toFixed(3)} SOL)
                        </td>
                        <td className="py-2 text-[#848e9c]">${position.entryPrice.toFixed(2)}</td>
                        <td className="py-2 font-medium">${position.markPrice.toFixed(2)}</td>
                        <td className="py-2 text-[#f6465d]">${position.liqPrice.toFixed(2)}</td>
                        <td className="py-2">{(position.marginRatio * 100).toFixed(1)}%</td>
                        <td
                          className={`py-2 font-bold ${
                            position.unrealizedPnl >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"
                          }`}
                        >
                          {position.unrealizedPnl >= 0 ? "+" : ""}${position.unrealizedPnl.toFixed(2)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                ) : (
                  <div className="h-full py-8 text-center text-[#848e9c]">
                    <span>No open positions. Place an order targeting an upcoming batch to open a position.</span>
                  </div>
                )}
              </div>
            )}

            {/* 2. ACTIVE ORDERS TAB */}
            {activeTab === "orders" && (
              <div>
                {activeOrders.length > 0 ? (
                  <table className="w-full text-left font-mono text-[11px]">
                    <thead>
                      <tr className="text-[#848e9c] border-b bp-border-subtle pb-1">
                        <th className="py-1 font-normal">Target Batch</th>
                        <th className="py-1 font-normal">Slot ID</th>
                        <th className="py-1 font-normal">Side</th>
                        <th className="py-1 font-normal">Tick Offset</th>
                        <th className="py-1 font-normal">Lots</th>
                        <th className="py-1 font-normal text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y bp-border-subtle text-[#f0f3f6]">
                      {activeOrders.map((o) => (
                        <tr key={`${o.batchId}-${o.slotId}`} className="hover:bg-[#161b22]">
                          <td className="py-1.5 text-white font-semibold">Batch #{o.batchId}</td>
                          <td className="py-1.5 text-[#848e9c]">Slot {o.slotId}</td>
                          <td className={`py-1.5 font-bold ${o.side === "BUY" ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                            {o.side}
                          </td>
                          <td className="py-1.5">{o.tickOffset > 0 ? `+${o.tickOffset}` : o.tickOffset} bps</td>
                          <td className="py-1.5">{o.lots} Lots</td>
                          <td className="py-1.5 text-right">
                            <button
                              onClick={() => onCancelOrder(o.batchId, o.slotId)}
                              className="px-2 py-0.5 rounded bg-[#181d24] hover:bg-[#f6465d] hover:text-white border bp-border text-[10px] transition-colors"
                            >
                              Cancel
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="h-full py-8 text-center text-[#848e9c]">
                    <span>No active batch orders pending execution.</span>
                  </div>
                )}
              </div>
            )}

            {/* 3. BALANCES & COLLATERAL TAB */}
            {activeTab === "balances" && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-md bg-[#12161c] border bp-border">
                  <div className="text-[#848e9c] text-[10px] uppercase">Deposited Collateral</div>
                  <div className="text-[16px] font-bold text-white mt-1">${collateral.toFixed(2)}</div>
                  <div className="text-[9px] text-[#848e9c] mt-0.5">Micro-USDC Ledger</div>
                </div>

                <div className="p-3 rounded-md bg-[#12161c] border bp-border">
                  <div className="text-[#848e9c] text-[10px] uppercase">Account Equity</div>
                  <div className="text-[16px] font-bold text-[#0ecb81] mt-1">${equity.toFixed(2)}</div>
                  <div className="text-[9px] text-[#848e9c] mt-0.5">Collateral + Quote + MTM</div>
                </div>

                <div className="p-3 rounded-md bg-[#12161c] border bp-border">
                  <div className="text-[#848e9c] text-[10px] uppercase">Quote Ledger Position</div>
                  <div className="text-[16px] font-bold text-white mt-1">${quotePosition.toFixed(2)}</div>
                  <div className="text-[9px] text-[#848e9c] mt-0.5">Folds into collateral on exit</div>
                </div>

                <div className="p-3 rounded-md bg-[#12161c] border bp-border flex flex-col justify-between">
                  <div className="text-[#848e9c] text-[10px] uppercase">Manage Funds</div>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={onOpenDeposit}
                      className="flex-1 py-1 rounded bg-[#161b22] hover:bg-[#1f2633] text-white border bp-border text-[11px] font-semibold transition-colors"
                    >
                      Deposit
                    </button>
                    <button
                      onClick={onOpenWithdraw}
                      className="flex-1 py-1 rounded bg-[#161b22] hover:bg-[#1f2633] text-white border bp-border text-[11px] font-semibold transition-colors"
                    >
                      Withdraw
                    </button>
                    <button
                      onClick={onOpenFaucet}
                      className="flex-1 py-1 rounded bg-[#162720] hover:bg-[#0ecb81] hover:text-black text-[#0ecb81] border border-[#0ecb81]/30 text-[11px] font-semibold transition-colors"
                    >
                      +Faucet
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 4. BATCH LOG TAB */}
            {activeTab === "history" && (
              <table className="w-full text-left font-mono text-[11px]">
                <thead>
                  <tr className="text-[#848e9c] border-b bp-border-subtle pb-1">
                    <th className="py-1 font-normal">Batch ID</th>
                    <th className="py-1 font-normal">Uniform Clearing Price</th>
                    <th className="py-1 font-normal">Matched Lots</th>
                    <th className="py-1 font-normal">Clearing Offset</th>
                    <th className="py-1 font-normal">Oracle Price</th>
                    <th className="py-1 font-normal text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y bp-border-subtle text-[#f0f3f6]">
                  {recentBatches.map((b) => (
                    <tr key={b.batchId} className="hover:bg-[#161b22]">
                      <td className="py-1.5 font-bold text-white">Batch #{b.batchId}</td>
                      <td className="py-1.5 font-semibold text-[#0ecb81]">${b.clearingPrice.toFixed(3)}</td>
                      <td className="py-1.5">{b.matchedLots} Lots</td>
                      <td className="py-1.5">{b.offsetBps > 0 ? `+${b.offsetBps}` : b.offsetBps} bps</td>
                      <td className="py-1.5 text-[#848e9c]">${b.oraclePrice.toFixed(2)}</td>
                      <td className="py-1.5 text-right">
                        <span
                          className={`text-[9px] px-1.5 py-[1px] rounded font-semibold ${
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
            )}
          </>
        )}
      </div>
    </div>
  );
};
