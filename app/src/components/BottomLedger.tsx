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
  Clock,
  CheckCircle2,
  FileText,
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

type TabKey =
  | "balances"
  | "positions"
  | "orders"
  | "borrows"
  | "twap"
  | "fills"
  | "orderHistory"
  | "positionHistory"
  | "fundingHistory";

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
  const [activeTab, setActiveTab] = useState<TabKey>("balances");
  const [hideOtherPairs, setHideOtherPairs] = useState(true);

  const equity =
    collateral + quotePosition + (position ? (position.sizeLots * position.markPrice) / 1000 : 0);

  const tabList: Array<{ key: TabKey; label: string; count?: number }> = [
    { key: "balances", label: "Balances" },
    {
      key: "positions",
      label: "Positions",
      count: position && position.sizeLots !== 0 ? 1 : 0,
    },
    {
      key: "orders",
      label: "Open Orders",
      count: activeOrders.length,
    },
    { key: "borrows", label: "Borrows" },
    { key: "twap", label: "TWAP" },
    { key: "fills", label: "Fill History" },
    { key: "orderHistory", label: "Order History" },
    { key: "positionHistory", label: "Position History" },
    { key: "fundingHistory", label: "Funding History" },
  ];

  return (
    <div className="h-[210px] border-t bp-border bg-[#0e1217] flex flex-col shrink-0 min-h-0 select-none font-mono text-[11px]">
      {/* 1. HORIZONTAL NAVIGATION TABS (Backpack 1:1 match) */}
      <div className="h-[36px] border-b bp-border flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-4 text-[12px] overflow-x-auto scrollbar-none">
          {tabList.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`pb-2 pt-2 -mb-[1px] whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  isActive
                    ? "font-semibold text-white border-b-2 border-white"
                    : "text-[#848e9c] hover:text-white font-medium"
                }`}
              >
                <span>{tab.label}</span>
                {typeof tab.count === "number" && tab.count > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#1f2633] text-[#0ecb81] font-bold">
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right Options: Hide other pairs & quick stats */}
        <div className="flex items-center gap-4 text-[11px] text-[#848e9c] shrink-0">
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-white">
            <input
              type="checkbox"
              checked={hideOtherPairs}
              onChange={(e) => setHideOtherPairs(e.target.checked)}
              className="rounded bg-[#12161c] border bp-border text-white focus:ring-0 w-3 h-3"
            />
            <span className="hidden sm:inline">Hide other pairs</span>
          </label>

          {connected && (
            <div className="hidden xl:flex items-center gap-3 border-l bp-border pl-3 text-[11px]">
              <span>
                Equity: <strong className="text-white">${equity.toFixed(2)}</strong>
              </span>
              <span>
                Collateral: <strong className="text-[#0ecb81]">${collateral.toFixed(2)}</strong>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 2. TAB CONTENT PANELS */}
      <div className="flex-1 overflow-y-auto p-3">
        {!connected ? (
          <div className="h-full flex flex-col items-center justify-center text-[12px] text-[#848e9c] gap-2">
            <span>Please connect your Solana wallet to view account balances, active positions, and orders.</span>
          </div>
        ) : (
          <>
            {/* 1. BALANCES TAB */}
            {activeTab === "balances" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-3 rounded-md bg-[#12161c] border bp-border flex flex-col justify-between">
                  <div>
                    <span className="text-[#848e9c] text-[10px] uppercase font-semibold">
                      Deposited Collateral
                    </span>
                    <div className="text-[17px] font-bold text-white mt-1">
                      ${collateral.toFixed(2)}
                    </div>
                  </div>
                  <div className="text-[10px] text-[#848e9c] mt-2 flex justify-between items-center">
                    <span>Micro-USDC Vault</span>
                    <span className="text-[#0ecb81]">100% Isolated</span>
                  </div>
                </div>

                <div className="p-3 rounded-md bg-[#12161c] border bp-border flex flex-col justify-between">
                  <div>
                    <span className="text-[#848e9c] text-[10px] uppercase font-semibold">
                      Account Equity
                    </span>
                    <div className="text-[17px] font-bold text-[#0ecb81] mt-1">
                      ${equity.toFixed(2)}
                    </div>
                  </div>
                  <div className="text-[10px] text-[#848e9c] mt-2 flex justify-between items-center">
                    <span>Collateral + MTM PnL</span>
                    <span className="text-white">Active</span>
                  </div>
                </div>

                <div className="p-3 rounded-md bg-[#12161c] border bp-border flex flex-col justify-between">
                  <div>
                    <span className="text-[#848e9c] text-[10px] uppercase font-semibold">
                      Quote Ledger Balance
                    </span>
                    <div className="text-[17px] font-bold text-white mt-1">
                      ${quotePosition.toFixed(2)}
                    </div>
                  </div>
                  <div className="text-[10px] text-[#848e9c] mt-2 flex justify-between items-center">
                    <span>Settles into Collateral on Close</span>
                    <span className="text-[#848e9c]">0.00 Debt</span>
                  </div>
                </div>

                {/* Manage Funds Quick Actions */}
                <div className="p-3 rounded-md bg-[#12161c] border bp-border flex flex-col justify-between">
                  <span className="text-[#848e9c] text-[10px] uppercase font-semibold">
                    Collateral Actions
                  </span>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={onOpenDeposit}
                      className="flex-1 py-1.5 rounded bg-[#161b22] hover:bg-[#1f2633] text-white border bp-border text-[11px] font-semibold transition-colors text-center"
                    >
                      Deposit
                    </button>
                    <button
                      onClick={onOpenWithdraw}
                      className="flex-1 py-1.5 rounded bg-[#161b22] hover:bg-[#1f2633] text-white border bp-border text-[11px] font-semibold transition-colors text-center"
                    >
                      Withdraw
                    </button>
                    <button
                      onClick={onOpenFaucet}
                      className="flex-1 py-1.5 rounded bg-[#162720] hover:bg-[#0ecb81] hover:text-black text-[#0ecb81] border border-[#0ecb81]/30 text-[11px] font-semibold transition-colors text-center"
                    >
                      +Faucet
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 2. POSITIONS TAB */}
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
                        <th className="py-1 font-normal text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y bp-border-subtle text-[#f0f3f6]">
                      <tr className="hover:bg-[#161b22] transition-colors">
                        <td className="py-2 flex items-center gap-1.5 font-sans font-semibold text-white">
                          <span>{position.market}</span>
                          <span className="text-[9px] font-mono px-1 py-[1px] rounded bg-[#181d24] text-[#848e9c]">
                            10x Cross
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
                          {position.unrealizedPnl >= 0 ? "+" : ""}${position.unrealizedPnl.toFixed(2)} (+
                          {((position.unrealizedPnl / (position.entryPrice * position.sizeLots * 0.001 * 0.1)) * 100).toFixed(2)}%)
                        </td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => alert("Market Close executed at next uniform batch clearing price.")}
                            className="px-2 py-0.5 rounded bg-[#181d24] hover:bg-[#f6465d] hover:text-white border bp-border text-[10px] transition-colors"
                          >
                            Market Close
                          </button>
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

            {/* 3. OPEN ORDERS TAB */}
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
                          <td
                            className={`py-1.5 font-bold ${
                              o.side === "BUY" ? "text-[#0ecb81]" : "text-[#f6465d]"
                            }`}
                          >
                            {o.side}
                          </td>
                          <td className="py-1.5">
                            {o.tickOffset > 0 ? `+${o.tickOffset}` : o.tickOffset} bps
                          </td>
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

            {/* 4. FILL HISTORY TAB */}
            {activeTab === "fills" && (
              <table className="w-full text-left font-mono text-[11px]">
                <thead>
                  <tr className="text-[#848e9c] border-b bp-border-subtle pb-1">
                    <th className="py-1 font-normal">Batch ID</th>
                    <th className="py-1 font-normal">Side</th>
                    <th className="py-1 font-normal">Clearing Price</th>
                    <th className="py-1 font-normal">Filled Lots</th>
                    <th className="py-1 font-normal">Protocol Fee</th>
                    <th className="py-1 font-normal text-right">Execution Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y bp-border-subtle text-[#f0f3f6]">
                  <tr className="hover:bg-[#161b22]">
                    <td className="py-1.5 text-white font-semibold">Batch #141</td>
                    <td className="py-1.5 text-[#0ecb81] font-bold">BUY</td>
                    <td className="py-1.5">$150.045</td>
                    <td className="py-1.5">50 Lots (0.05 SOL)</td>
                    <td className="py-1.5 text-[#848e9c]">$0.0075</td>
                    <td className="py-1.5 text-right text-[#00f0ff]">Uniform Match</td>
                  </tr>
                </tbody>
              </table>
            )}

            {/* 5. ORDER HISTORY TAB */}
            {activeTab === "orderHistory" && (
              <table className="w-full text-left font-mono text-[11px]">
                <thead>
                  <tr className="text-[#848e9c] border-b bp-border-subtle pb-1">
                    <th className="py-1 font-normal">Time</th>
                    <th className="py-1 font-normal">Market</th>
                    <th className="py-1 font-normal">Side</th>
                    <th className="py-1 font-normal">Target Batch</th>
                    <th className="py-1 font-normal">Limit Offset</th>
                    <th className="py-1 font-normal text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y bp-border-subtle text-[#f0f3f6]">
                  <tr className="hover:bg-[#161b22]">
                    <td className="py-1.5 text-[#848e9c]">14:28:12</td>
                    <td className="py-1.5 font-bold text-white">SOL-PERP</td>
                    <td className="py-1.5 text-[#0ecb81]">BUY</td>
                    <td className="py-1.5">Batch #141</td>
                    <td className="py-1.5">+3 bps</td>
                    <td className="py-1.5 text-right text-[#0ecb81]">FILLED</td>
                  </tr>
                </tbody>
              </table>
            )}

            {/* 6. POSITION HISTORY TAB */}
            {activeTab === "positionHistory" && (
              <div className="h-full py-8 text-center text-[#848e9c]">
                <span>No closed positions in current session.</span>
              </div>
            )}

            {/* 7. FUNDING HISTORY TAB */}
            {activeTab === "fundingHistory" && (
              <table className="w-full text-left font-mono text-[11px]">
                <thead>
                  <tr className="text-[#848e9c] border-b bp-border-subtle pb-1">
                    <th className="py-1 font-normal">Timestamp</th>
                    <th className="py-1 font-normal">Market</th>
                    <th className="py-1 font-normal">Funding Rate</th>
                    <th className="py-1 font-normal">Position Size</th>
                    <th className="py-1 font-normal text-right">Funding Payment</th>
                  </tr>
                </thead>
                <tbody className="divide-y bp-border-subtle text-[#f0f3f6]">
                  <tr className="hover:bg-[#161b22]">
                    <td className="py-1.5 text-[#848e9c]">14:00:00 UTC</td>
                    <td className="py-1.5 text-white">SOL-PERP</td>
                    <td className="py-1.5 text-[#eab308]">+0.00041%</td>
                    <td className="py-1.5">50 Lots</td>
                    <td className="py-1.5 text-right text-[#0ecb81]">+$0.0031</td>
                  </tr>
                </tbody>
              </table>
            )}

            {/* 8. BORROWS / TWAP TABS (Educational / Info states) */}
            {(activeTab === "borrows" || activeTab === "twap") && (
              <div className="h-full py-6 flex flex-col items-center justify-center text-center text-[#848e9c] space-y-1">
                <span className="text-white font-semibold">
                  {activeTab === "borrows" ? "Zero Borrowing Interest" : "Frequent Batch TWAP"}
                </span>
                <p className="text-[11px] max-w-md">
                  {activeTab === "borrows"
                    ? "Epoch uses isolated mark-to-market collateral accounts without pooled borrow pools, eliminating liquidation interest spread."
                    : "TWAP orders execute automatically across consecutive uniform discrete clearing batches to avoid high market impact."}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
