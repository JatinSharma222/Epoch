"use client";

import React, { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Loader2 } from "lucide-react";

interface OrderTicketProps {
  currentBatchId: number;
  markPrice: number;
  availableEquity: number;
  isPlacingOrder: boolean;
  selectedPrice?: number;
  onPlaceOrder: (args: {
    side: "BUY" | "SELL";
    price: number;
    lots: number;
    offsetBps: number;
    targetBatch: number;
  }) => Promise<void>;
}

export const OrderTicket: React.FC<OrderTicketProps> = ({
  currentBatchId,
  markPrice,
  availableEquity,
  isPlacingOrder,
  selectedPrice,
  onPlaceOrder,
}) => {
  const { connected } = useWallet();
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"limit" | "market">("limit");
  const [priceStr, setPriceStr] = useState<string>(
    selectedPrice ? selectedPrice.toFixed(2) : markPrice.toFixed(2)
  );
  const [qtySol, setQtySol] = useState<string>("1.0");
  const [sliderVal, setSliderVal] = useState<number>(25);
  const [targetBatchOffset, setTargetBatchOffset] = useState<number>(1); // 1 = next batch

  useEffect(() => {
    if (selectedPrice && selectedPrice > 0) {
      setPriceStr(selectedPrice.toFixed(2));
    }
  }, [selectedPrice]);

  const numPrice = orderType === "market" ? markPrice : parseFloat(priceStr) || markPrice;
  const numQty = parseFloat(qtySol) || 0;
  const orderValue = numPrice * numQty;
  const marginRequired = orderValue * 0.1; // 10% IMR

  // Calculate liquidation price estimate (at 10x leverage)
  const estLiqPrice =
    side === "BUY"
      ? (numPrice * 0.905).toFixed(2)
      : (numPrice * 1.095).toFixed(2);

  // Convert USD price difference to tick offset in bps (1 bp = 0.01%)
  const offsetBps = Math.round(((numPrice - markPrice) / markPrice) * 10_000);
  const clampedOffsetBps = Math.max(-50, Math.min(50, offsetBps));
  const lots = Math.max(1, Math.round(numQty * 1000));
  const targetBatch = currentBatchId + targetBatchOffset;

  const handleSliderMove = (val: number) => {
    setSliderVal(val);
    // Calculate max SOL based on available equity and 10x leverage
    const maxUsd = availableEquity * 10;
    const maxSol = maxUsd / (numPrice || markPrice || 1);
    const calculated = ((maxSol * val) / 100).toFixed(2);
    setQtySol(calculated);
  };

  const handleSetPrice = (p: number) => {
    setPriceStr(p.toFixed(2));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || isPlacingOrder || numQty <= 0) return;
    await onPlaceOrder({
      side,
      price: numPrice,
      lots,
      offsetBps: clampedOffsetBps,
      targetBatch,
    });
  };

  return (
    <div className="w-[280px] xl:w-[300px] flex flex-col min-h-0 bg-[#0e1217] select-none text-[12px] overflow-y-auto border-l bp-border">
      {/* 1. BUY / SELL SIDE TABS (Backpack exact match) */}
      <div className="p-3 pb-2 border-b bp-border">
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#12161c] rounded-md">
          <button
            type="button"
            onClick={() => setSide("BUY")}
            className={`py-1.5 rounded font-semibold text-[13px] transition-all shadow-sm ${
              side === "BUY"
                ? "bg-[#162720] text-[#0ecb81] border border-[#0ecb81]/30"
                : "text-[#848e9c] hover:text-white"
            }`}
          >
            Buy / Long
          </button>
          <button
            type="button"
            onClick={() => setSide("SELL")}
            className={`py-1.5 rounded font-semibold text-[13px] transition-all shadow-sm ${
              side === "SELL"
                ? "bg-[#2a1619] text-[#f6465d] border border-[#f6465d]/30"
                : "text-[#848e9c] hover:text-white"
            }`}
          >
            Sell / Short
          </button>
        </div>
      </div>

      {/* 2. ORDER TYPE (Limit / Market) */}
      <div className="px-3 pt-2 pb-1.5 flex items-center justify-between border-b bp-border-subtle text-[12px]">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOrderType("limit")}
            className={`pb-1 transition-colors ${
              orderType === "limit"
                ? "text-white font-semibold border-b border-white -mb-[1px]"
                : "text-[#848e9c] hover:text-white"
            }`}
          >
            Limit
          </button>
          <button
            type="button"
            onClick={() => setOrderType("market")}
            className={`pb-1 transition-colors ${
              orderType === "market"
                ? "text-white font-semibold border-b border-white -mb-[1px]"
                : "text-[#848e9c] hover:text-white"
            }`}
          >
            Market
          </button>
        </div>
        <span className="text-[10px] font-mono text-[#848e9c]">10x Cross</span>
      </div>

      {/* 3. INPUT FORM */}
      <form onSubmit={handleSubmit} className="p-3 space-y-3 flex-1 flex flex-col justify-between">
        <div className="space-y-3">
          {/* Available Equity */}
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#848e9c]">Available Equity</span>
            <span className="font-mono text-[#f0f3f6] font-semibold">
              ${availableEquity.toFixed(2)}
            </span>
          </div>

          {/* Target Batch Lookahead (Epoch FBA feature) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-[#848e9c]">
              <span>Target Batch</span>
              <span className="font-mono text-[#00f0ff] text-[10px]">FBA Lookahead</span>
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

          {/* Price Input (if Limit) */}
          {orderType === "limit" ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#848e9c]">Price</span>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => handleSetPrice(markPrice - 0.05)}
                    className="text-[#848e9c] hover:text-white"
                  >
                    Mid
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetPrice(markPrice)}
                    className="text-[#848e9c] hover:text-white"
                  >
                    BBO
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between bg-[#12161c] rounded-md border bp-border px-3 py-2 focus-within:border-[#848e9c] transition-colors">
                <input
                  type="number"
                  step="0.01"
                  value={priceStr}
                  onChange={(e) => setPriceStr(e.target.value)}
                  className="w-full bg-transparent text-white font-mono text-[14px] font-semibold focus:outline-none"
                />
                <div className="w-4 h-4 rounded-full bg-[#0ecb81] flex items-center justify-center text-black text-[10px] font-bold ml-1.5 shrink-0">
                  $
                </div>
              </div>
              <div className="flex justify-between text-[10px] font-mono text-[#848e9c] px-0.5">
                <span>Offset vs Mark:</span>
                <span className={clampedOffsetBps >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}>
                  {clampedOffsetBps > 0 ? `+${clampedOffsetBps}` : clampedOffsetBps} bps
                </span>
              </div>
            </div>
          ) : (
            <div className="p-2.5 rounded-md bg-[#12161c] border bp-border text-[11px] font-mono text-[#848e9c]">
              <span>Uniform Market Cross: Executes at whatever uniform price clears Batch #{targetBatch}.</span>
            </div>
          )}

          {/* Quantity Input */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#848e9c]">Quantity</span>
              <span className="font-mono text-[#848e9c] text-[10px]">{lots} Lots</span>
            </div>
            <div className="flex items-center justify-between bg-[#12161c] rounded-md border bp-border px-3 py-2 focus-within:border-[#848e9c] transition-colors">
              <input
                type="number"
                step="0.1"
                min="0.01"
                value={qtySol}
                onChange={(e) => setQtySol(e.target.value)}
                className="w-full bg-transparent text-white font-mono text-[14px] font-semibold focus:outline-none"
              />
              <span className="text-[11px] font-mono text-[#848e9c] ml-1.5">SOL</span>
            </div>
          </div>

          {/* Quick Percentage Slider */}
          <div className="pt-1 pb-1">
            <div className="relative flex items-center">
              <input
                type="range"
                min="0"
                max="100"
                step="25"
                value={sliderVal}
                onChange={(e) => handleSliderMove(parseInt(e.target.value))}
                className="w-full h-1 bg-[#181d24] border bp-border rounded-lg appearance-none cursor-pointer accent-white"
              />
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono text-[#848e9c] mt-1.5 px-0.5">
              {[0, 25, 50, 75, 100].map((val) => (
                <span
                  key={val}
                  onClick={() => handleSliderMove(val)}
                  className="cursor-pointer hover:text-white"
                >
                  {val === 0 ? "0" : `${val}%`}
                </span>
              ))}
            </div>
          </div>

          {/* Order Value */}
          <div className="space-y-1">
            <span className="text-[#848e9c] text-[11px]">Order Value</span>
            <div className="flex items-center justify-between bg-[#12161c] rounded-md border bp-border px-3 py-2">
              <span className="font-mono text-[14px] text-white font-semibold">
                ${orderValue.toFixed(2)}
              </span>
              <div className="w-4 h-4 rounded-full bg-[#0ecb81] flex items-center justify-center text-black text-[10px] font-bold ml-1.5 shrink-0">
                $
              </div>
            </div>
          </div>

          {/* Financial Risk Details */}
          <div className="space-y-1 pt-1 text-[11px] font-mono">
            <div className="flex items-center justify-between text-[#848e9c]">
              <span>Margin Required</span>
              <span className="text-[#f0f3f6]">${marginRequired.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-[#848e9c]">
              <span>Est. Liquidation Price</span>
              <span className="text-[#f0f3f6]">${estLiqPrice}</span>
            </div>
          </div>
        </div>

        {/* CTA Buttons */}
        <div className="space-y-2 pt-2">
          {connected ? (
            <button
              type="submit"
              disabled={isPlacingOrder || numQty <= 0 || marginRequired > availableEquity}
              className={`w-full py-2.5 rounded-md font-bold text-[13px] tracking-tight transition-all shadow-sm flex items-center justify-center gap-2 ${
                marginRequired > availableEquity
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
              ) : marginRequired > availableEquity ? (
                <span>Insufficient Equity</span>
              ) : (
                <span>
                  {side === "BUY" ? "Buy / Long SOL" : "Sell / Short SOL"} · Batch #{targetBatch}
                </span>
              )}
            </button>
          ) : (
            <div className="w-full py-2.5 rounded-md bg-[#161b22] text-[#848e9c] text-center font-medium border bp-border">
              Connect wallet to trade
            </div>
          )}

          {/* Order Flags Checkboxes */}
          <div className="grid grid-cols-2 gap-2 text-[10px] text-[#848e9c] pt-1">
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-white">
              <input type="checkbox" className="rounded bg-[#12161c] border bp-border text-white focus:ring-0 w-3 h-3" />
              <span>Post Only</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-white">
              <input type="checkbox" className="rounded bg-[#12161c] border bp-border text-white focus:ring-0 w-3 h-3" />
              <span>IOC</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-white">
              <input type="checkbox" className="rounded bg-[#12161c] border bp-border text-white focus:ring-0 w-3 h-3" />
              <span>Reduce Only</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-white">
              <input type="checkbox" className="rounded bg-[#12161c] border bp-border text-white focus:ring-0 w-3 h-3" />
              <span>TP / SL</span>
            </label>
          </div>
        </div>
      </form>
    </div>
  );
};
