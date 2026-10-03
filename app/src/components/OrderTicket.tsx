"use client";

import React, { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { ArrowUpRight, ArrowDownRight, Loader2 } from "lucide-react";

interface OrderTicketProps {
  currentBatchId: number;
  oraclePrice: number;
  selectedOffsetBps: number;
  onChangeOffset: (offset: number) => void;
  availableCollateral: number;
  isPlacingOrder: boolean;
  onPlaceOrder: (args: {
    side: "BUY" | "SELL";
    lots: number;
    offsetBps: number;
    targetBatch: number;
  }) => Promise<void>;
}

export const OrderTicket: React.FC<OrderTicketProps> = ({
  currentBatchId,
  oraclePrice,
  selectedOffsetBps,
  onChangeOffset,
  availableCollateral,
  isPlacingOrder,
  onPlaceOrder,
}) => {
  const { connected } = useWallet();
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"LIMIT" | "MARKET">("LIMIT");
  const [lots, setLots] = useState<number>(10);
  const [targetBatchOffset, setTargetBatchOffset] = useState<number>(1); // 1 = next batch

  const targetBatch = currentBatchId + targetBatchOffset;
  const effectiveOffset = orderType === "MARKET" ? (side === "BUY" ? 50 : -50) : selectedOffsetBps;
  const limitPrice = oraclePrice * (1 + effectiveOffset / 10_000);

  // 1 lot = 0.001 SOL. Notional = lots * (oracle_price / 1000)
  const notionalUsd = (lots * oraclePrice) / 1000;
  const requiredMarginUsd = notionalUsd * 0.1; // 10% IMR
  const slippageReserveUsd = (notionalUsd * Math.abs(effectiveOffset)) / 10_000;
  const totalRequired = requiredMarginUsd + slippageReserveUsd;

  const handleSliderChange = (percent: number) => {
    // Max lots based on available collateral and 10x leverage
    const maxLots = Math.max(1, Math.floor((availableCollateral * 10 * 1000) / oraclePrice));
    const calculatedLots = Math.max(1, Math.floor((maxLots * percent) / 100));
    setLots(calculatedLots);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || isPlacingOrder || lots <= 0) return;
    await onPlaceOrder({
      side,
      lots,
      offsetBps: effectiveOffset,
      targetBatch,
    });
  };

  return (
    <div className="w-[300px] flex flex-col min-h-0 bg-[#0e1217] select-none font-sans text-[12px] border-l bp-border">
      {/* Side Selector Tabs (Buy / Sell) */}
      <div className="p-3 pb-2 border-b bp-border">
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#12161c] rounded-md">
          <button
            onClick={() => setSide("BUY")}
            className={`py-1.5 rounded font-semibold text-[13px] transition-all flex items-center justify-center gap-1 ${
              side === "BUY"
                ? "bg-[#162720] text-[#0ecb81] border border-[#0ecb81]/30 shadow-sm"
                : "text-[#848e9c] hover:text-white"
            }`}
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>Buy / Long</span>
          </button>
          <button
            onClick={() => setSide("SELL")}
            className={`py-1.5 rounded font-semibold text-[13px] transition-all flex items-center justify-center gap-1 ${
              side === "SELL"
                ? "bg-[#2a1619] text-[#f6465d] border border-[#f6465d]/30 shadow-sm"
                : "text-[#848e9c] hover:text-white"
            }`}
          >
            <ArrowDownRight className="w-4 h-4" />
            <span>Sell / Short</span>
          </button>
        </div>
      </div>

      {/* Order Type Tabs */}
      <div className="px-3 pt-2 pb-1.5 flex items-center gap-4 border-b bp-border-subtle text-[11px]">
        <button
          onClick={() => setOrderType("LIMIT")}
          className={`pb-1 font-semibold transition-colors ${
            orderType === "LIMIT"
              ? "text-white border-b-2 border-white"
              : "text-[#848e9c] hover:text-white"
          }`}
        >
          Limit Offset
        </button>
        <button
          onClick={() => setOrderType("MARKET")}
          className={`pb-1 font-semibold transition-colors ${
            orderType === "MARKET"
              ? "text-white border-b-2 border-white"
              : "text-[#848e9c] hover:text-white"
          }`}
        >
          Market Cross
        </button>
      </div>

      {/* Form Fields */}
      <form onSubmit={handleSubmit} className="p-3 space-y-3 flex-1 flex flex-col justify-between">
        <div className="space-y-3">
          {/* Target Batch Lookahead Selector */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-[#848e9c]">
              <span>Target Batch</span>
              <span className="font-mono text-[#00f0ff]">Lookahead Window</span>
            </div>
            <div className="grid grid-cols-3 gap-1 p-0.5 rounded bg-[#12161c] border bp-border text-[10px] font-mono">
              {[1, 2, 3].map((offset) => {
                const bId = currentBatchId + offset;
                const active = targetBatchOffset === offset;
                return (
                  <button
                    key={offset}
                    type="button"
                    onClick={() => setTargetBatchOffset(offset)}
                    className={`py-1 rounded text-center transition-all ${
                      active
                        ? "bg-[#1f2633] text-white font-bold border bp-border"
                        : "text-[#848e9c] hover:text-white"
                    }`}
                  >
                    #{bId} {offset === 1 ? "(Next)" : `(+${offset})`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tick Offset Input (if Limit) */}
          {orderType === "LIMIT" && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#848e9c]">Tick Offset (bps)</span>
                <span className="font-mono text-white">${limitPrice.toFixed(3)}</span>
              </div>
              <div className="flex items-center justify-between bg-[#12161c] rounded-md border bp-border px-3 py-2">
                <input
                  type="number"
                  min={-50}
                  max={50}
                  value={selectedOffsetBps}
                  onChange={(e) => onChangeOffset(parseInt(e.target.value) || 0)}
                  className="w-full bg-transparent text-white font-mono text-[13px] font-semibold focus:outline-none"
                />
                <span className="text-[11px] font-mono text-[#848e9c]">bps</span>
              </div>
            </div>
          )}

          {/* Quantity Input */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#848e9c]">Quantity (Lots)</span>
              <span className="font-mono text-[#848e9c]">
                {(lots * 0.001).toFixed(3)} SOL
              </span>
            </div>
            <div className="flex items-center justify-between bg-[#12161c] rounded-md border bp-border px-3 py-2">
              <input
                type="number"
                min={1}
                step={1}
                value={lots}
                onChange={(e) => setLots(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full bg-transparent text-white font-mono text-[13px] font-semibold focus:outline-none"
              />
              <span className="text-[11px] font-mono text-[#848e9c]">Lots</span>
            </div>
          </div>

          {/* Leverage Quick Slider */}
          <div className="pt-1">
            <div className="flex items-center justify-between text-[10px] font-mono text-[#848e9c] mb-1">
              <span>Quick Size</span>
              <span>10x Max</span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {[25, 50, 75, 100].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => handleSliderChange(pct)}
                  className="py-1 rounded bg-[#12161c] hover:bg-[#181d24] text-[#848e9c] hover:text-white border bp-border text-[10px] font-mono"
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {/* Margin & Metrics Card */}
          <div className="p-2.5 rounded-md bg-[#12161c] border bp-border space-y-1.5 text-[11px] font-mono">
            <div className="flex items-center justify-between text-[#848e9c]">
              <span>Order Notional</span>
              <span className="text-white">${notionalUsd.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-[#848e9c]">
              <span>Req. Margin (10%)</span>
              <span className="text-[#00f0ff]">${requiredMarginUsd.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-[#848e9c]">
              <span>Slippage Reserve</span>
              <span className="text-[#848e9c]">${slippageReserveUsd.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-[#848e9c] pt-1 border-t bp-border-subtle">
              <span>Available Collateral</span>
              <span className="text-white font-semibold">
                ${availableCollateral.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Submit Action Button */}
        <div className="pt-2">
          {connected ? (
            <button
              type="submit"
              disabled={isPlacingOrder || totalRequired > availableCollateral}
              className={`w-full py-2.5 rounded-md font-bold text-[13px] tracking-tight transition-all shadow-lg flex items-center justify-center gap-2 ${
                totalRequired > availableCollateral
                  ? "bg-[#242b35] text-[#848e9c] cursor-not-allowed"
                  : side === "BUY"
                  ? "bg-[#0ecb81] hover:bg-[#00a372] text-[#0b0e11] active:scale-[0.99]"
                  : "bg-[#f6465d] hover:bg-[#d92d3b] text-white active:scale-[0.99]"
              }`}
            >
              {isPlacingOrder ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Submitting to Batch #{targetBatch}...</span>
                </>
              ) : totalRequired > availableCollateral ? (
                <span>Insufficient Collateral</span>
              ) : (
                <span>
                  Place {side} Order · Batch #{targetBatch}
                </span>
              )}
            </button>
          ) : (
            <div className="text-center py-2 text-[#848e9c] text-[11px] font-mono">
              Connect wallet above to place orders
            </div>
          )}
        </div>
      </form>
    </div>
  );
};
