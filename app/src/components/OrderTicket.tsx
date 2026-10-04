"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Loader2, AlertCircle, ShieldAlert, Clock, ArrowRight } from "lucide-react";
import {
  clear,
  clearingPrice,
  priceToOffset,
  computeLiquidationPrice,
} from "../lib/clearingEngine";

interface OrderTicketProps {
  currentBatchId: number;
  oraclePrice: number;
  availableEquity: number;
  isPlacingOrder: boolean;
  selectedPrice?: number;
  selectedOffsetBps?: number;
  bidQty?: number[];
  askQty?: number[];
  userPositionLots?: number;
  onPlaceOrder: (args: {
    side: "BUY" | "SELL";
    price: number;
    lots: number;
    offsetBps: number;
    lifetimeBatches: number;
    reduceOnly: boolean;
  }) => Promise<void>;
}

export const OrderTicket: React.FC<OrderTicketProps> = ({
  currentBatchId,
  oraclePrice,
  availableEquity,
  isPlacingOrder,
  selectedPrice,
  selectedOffsetBps,
  bidQty = [],
  askQty = [],
  userPositionLots = 0,
  onPlaceOrder,
}) => {
  const { connected } = useWallet();
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"market" | "limit">("limit");
  const [priceStr, setPriceStr] = useState<string>(
    selectedPrice ? selectedPrice.toFixed(2) : oraclePrice.toFixed(2)
  );
  const [qtySol, setQtySol] = useState<string>("1.0");
  const [sliderVal, setSliderVal] = useState<number>(25);
  const [lifetimeBatches, setLifetimeBatches] = useState<number>(1);
  const [reduceOnly, setReduceOnly] = useState<boolean>(false);

  // Sync selected price from ladder
  useEffect(() => {
    if (selectedPrice && selectedPrice > 0) {
      setPriceStr(selectedPrice.toFixed(2));
    }
  }, [selectedPrice]);

  const numPrice = orderType === "market" ? oraclePrice : parseFloat(priceStr) || oraclePrice;
  const numQty = parseFloat(qtySol) || 0;
  const lots = Math.max(1, Math.round(numQty * 1000));
  const notionalUsd = numPrice * numQty;

  // 09 §4.2: Price-to-offset conversion
  const offsetInfo = useMemo(() => {
    if (orderType === "market") {
      // Market order sent as band edge (09 §4.1)
      const edge = side === "BUY" ? 50 : -50;
      const effectiveP = oraclePrice * (1 + edge / 10_000);
      return { offsetBps: edge, effectivePriceUsd: effectiveP, clamped: false };
    }
    return priceToOffset(numPrice, oraclePrice, 1, 50);
  }, [numPrice, oraclePrice, orderType, side]);

  // Client-side indicative clearing preview (09 §4.1 & T-29)
  const indicativePreview = useMemo(() => {
    if (bidQty.length === 0 || askQty.length === 0) return null;
    const res = clear(bidQty, askQty);
    if (!res || res.matched === 0) {
      return { willFill: false, reason: "No crossing trade in current batch" };
    }
    const orderTick = 50 + offsetInfo.offsetBps;
    if (side === "BUY") {
      if (orderTick > res.bid.tick) {
        return { willFill: true, fillLots: lots, fillPct: 100, price: res.tick };
      } else if (orderTick === res.bid.tick) {
        const pct = Math.round((res.bid.alloc / res.bid.total) * 100);
        const fLots = Math.floor((lots * res.bid.alloc) / res.bid.total);
        return { willFill: true, fillLots: fLots, fillPct: pct, price: res.tick };
      }
      return { willFill: false, reason: "Limit below marginal clearing bid" };
    } else {
      if (orderTick < res.ask.tick) {
        return { willFill: true, fillLots: lots, fillPct: 100, price: res.tick };
      } else if (orderTick === res.ask.tick) {
        const pct = Math.round((res.ask.alloc / res.ask.total) * 100);
        const fLots = Math.floor((lots * res.ask.alloc) / res.ask.total);
        return { willFill: true, fillLots: fLots, fillPct: pct, price: res.tick };
      }
      return { willFill: false, reason: "Limit above marginal clearing ask" };
    }
  }, [bidQty, askQty, offsetInfo, side, lots]);

  // Margin calculation (spec §9 with slip reserve)
  const marginRequired = useMemo(() => {
    const imr = notionalUsd * 0.1; // 10% IMR
    const slipReserve = notionalUsd * 0.005; // 50 bps band reserve
    return imr + slipReserve;
  }, [notionalUsd]);

  const estimatedFee = notionalUsd * 0.0005; // 5 bps

  // Estimated liquidation price (09 §7.5 formula)
  const estimatedLiqPrice = useMemo(() => {
    const resultingLots = side === "BUY" ? userPositionLots + lots : userPositionLots - lots;
    const pLiqMicro = computeLiquidationPrice(
      Math.round(availableEquity * 1_000_000),
      0,
      resultingLots,
      0,
      500 // 5% MMR
    );
    return pLiqMicro > 0 ? (pLiqMicro / 1_000_000).toFixed(2) : "-";
  }, [availableEquity, userPositionLots, lots, side]);

  // Validations per 09 §4.2
  const validationError = useMemo(() => {
    if (orderType === "limit" && offsetInfo.clamped) {
      return "Limit orders must be within ±0.50% of the oracle. Use Market instead.";
    }
    if (notionalUsd < 10) {
      return "Order notional below minimum ($10.00).";
    }
    if (marginRequired > availableEquity && availableEquity > 0) {
      const shortfall = (marginRequired - availableEquity).toFixed(2);
      return `Insufficient margin (shortfall $${shortfall}).`;
    }
    if (reduceOnly) {
      if (side === "BUY" && userPositionLots >= 0) {
        return "Reduce-only Buy requires an open short position.";
      }
      if (side === "SELL" && userPositionLots <= 0) {
        return "Reduce-only Sell requires an open long position.";
      }
      if (lots > Math.abs(userPositionLots)) {
        return `Reduce-only size exceeds position (${Math.abs(userPositionLots * 0.001).toFixed(2)} SOL).`;
      }
    }
    return null;
  }, [orderType, offsetInfo, notionalUsd, marginRequired, availableEquity, reduceOnly, side, userPositionLots, lots]);

  const handleSliderMove = (val: number) => {
    setSliderVal(val);
    const maxUsd = Math.max(availableEquity * 10, 100);
    const maxSol = maxUsd / (numPrice || oraclePrice || 1);
    const calculated = Math.max(0.1, (maxSol * val) / 100).toFixed(2);
    setQtySol(calculated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validationError || isPlacingOrder || numQty <= 0) return;
    await onPlaceOrder({
      side,
      price: numPrice,
      lots,
      offsetBps: offsetInfo.offsetBps,
      lifetimeBatches,
      reduceOnly,
    });
  };

  return (
    <div className="w-[300px] xl:w-[320px] flex flex-col min-h-0 bg-[#0e1217] select-none text-[12px] overflow-y-auto border-l bp-border">
      {/* 1. Side Selector (09 §4.1: Buy / Sell) */}
      <div className="p-3 pb-2 border-b bp-border">
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#12161c] rounded-md">
          <button
            type="button"
            onClick={() => setSide("BUY")}
            className={`py-2 rounded font-semibold text-[13px] transition-all flex items-center justify-center gap-1.5 ${
              side === "BUY"
                ? "bg-[#162720] text-[#0ecb81] border border-[#0ecb81]/40 shadow-sm"
                : "text-[#848e9c] hover:text-white"
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[#0ecb81]" />
            <span>Buy / Long</span>
          </button>
          <button
            type="button"
            onClick={() => setSide("SELL")}
            className={`py-2 rounded font-semibold text-[13px] transition-all flex items-center justify-center gap-1.5 ${
              side === "SELL"
                ? "bg-[#29171a] text-[#f6465d] border border-[#f6465d]/40 shadow-sm"
                : "text-[#848e9c] hover:text-white"
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[#f6465d]" />
            <span>Sell / Short</span>
          </button>
        </div>
      </div>

      {/* 2. Order Form */}
      <form onSubmit={handleSubmit} className="p-3 space-y-3.5 flex-1 flex flex-col justify-between">
        <div className="space-y-3">
          {/* Order Type Tabs */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOrderType("limit")}
                className={`text-[12px] pb-1 font-semibold transition-colors ${
                  orderType === "limit"
                    ? "text-white border-b-2 border-[#00f0ff]"
                    : "text-[#848e9c] hover:text-white"
                }`}
              >
                Limit
              </button>
              <button
                type="button"
                onClick={() => setOrderType("market")}
                className={`text-[12px] pb-1 font-semibold transition-colors ${
                  orderType === "market"
                    ? "text-white border-b-2 border-[#00f0ff]"
                    : "text-[#848e9c] hover:text-white"
                }`}
              >
                Market
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="flex items-center gap-1 cursor-pointer text-[#848e9c] hover:text-white text-[11px]">
                <input
                  type="checkbox"
                  checked={reduceOnly}
                  onChange={(e) => setReduceOnly(e.target.checked)}
                  className="rounded bg-[#12161c] border-white/20 text-[#00f0ff] focus:ring-0 w-3 h-3"
                />
                <span>Reduce-only</span>
              </label>
            </div>
          </div>

          {/* Limit Price Input & Pegged Offset Display (09 §4.1) */}
          {orderType === "limit" ? (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-[#848e9c]">
                <span>Price (USDC)</span>
                <span className="text-white tabular-nums">Oracle: ${oraclePrice.toFixed(2)}</span>
              </div>
              <div className="relative flex items-center">
                <input
                  type="number"
                  step="0.01"
                  value={priceStr}
                  onChange={(e) => setPriceStr(e.target.value)}
                  className="w-full bg-[#12161c] border bp-border focus:border-[#00f0ff] rounded px-3 py-2 text-white font-mono text-[13px] outline-none"
                  placeholder="0.00"
                />
                <span className="absolute right-3 text-[#848e9c] font-mono text-[11px]">USDC</span>
              </div>
              {/* Pegged offset explainer (09 §2.2 & §4.1) */}
              <div className="p-1.5 rounded bg-[#181d24] border bp-border text-[10px] flex items-center justify-between text-[#848e9c]">
                <span>
                  Pegged:{" "}
                  <strong className="text-white font-mono">
                    {offsetInfo.offsetBps >= 0 ? `+${offsetInfo.offsetBps}` : offsetInfo.offsetBps} bps
                  </strong>
                </span>
                <span className="text-[9px] text-[#00f0ff]">Moves with oracle</span>
              </div>
            </div>
          ) : (
            /* Market Order Slippage Label (09 §4.1) */
            <div className="p-2.5 rounded bg-[#12161c] border bp-border text-[11px] space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-white font-semibold">Market Order</span>
                <span className="text-[#0ecb81] font-mono">Max 0.50% slip</span>
              </div>
              <p className="text-[10px] text-[#848e9c]">
                Crosses batch at band-edge tick ({side === "BUY" ? "+50 bps" : "-50 bps"}) to match all available volume at uniform price.
              </p>
            </div>
          )}

          {/* Size Input in SOL */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-[#848e9c]">
              <span>Size (SOL)</span>
              <span className="text-white tabular-nums font-mono">{lots} lots</span>
            </div>
            <div className="relative flex items-center">
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={qtySol}
                onChange={(e) => setQtySol(e.target.value)}
                className="w-full bg-[#12161c] border bp-border focus:border-[#00f0ff] rounded px-3 py-2 text-white font-mono text-[13px] outline-none"
                placeholder="1.00"
              />
              <span className="absolute right-3 text-[#848e9c] font-mono text-[11px]">SOL</span>
            </div>
          </div>

          {/* Slider */}
          <div className="space-y-1 pt-1">
            <input
              type="range"
              min="1"
              max="100"
              value={sliderVal}
              onChange={(e) => handleSliderMove(Number(e.target.value))}
              aria-label="Order size percentage slider"
              className="w-full h-1 bg-[#181d24] rounded-lg appearance-none cursor-pointer accent-[#00f0ff]"
            />
            <div className="flex justify-between text-[9px] font-mono text-[#848e9c]">
              <span>25%</span>
              <span>50%</span>
              <span>75%</span>
              <span>100%</span>
            </div>
          </div>

          {/* 09 §4.1: Lifetime Selector (1 to 4 batches) */}
          <div className="space-y-1 pt-1">
            <div className="flex justify-between text-[11px] text-[#848e9c]">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-[#00f0ff]" />
                Order Lifetime
              </span>
              <span className="text-[#00f0ff] font-mono text-[10px]">
                {lifetimeBatches === 1 ? "1 batch (~0.8s)" : `${lifetimeBatches} batches (~${(lifetimeBatches * 0.8).toFixed(1)}s)`}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={`life-${n}`}
                  type="button"
                  onClick={() => setLifetimeBatches(n)}
                  className={`py-1 rounded text-[11px] font-mono font-medium border transition-colors ${
                    lifetimeBatches === n
                      ? "bg-[#00f0ff]/15 border-[#00f0ff] text-[#00f0ff]"
                      : "bg-[#12161c] border-white/5 text-[#848e9c] hover:text-white"
                  }`}
                >
                  {n} {n === 1 ? "batch" : "batches"}
                </button>
              ))}
            </div>

            {/* Combined exposure warning for multi-batch (09 §4.3) */}
            {lifetimeBatches > 1 && (
              <div className="p-2 rounded bg-[#eab308]/10 border border-[#eab308]/30 text-[10px] text-[#eab308] flex items-start gap-1.5 mt-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Multi-batch warning: Places {lifetimeBatches} independent orders. Combined worst-case exposure:{" "}
                  <strong>{(numQty * lifetimeBatches).toFixed(2)} SOL</strong> ($
                  {(notionalUsd * lifetimeBatches).toFixed(2)}) if all fill.
                </span>
              </div>
            )}
          </div>

          {/* Validation Alert (09 §4.2) */}
          {validationError && (
            <div className="p-2 rounded bg-[#f6465d]/10 border border-[#f6465d]/30 text-[11px] text-[#f6465d] flex items-start gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{validationError}</span>
            </div>
          )}

          {/* 09 §4.1: Order Preview Card */}
          <div className="p-2.5 rounded bg-[#12161c] border bp-border space-y-1 text-[11px]">
            <div className="flex justify-between text-[#848e9c]">
              <span>Estimated Notional</span>
              <span className="text-white font-mono tabular-nums">${notionalUsd.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[#848e9c]">
              <span>Estimated Fee (5 bps)</span>
              <span className="text-white font-mono tabular-nums">${estimatedFee.toFixed(3)}</span>
            </div>
            <div className="flex justify-between text-[#848e9c]">
              <span>Req. Margin + Slip</span>
              <span className="text-white font-mono tabular-nums">${marginRequired.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[#848e9c]">
              <span>Est. Liq Price</span>
              <span className="text-[#eab308] font-mono tabular-nums font-semibold">
                ${estimatedLiqPrice}
              </span>
            </div>

            {/* Indicative fill preview (09 §4.1) */}
            <div className="pt-1.5 mt-1 border-t bp-border text-[10px] flex items-center justify-between">
              <span className="text-[#848e9c]">Indicative Fill (Batch #{currentBatchId + 1})</span>
              <span className="text-[#00f0ff] font-mono font-medium">
                {indicativePreview?.willFill
                  ? `${indicativePreview.fillPct}% (${((indicativePreview.fillLots ?? 0) * 0.001).toFixed(2)} SOL)`
                  : "0% (queued)"}
              </span>
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={!connected || isPlacingOrder || Boolean(validationError)}
            className={`w-full py-2.5 rounded font-bold text-[13px] transition-all flex items-center justify-center gap-2 shadow-md ${
              !connected
                ? "bg-[#181d24] text-[#848e9c] cursor-not-allowed border bp-border"
                : validationError
                ? "bg-[#181d24] text-[#848e9c] cursor-not-allowed border bp-border"
                : side === "BUY"
                ? "bg-[#00c087] hover:bg-[#00a372] text-[#0b0e11]"
                : "bg-[#f23645] hover:bg-[#d92d3b] text-white"
            }`}
          >
            {isPlacingOrder ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Submitting to Batch...</span>
              </>
            ) : !connected ? (
              <span>Connect Wallet to Trade</span>
            ) : (
              <span>
                {side === "BUY" ? "Buy / Long" : "Sell / Short"} {numQty.toFixed(2)} SOL
              </span>
            )}
          </button>
          <p className="text-center text-[10px] text-[#848e9c] mt-1.5">
            Executes at the next batch close (about 0.8 s)
          </p>
        </div>
      </form>
    </div>
  );
};
