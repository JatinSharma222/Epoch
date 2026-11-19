"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { AlertCircle, ShieldAlert, Clock, HelpCircle, X } from "lucide-react";
import {
  clear,
  clearingPrice,
  priceToOffset,
  computeLiquidationPrice,
} from "../lib/clearingEngine";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Tooltip } from "./ui/Tooltip";
import { Badge } from "./ui/Badge";

export interface OrderTicketProps {
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
  orderError?: string | null;
  onClearOrderError?: () => void;
  initialSide?: "BUY" | "SELL";
  isMobileSheet?: boolean;
  onCloseMobile?: () => void;
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
  onOpenDeposit,
  orderError,
  onClearOrderError,
  initialSide = "BUY",
  isMobileSheet = false,
  onCloseMobile,
}) => {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();

  const [side, setSide] = useState<"BUY" | "SELL">(initialSide);

  useEffect(() => {
    if (initialSide) {
      setSide(initialSide);
    }
  }, [initialSide]);
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [userEditedPrice, setUserEditedPrice] = useState<boolean>(false);

  // Limit price defaults to current oracle price with 2 decimal places
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

  // Sync selected price when clicked from book or chart
  useEffect(() => {
    if (selectedPrice && selectedPrice > 0) {
      setPriceStr(selectedPrice.toFixed(2));
      setUserEditedPrice(true);
    }
  }, [selectedPrice]);

  const numPrice = orderType === "market" ? oraclePrice : parseFloat(priceStr) || oraclePrice;
  const numQty = parseFloat(qtySol) || 0;
  // Guardrail G-05: 1 lot = 0.001 SOL
  const lots = Math.max(1, Math.round(numQty * 1000));
  const notionalUsd = numPrice * numQty;

  // Price-to-offset conversion
  const offsetInfo = useMemo(() => {
    if (orderType === "market") {
      const edge = side === "BUY" ? 50 : -50;
      const effectiveP = oraclePrice * (1 + edge / 10_000);
      return { offsetBps: edge, rawOffsetBps: edge, effectivePriceUsd: effectiveP, clamped: false };
    }
    return priceToOffset(numPrice, oraclePrice, 1, 50);
  }, [numPrice, oraclePrice, orderType, side]);

  // Client-side indicative clearing preview
  const indicativePreview = useMemo(() => {
    const simBids = [...(bidQty.length === 101 ? bidQty : new Array(101).fill(0))];
    const simAsks = [...(askQty.length === 101 ? askQty : new Array(101).fill(0))];

    // Seed default Backstop Vault liquidity ladder if the target side has no quotes
    const hasAsks = simAsks.some((q) => q > 0);
    if (!hasAsks) {
      simAsks[50 + 12] = 500;
      simAsks[50 + 18] = 1000;
      simAsks[50 + 25] = 2000;
    }
    const hasBids = simBids.some((q) => q > 0);
    if (!hasBids) {
      simBids[50 - 12] = 500;
      simBids[50 - 18] = 1000;
      simBids[50 - 25] = 2000;
    }

    const orderTick =
      orderType === "market"
        ? side === "BUY"
          ? 100
          : 0
        : Math.max(0, Math.min(100, 50 + offsetInfo.offsetBps));

    // Insert user's prospective order into simulated book
    if (side === "BUY") {
      simBids[orderTick] = (simBids[orderTick] || 0) + lots;
    } else {
      simAsks[orderTick] = (simAsks[orderTick] || 0) + lots;
    }

    const res = clear(simBids, simAsks);

    if (!res || res.matched === 0) {
      return {
        willFill: false,
        fillLots: 0,
        fillPct: 0,
        price: oraclePrice,
        offsetBps: 0,
        indicativeText: "No crossing liquidity",
        reason: "No crossing liquidity at this price, order will expire unfilled",
        isCrossing: false,
        isPartial: false,
      };
    }

    const offsetBps = res.tick - 50;
    const offsetStr = offsetBps >= 0 ? `+${offsetBps}` : `${offsetBps}`;
    const clPriceUsd =
      clearingPrice(
        Math.round(oraclePrice * 1_000_000),
        res.tick,
        101,
        1,
        1000
      ) / 1_000_000;

    const isPartial = res.matched < lots;
    const filledSol = (res.matched * 0.001).toFixed(1);
    const requestedSol = numQty.toFixed(1);
    const partialText = `fills ${filledSol} of ${requestedSol} SOL`;
    const fullText = `Indicative: oracle ${offsetStr} bps for ${numQty.toFixed(2)} SOL`;
    const indicativeText = isPartial
      ? `Indicative: oracle ${offsetStr} bps (${partialText})`
      : fullText;
    const fillLots = Math.min(lots, res.matched);
    const fillPct = Math.round((fillLots / lots) * 100);

    if (orderType === "market") {
      return {
        willFill: true,
        fillLots,
        fillPct,
        price: clPriceUsd,
        offsetBps,
        indicativeText,
        reason: isPartial
          ? `Depth insufficient: ${partialText} at oracle ${offsetStr} bps`
          : indicativeText,
        isCrossing: true,
        isPartial,
      };
    }

    // Limit orders: check if order crosses clearing price
    if (side === "BUY") {
      if (orderTick >= res.ask.tick) {
        return {
          willFill: true,
          fillLots,
          fillPct,
          price: clPriceUsd,
          offsetBps,
          indicativeText,
          reason: isPartial
            ? `Depth insufficient: ${partialText} at oracle ${offsetStr} bps`
            : indicativeText,
          isCrossing: true,
          isPartial,
        };
      }
      return {
        willFill: false,
        fillLots: 0,
        fillPct: 0,
        price: clPriceUsd,
        offsetBps,
        indicativeText: "No crossing liquidity",
        reason: "No crossing liquidity at this price, order will expire unfilled",
        isCrossing: false,
        isPartial: false,
      };
    } else {
      if (orderTick <= res.bid.tick) {
        return {
          willFill: true,
          fillLots,
          fillPct,
          price: clPriceUsd,
          offsetBps,
          indicativeText,
          reason: isPartial
            ? `Depth insufficient: ${partialText} at oracle ${offsetStr} bps`
            : indicativeText,
          isCrossing: true,
          isPartial,
        };
      }
      return {
        willFill: false,
        fillLots: 0,
        fillPct: 0,
        price: clPriceUsd,
        offsetBps,
        indicativeText: "No crossing liquidity",
        reason: "No crossing liquidity at this price, order will expire unfilled",
        isCrossing: false,
        isPartial: false,
      };
    }
  }, [bidQty, askQty, offsetInfo, side, lots, numQty, orderType, oraclePrice]);

  // Margin calculation (10% IMR + 50 bps slip reserve)
  const marginRequired = useMemo(() => {
    const imr = notionalUsd * 0.1;
    const slipReserve = notionalUsd * 0.005;
    return imr + slipReserve;
  }, [notionalUsd]);

  const estimatedFee = notionalUsd * 0.0005; // 5 bps

  // Guardrail G-02: Exact estimated liquidation price (no heuristics)
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

  // Validations: Guardrails G-04, G-05, G-06
  const validationError = useMemo(() => {
    // Guardrail G-04: Collar check
    if (orderType === "limit" && offsetInfo.clamped) {
      const sign = offsetInfo.rawOffsetBps > 0 ? "+" : "";
      return `Exceeds ±50 bps collar (${sign}${offsetInfo.rawOffsetBps} bps). Limit orders must be within ±0.50% of oracle.`;
    }
    if (numQty <= 0) {
      return "Size must be greater than 0.";
    }
    // Guardrail G-05: $10 minimum notional floor
    if (notionalUsd < 10) {
      return "Order notional below minimum ($10.00).";
    }
    if (connected && availableEquity > 0 && marginRequired > availableEquity) {
      const shortfall = (marginRequired - availableEquity).toFixed(2);
      return `Insufficient margin (shortfall $${shortfall}).`;
    }
    // Guardrail G-06: Reduce-only safety
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
    const maxSol =
      reduceOnly && userPositionLots !== 0
        ? Math.abs(userPositionLots * 0.001)
        : Math.max(availableEquity * 10, 100) / (numPrice || oraclePrice || 1);
    const calculated = Math.max(0.01, (maxSol * val) / 100).toFixed(2);
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

  // Button state mapping
  const buttonConfig = useMemo(() => {
    if (!connected) {
      return { text: "Connect Wallet", disabled: false, variant: "primary" as const, isLoading: false };
    }
    if (availableEquity <= 0) {
      return { text: "Deposit to Trade", disabled: false, variant: "secondary" as const, isLoading: false };
    }
    if (marginRequired > availableEquity) {
      return { text: "Insufficient Margin", disabled: true, variant: "secondary" as const, isLoading: false };
    }
    if (validationError) {
      return { text: "Invalid Order", disabled: true, variant: "secondary" as const, isLoading: false };
    }
    if (isPlacingOrder) {
      return { text: "Submitting...", disabled: true, variant: side === "BUY" ? ("buy" as const) : ("sell" as const), isLoading: true };
    }
    return {
      text: `${side === "BUY" ? "Buy / Long" : "Sell / Short"} ${numQty.toFixed(2)} SOL`,
      disabled: false,
      variant: side === "BUY" ? ("buy" as const) : ("sell" as const),
      isLoading: false,
    };
  }, [connected, availableEquity, marginRequired, validationError, isPlacingOrder, side, numQty]);

  return (
    <div
      className={
        isMobileSheet
          ? "w-full flex flex-col min-h-0 bg-surface-panel select-none text-xs overflow-y-auto font-sans"
          : "w-[280px] xl:w-[310px] hidden lg:flex flex-col min-h-0 bg-surface-header select-none text-xs overflow-y-auto border-l border-line-default font-sans"
      }
    >
      {/* Mobile Sheet Top Bar */}
      {isMobileSheet && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-line-default bg-surface-card">
          <div className="flex items-center gap-2">
            <span className="font-bold text-content-primary">SOL-PERP</span>
            <span className="text-[10px] font-mono text-content-muted">Batch #{currentBatchId}</span>
          </div>
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="p-1 rounded hover:bg-surface-elevated text-content-muted hover:text-content-primary transition-colors"
              aria-label="Close order ticket drawer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
      {/* 1. Side Selector: Buy/Long (Emerald) vs Sell/Short (Coral) */}
      <div className="p-2.5 pb-2 border-b border-line-default">
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-surface-panel rounded-lg border border-line-subtle">
          <button
            type="button"
            onClick={() => setSide("BUY")}
            className={`py-1.5 rounded font-semibold text-xs transition-all flex items-center justify-center gap-1.5 ${
              side === "BUY"
                ? "bg-trade-emerald/15 text-trade-emerald border border-trade-emerald/40 shadow-xs"
                : "text-content-secondary hover:text-content-primary hover:bg-surface-hover"
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-trade-emerald" />
            <span>Buy / Long</span>
          </button>
          <button
            type="button"
            onClick={() => setSide("SELL")}
            className={`py-1.5 rounded font-semibold text-xs transition-all flex items-center justify-center gap-1.5 ${
              side === "SELL"
                ? "bg-trade-coral/15 text-trade-coral border border-trade-coral/40 shadow-xs"
                : "text-content-secondary hover:text-content-primary hover:bg-surface-hover"
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-trade-coral" />
            <span>Sell / Short</span>
          </button>
        </div>
      </div>

      {/* 2. Order Form */}
      <form onSubmit={handleFormAction} className="p-3 space-y-3 flex-1 flex flex-col justify-between">
        <div className="space-y-3">
          {/* Order Type Tabs (Limit vs Market) & Reduce-Only Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOrderType("limit")}
                className={`text-xs pb-1 font-semibold transition-colors ${
                  orderType === "limit"
                    ? "text-content-primary border-b-2 border-trade-cyan"
                    : "text-content-secondary hover:text-content-primary"
                }`}
              >
                Limit
              </button>
              <button
                type="button"
                onClick={() => setOrderType("market")}
                className={`text-xs pb-1 font-semibold transition-colors ${
                  orderType === "market"
                    ? "text-content-primary border-b-2 border-trade-cyan"
                    : "text-content-secondary hover:text-content-primary"
                }`}
              >
                Market
              </button>
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer text-content-secondary hover:text-content-primary text-2xs">
              <input
                type="checkbox"
                checked={reduceOnly}
                onChange={(e) => setReduceOnly(e.target.checked)}
                className="rounded bg-surface-card border-line-strong text-trade-cyan focus:ring-0 w-3 h-3 cursor-pointer"
              />
              <span>Reduce-Only</span>
            </label>
          </div>

          {/* Limit Price Input */}
          {orderType === "limit" ? (
            <div className="space-y-1">
              <div className="flex justify-between text-2xs text-content-secondary">
                <span>Price (USDC)</span>
                <span className="text-content-primary tabular-nums font-mono">
                  Oracle: ${oraclePrice.toFixed(2)}
                </span>
              </div>
              <Input
                type="number"
                step="0.01"
                value={priceStr}
                onChange={(e) => {
                  setUserEditedPrice(true);
                  setPriceStr(e.target.value);
                }}
                rightAdornment={<span className="text-2xs font-mono text-content-muted">USDC</span>}
                error={offsetInfo.clamped ? "Exceeds ±50 bps collar" : undefined}
                sizeVariant="md"
                isNumeric
                placeholder="0.00"
              />
              {/* Pegged Offset Explainer */}
              <div
                className={`p-1.5 rounded border text-2xs flex items-center justify-between transition-colors ${
                  offsetInfo.clamped
                    ? "bg-trade-coral/10 border-trade-coral/40 text-trade-coral"
                    : "bg-surface-card border-line-default text-content-secondary"
                }`}
              >
                <span>
                  Pegged:{" "}
                  <strong className={`font-mono ${offsetInfo.clamped ? "text-trade-coral" : "text-content-primary"}`}>
                    {offsetInfo.rawOffsetBps >= 0 ? `+${offsetInfo.rawOffsetBps}` : offsetInfo.rawOffsetBps} bps
                  </strong>
                </span>
                <span className={`text-[9px] font-semibold ${offsetInfo.clamped ? "text-trade-coral" : "text-trade-cyan"}`}>
                  {offsetInfo.clamped ? "Outside Collar" : "Moves with oracle"}
                </span>
              </div>
              {/* Crossing Warning & One-Click Fill Now */}
              {indicativePreview && !indicativePreview.isCrossing && (
                <div className="p-2 rounded bg-trade-amber/10 border border-trade-amber/30 text-2xs text-trade-amber flex items-center justify-between gap-1.5">
                  <div className="flex items-start gap-1 flex-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>No crossing liquidity; will expire unfilled</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOrderType("market")}
                    className="px-1.5 py-0.5 rounded bg-trade-cyan text-black font-semibold text-[10px] shrink-0 hover:bg-trade-cyan/90 transition-colors"
                  >
                    Fill Now
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Market Order Slippage & Clearing Label */
            <div className="p-2.5 rounded bg-surface-card border border-line-default text-2xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-content-primary font-semibold">
                  {indicativePreview.isPartial ? "Partial Fill Preview" : "Market Order"}
                </span>
                <span
                  className={`font-mono text-2xs ${
                    indicativePreview.isPartial ? "text-trade-amber" : "text-trade-emerald"
                  }`}
                >
                  {indicativePreview.indicativeText}
                </span>
              </div>
              <p className="text-[10px] text-content-muted leading-relaxed">
                Uniform clearing price: all matched lots trade at single P* ($
                {indicativePreview.price.toFixed(3)}), plus 5 bps fee.
              </p>
            </div>
          )}

          {/* Size Input in SOL */}
          <div className="space-y-1">
            <div className="flex justify-between text-2xs text-content-secondary">
              <span>Size (SOL)</span>
              <span className="text-content-primary tabular-nums font-mono">{lots} lots</span>
            </div>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              value={qtySol}
              onChange={(e) => setQtySol(e.target.value)}
              rightAdornment={<span className="text-2xs font-mono text-content-muted">SOL</span>}
              sizeVariant="md"
              isNumeric
              placeholder="1.00"
            />
          </div>

          {/* Slider */}
          <div className="space-y-1 pt-0.5">
            <input
              type="range"
              min="1"
              max="100"
              value={sliderVal}
              onChange={(e) => handleSliderMove(Number(e.target.value))}
              aria-label="Order size percentage slider"
              className="w-full h-1 bg-surface-panel rounded-lg appearance-none cursor-pointer accent-trade-cyan"
            />
            <div className="flex justify-between text-[9px] font-mono text-content-muted">
              <span>25%</span>
              <span>50%</span>
              <span>75%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Lifetime Selector (1 to 4 batches) */}
          <div className="space-y-1 pt-0.5">
            <div className="flex justify-between text-2xs text-content-secondary">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-trade-cyan" />
                Order Lifetime
              </span>
              <span className="text-trade-cyan font-mono text-2xs">
                {lifetimeBatches === 1
                  ? "1 batch (~0.48s)"
                  : `${lifetimeBatches} batches (~${(lifetimeBatches * 0.48).toFixed(2)}s)`}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={`life-${n}`}
                  type="button"
                  onClick={() => setLifetimeBatches(n)}
                  className={`py-1 rounded text-2xs font-mono font-medium border transition-colors ${
                    lifetimeBatches === n
                      ? "bg-trade-cyan/15 border-trade-cyan text-trade-cyan shadow-xs"
                      : "bg-surface-card border-line-default text-content-secondary hover:text-content-primary hover:border-line-strong"
                  }`}
                >
                  {n} {n === 1 ? "batch" : "batches"}
                </button>
              ))}
            </div>

            {lifetimeBatches > 1 && (
              <div className="p-1.5 rounded bg-trade-amber/10 border border-trade-amber/30 text-2xs text-trade-amber flex items-start gap-1 mt-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Multi-batch: Places {lifetimeBatches} independent orders. Max exposure:{" "}
                  <strong>{(numQty * lifetimeBatches).toFixed(2)} SOL</strong> ($
                  {(notionalUsd * lifetimeBatches).toFixed(2)}).
                </span>
              </div>
            )}
          </div>

          {/* Validation Alert */}
          {validationError && (
            <div className="p-2 rounded bg-trade-coral/10 border border-trade-coral/30 text-2xs text-trade-coral flex items-start gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{validationError}</span>
            </div>
          )}

          {/* On-Chain Execution Failure Alert */}
          {orderError && (
            <div className="p-2.5 rounded bg-trade-coral/15 border border-trade-coral/40 text-2xs text-trade-coral flex items-start justify-between gap-1.5 animate-scale-in">
              <div className="flex items-start gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-trade-coral" />
                <span className="font-semibold leading-tight">{orderError}</span>
              </div>
              {onClearOrderError && (
                <button
                  type="button"
                  onClick={onClearOrderError}
                  className="text-content-muted hover:text-content-primary p-0.5 rounded transition-colors"
                  title="Dismiss error"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* Order Preview Card */}
          <div className="p-2.5 rounded bg-surface-card border border-line-default space-y-1.5 text-2xs">
            <div className="flex justify-between text-content-secondary">
              <span>Estimated Notional</span>
              <span className="text-content-primary font-mono tabular-nums font-medium">
                ${notionalUsd.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-content-secondary">
              <span>Estimated Fee (5 bps)</span>
              <span className="text-content-primary font-mono tabular-nums font-medium">
                ${estimatedFee.toFixed(3)}
              </span>
            </div>
            <div className="flex justify-between text-content-secondary">
              <span>Req. Margin + Slip</span>
              <span className="text-content-primary font-mono tabular-nums font-medium">
                ${marginRequired.toFixed(2)}
              </span>
            </div>

            {/* Est. Liquidation Price */}
            <div className="flex justify-between text-content-secondary">
              <span className="flex items-center gap-1">
                Est. Liq Price
                <Tooltip content="Estimated bankruptcy liquidation threshold (5% MMR)">
                  <HelpCircle className="w-3 h-3 text-content-muted" />
                </Tooltip>
              </span>
              {userPositionLots === 0 ? (
                <span
                  className="text-content-muted font-mono tabular-nums cursor-help"
                  title="No open position. Liquidation price is established after a position is filled."
                >
                  —
                </span>
              ) : (
                <span className="text-trade-amber font-mono tabular-nums font-semibold">
                  {estimatedLiqPrice !== "—" ? `$${estimatedLiqPrice}` : "—"}
                </span>
              )}
            </div>

            {/* Indicative Fill Preview */}
            <div className="pt-1.5 mt-1 border-t border-line-default text-[10px] flex items-center justify-between">
              <span className="text-content-muted">Indicative Fill (Batch #{currentBatchId + 1})</span>
              <div className="flex items-center gap-1.5">
                <span
                  className={`font-mono font-medium ${
                    indicativePreview?.isCrossing ? "text-trade-cyan" : "text-trade-amber"
                  }`}
                >
                  {indicativePreview?.willFill
                    ? `${indicativePreview.fillPct}% (${((indicativePreview.fillLots ?? 0) * 0.001).toFixed(2)} SOL)`
                    : "0% (unfilled)"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Primary Action Button */}
        <div className="pt-2">
          <Button
            type="submit"
            variant={buttonConfig.variant}
            disabled={buttonConfig.disabled}
            isLoading={buttonConfig.isLoading}
            fullWidth
            size="md"
          >
            {buttonConfig.text}
          </Button>
          <p className="text-center text-[10px] text-content-muted mt-1.5">
            Executes at the next batch close (~0.48 s)
          </p>
        </div>
      </form>
    </div>
  );
};
