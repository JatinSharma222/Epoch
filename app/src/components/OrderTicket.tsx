"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Loader2, AlertCircle, ShieldAlert, Clock } from "lucide-react";
import {
  clear,
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
  onOpenDeposit?: () => void;
}

export const OrderTicket: React.FC<OrderTicketProps> = ({
  currentBatchId,
  oraclePrice,
  availableEquity,
  isPlacingOrder,
  selectedPrice,
  bidQty = [],
  askQty = [],
  userPositionLots = 0,
  onPlaceOrder,
  onOpenDeposit,
}) => {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();

  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [userEditedPrice, setUserEditedPrice] = useState<boolean>(false);

  // 09 §3.5 rule 10: limit price defaults to current oracle price (rounded to price tick) with no error on load
  const [priceStr, setPriceStr] = useState<string>(
    selectedPrice ? selectedPrice.toFixed(2) : oraclePrice ? oraclePrice.toFixed(2) : "119.60"
  );
  const [qtySol, setQtySol] = useState<string>("1.00");
  const [sliderVal, setSliderVal] = useState<number>(25);
  const [lifetimeBatches, setLifetimeBatches] = useState<number>(1);
  const [reduceOnly, setReduceOnly] = useState<boolean>(false);

  // Automatically track oracle price if user hasn't typed a custom limit price
  useEffect(() => {
    if (!userEditedPrice && oraclePrice > 0) {
      setPriceStr(oraclePrice.toFixed(2));
    }
  }, [oraclePrice, userEditedPrice]);

  // Sync selected price when clicked from ladder
  useEffect(() => {
    if (selectedPrice && selectedPrice > 0) {
      setPriceStr(selectedPrice.toFixed(2));
      setUserEditedPrice(true);
    }
  }, [selectedPrice]);

  const numPrice = orderType === "market" ? oraclePrice : parseFloat(priceStr) || oraclePrice;
  const numQty = parseFloat(qtySol) || 0;
  const lots = Math.max(1, Math.round(numQty * 1000));
  const notionalUsd = numPrice * numQty;

  // 09 §4.2 & D.1: Price-to-offset conversion
  const offsetInfo = useMemo(() => {
    if (orderType === "market") {
      const edge = side === "BUY" ? 50 : -50;
      const effectiveP = oraclePrice * (1 + edge / 10_000);
      return { offsetBps: edge, rawOffsetBps: edge, effectivePriceUsd: effectiveP, clamped: false };
    }
    return priceToOffset(numPrice, oraclePrice, 1, 50);
  }, [numPrice, oraclePrice, orderType, side]);

  // Client-side indicative clearing preview (09 §4.1 & Round 9 Track A)
  const indicativePreview = useMemo(() => {
    if (orderType === "market") {
      return {
        willFill: true,
        fillLots: lots,
        fillPct: 100,
        price: oraclePrice,
        reason: "fills against demo liquidity at about oracle ±15 bps",
        isCrossing: true,
      };
    }

    const orderTick = Math.max(0, Math.min(100, 50 + offsetInfo.offsetBps));
    let hasCrossing = false;

    // Check if the aggregated on-chain book (including vault orders) crosses
    if (bidQty.length > 0 && askQty.length > 0) {
      if (side === "BUY") {
        for (let t = 0; t <= orderTick; t++) {
          if (askQty[t] > 0) {
            hasCrossing = true;
            break;
          }
        }
      } else {
        for (let t = orderTick; t < 101; t++) {
          if (bidQty[t] > 0) {
            hasCrossing = true;
            break;
          }
        }
      }
    }

    if (!hasCrossing) {
      return {
        willFill: false,
        reason: "No crossing liquidity at this price, your order will expire unfilled",
        isCrossing: false,
      };
    }

    const res = clear(bidQty, askQty);
    if (!res || res.matched === 0) {
      return {
        willFill: false,
        reason: "No crossing liquidity at this price, your order will expire unfilled",
        isCrossing: false,
      };
    }

    if (side === "BUY") {
      if (orderTick >= res.ask.tick) {
        if (orderTick > res.bid.tick) {
          return { willFill: true, fillLots: lots, fillPct: 100, price: res.tick, isCrossing: true };
        } else if (orderTick === res.bid.tick) {
          const pct = Math.round((res.bid.alloc / res.bid.total) * 100);
          const fLots = Math.floor((lots * res.bid.alloc) / res.bid.total);
          return { willFill: true, fillLots: fLots, fillPct: pct, price: res.tick, isCrossing: true };
        }
      }
      return {
        willFill: false,
        reason: "No crossing liquidity at this price, your order will expire unfilled",
        isCrossing: false,
      };
    } else {
      if (orderTick <= res.bid.tick) {
        if (orderTick < res.ask.tick) {
          return { willFill: true, fillLots: lots, fillPct: 100, price: res.tick, isCrossing: true };
        } else if (orderTick === res.ask.tick) {
          const pct = Math.round((res.ask.alloc / res.ask.total) * 100);
          const fLots = Math.floor((lots * res.ask.alloc) / res.ask.total);
          return { willFill: true, fillLots: fLots, fillPct: pct, price: res.tick, isCrossing: true };
        }
      }
      return {
        willFill: false,
        reason: "No crossing liquidity at this price, your order will expire unfilled",
        isCrossing: false,
      };
    }
  }, [bidQty, askQty, offsetInfo, side, lots, orderType, oraclePrice]);

  // Margin calculation (spec §9 with slip reserve)
  const marginRequired = useMemo(() => {
    const imr = notionalUsd * 0.1; // 10% IMR
    const slipReserve = notionalUsd * 0.005; // 50 bps band reserve
    return imr + slipReserve;
  }, [notionalUsd]);

  const estimatedFee = notionalUsd * 0.0005; // 5 bps

  // Estimated liquidation price (09 §7.5 formula)
  const estimatedLiqPrice = useMemo(() => {
    if (userPositionLots === 0) return "—";
    const resultingLots = side === "BUY" ? userPositionLots + lots : userPositionLots - lots;
    const pLiqMicro = computeLiquidationPrice(
      Math.round(availableEquity * 1_000_000),
      0,
      resultingLots,
      0,
      500 // 5% MMR
    );
    return pLiqMicro > 0 ? (pLiqMicro / 1_000_000).toFixed(2) : "—";
  }, [availableEquity, userPositionLots, lots, side]);

  // Validations per 09 §4.2 & §3.5 rule 10: Validation errors appear once, inline under the field
  const validationError = useMemo(() => {
    if (orderType === "limit" && offsetInfo.clamped) {
      const sign = offsetInfo.rawOffsetBps > 0 ? "+" : "";
      return `Exceeds ±50 bps collar (${sign}${offsetInfo.rawOffsetBps} bps). Limit orders must be within ±0.50% of oracle.`;
    }
    if (numQty <= 0) {
      return "Size must be greater than 0.";
    }
    if (notionalUsd < 10) {
      return "Order notional below minimum ($10.00).";
    }
    if (connected && availableEquity > 0 && marginRequired > availableEquity) {
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
  }, [orderType, offsetInfo, numQty, notionalUsd, connected, availableEquity, marginRequired, reduceOnly, side, userPositionLots, lots]);

  const handleSliderMove = (val: number) => {
    setSliderVal(val);
    const maxUsd = Math.max(availableEquity * 10, 100);
    const maxSol = maxUsd / (numPrice || oraclePrice || 1);
    const calculated = Math.max(0.1, (maxSol * val) / 100).toFixed(2);
    setQtySol(calculated);
  };

  const handleFormAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) {
      setVisible(true);
      return;
    }
    if (availableEquity <= 0) {
      if (onOpenDeposit) onOpenDeposit();
      return;
    }
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

  // 09 §3.5 rule 10: Button states
  const buttonState = useMemo(() => {
    if (!connected) {
      return { text: "Connect wallet", disabled: false, type: "connect" };
    }
    if (availableEquity <= 0) {
      return { text: "Deposit to trade", disabled: false, type: "deposit" };
    }
    if (marginRequired > availableEquity) {
      return { text: "Insufficient margin", disabled: true, type: "disabled" };
    }
    if (validationError) {
      return { text: "Invalid order", disabled: true, type: "disabled" };
    }
    if (isPlacingOrder) {
      return { text: "Submitting...", disabled: true, type: "loading" };
    }
    return {
      text: `${side === "BUY" ? "Buy / Long" : "Sell / Short"} ${numQty.toFixed(2)} SOL`,
      disabled: false,
      type: "ready",
    };
  }, [connected, availableEquity, marginRequired, validationError, isPlacingOrder, side, numQty]);

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
      <form onSubmit={handleFormAction} className="p-3 space-y-3.5 flex-1 flex flex-col justify-between">
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
                  className="rounded bg-[#12161c] border-white/20 text-[#00f0ff] focus:ring-0 w-3 h-3 cursor-pointer"
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
                  onChange={(e) => {
                    setUserEditedPrice(true);
                    setPriceStr(e.target.value);
                  }}
                  className={`w-full bg-[#12161c] border rounded px-3 py-2 text-white font-mono text-[13px] outline-none transition-colors ${
                    offsetInfo.clamped
                      ? "border-[#F6465D] focus:border-[#F6465D]"
                      : "bp-border focus:border-[#00f0ff]"
                  }`}
                  placeholder="0.00"
                />
                <span className="absolute right-3 text-[#848e9c] font-mono text-[11px]">USDC</span>
              </div>
              {/* Pegged offset explainer (09 §2.2, §4.1, and D.1) */}
              <div
                className={`p-1.5 rounded border text-[10px] flex items-center justify-between transition-colors ${
                  offsetInfo.clamped
                    ? "bg-[#29171A] border-[#F6465D]/50 text-[#F6465D]"
                    : "bg-[#181d24] bp-border text-[#848e9c]"
                }`}
              >
                <span>
                  Pegged:{" "}
                  <strong className={`font-mono ${offsetInfo.clamped ? "text-[#F6465D]" : "text-white"}`}>
                    {offsetInfo.rawOffsetBps >= 0 ? `+${offsetInfo.rawOffsetBps}` : offsetInfo.rawOffsetBps} bps
                  </strong>
                  {offsetInfo.clamped && (
                    <span className="ml-1 text-[9px] text-[#F6465D] font-semibold">
                      (Exceeds ±50 bps collar)
                    </span>
                  )}
                </span>
                <span className={`text-[9px] font-semibold ${offsetInfo.clamped ? "text-[#F6465D]" : "text-[#00f0ff]"}`}>
                  {offsetInfo.clamped ? "Outside Collar" : "Moves with oracle"}
                </span>
              </div>
              {/* Crossing Warning & One-Click Fill Now (Round 9 Track A) */}
              {indicativePreview && !indicativePreview.isCrossing && (
                <div className="p-2 rounded bg-[#eab308]/10 border border-[#eab308]/30 text-[11px] text-[#eab308] flex items-center justify-between gap-2">
                  <div className="flex items-start gap-1.5 flex-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#eab308]" />
                    <span>No crossing liquidity at this price, your order will expire unfilled</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOrderType("market")}
                    className="px-2 py-1 rounded bg-[#00f0ff] hover:bg-[#00d8e6] text-black font-semibold text-[10px] shrink-0 cursor-pointer transition-colors"
                  >
                    Fill now
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Market Order Slippage Label (09 §4.1 & Round 9 Track A) */
            <div className="p-2.5 rounded bg-[#12161c] border bp-border text-[11px] space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-white font-semibold">Market Order</span>
                <span className="text-[#0ecb81] font-mono text-[10px]">fills against demo liquidity at about oracle ±15 bps</span>
              </div>
              <p className="text-[10px] text-[#848e9c]">
                Fills against demo liquidity at about oracle ±15 bps at uniform batch clearing price.
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
                {lifetimeBatches === 1 ? "1 batch (~0.48s)" : `${lifetimeBatches} batches (~${(lifetimeBatches * 0.48).toFixed(2)}s)`}
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

          {/* Validation Alert (09 §3.5 rule 10: Validation errors appear once, inline) */}
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

            {/* 09 §3.5 rule 10: No "$-" for liquidation price; show "—" with tooltip when no position */}
            <div className="flex justify-between text-[#848e9c]">
              <span>Est. Liq Price</span>
              {userPositionLots === 0 ? (
                <span
                  className="text-[#848e9c] font-mono tabular-nums cursor-help"
                  title="No open position. Liquidation price is established after a position is filled."
                >
                  —
                </span>
              ) : (
                <span className="text-[#eab308] font-mono tabular-nums font-semibold">
                  {estimatedLiqPrice !== "—" ? `$${estimatedLiqPrice}` : "—"}
                </span>
              )}
            </div>

            {/* Indicative fill preview (09 §4.1 & Round 9 Track A) */}
            <div className="pt-1.5 mt-1 border-t bp-border text-[10px] flex items-center justify-between">
              <span className="text-[#848e9c]">Indicative Fill (Batch #{currentBatchId + 1})</span>
              <div className="flex items-center gap-1.5">
                <span className={`font-mono font-medium ${indicativePreview?.isCrossing ? "text-[#00f0ff]" : "text-[#eab308]"}`}>
                  {indicativePreview?.willFill
                    ? `${indicativePreview.fillPct}% (${((indicativePreview.fillLots ?? 0) * 0.001).toFixed(2)} SOL)`
                    : "0% (unfilled)"}
                </span>
                {!indicativePreview?.isCrossing && orderType === "limit" && (
                  <button
                    type="button"
                    onClick={() => setOrderType("market")}
                    className="px-1.5 py-0.5 rounded bg-[#00f0ff] text-black font-semibold text-[9px] hover:bg-[#00d8e6] transition-colors"
                  >
                    Fill now
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 09 §3.5 rule 10: Button states: "Connect wallet", "Deposit to trade", "Insufficient margin" (disabled with reason), "Buy / Long 1.00 SOL" */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={buttonState.disabled}
            className={`w-full py-2.5 rounded font-bold text-[13px] transition-all flex items-center justify-center gap-2 shadow-md ${
              buttonState.type === "connect"
                ? "bg-[#00f0ff] hover:bg-[#00d8e6] text-black cursor-pointer active:scale-95"
                : buttonState.type === "deposit"
                ? "bg-[#eab308] hover:bg-[#d99b04] text-black cursor-pointer active:scale-95"
                : buttonState.disabled
                ? "bg-[#181d24] text-[#848e9c] cursor-not-allowed border bp-border"
                : side === "BUY"
                ? "bg-[#00c087] hover:bg-[#00a372] text-[#0b0e11] active:scale-95 cursor-pointer"
                : "bg-[#f23645] hover:bg-[#d92d3b] text-white active:scale-95 cursor-pointer"
            }`}
          >
            {buttonState.type === "loading" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{buttonState.text}</span>
              </>
            ) : (
              <span>{buttonState.text}</span>
            )}
          </button>
          <p className="text-center text-[10px] text-[#848e9c] mt-1.5">
            Executes at the next batch close (about 0.48 s)
          </p>
        </div>
      </form>
    </div>
  );
};
