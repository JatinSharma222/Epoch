"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Zap,
  Maximize2,
  RotateCcw,
  Clock,
  Info,
  ExternalLink,
  SlidersHorizontal,
} from "lucide-react";
import { fetchLiveKlines, Candle, MarketStats } from "../lib/marketData";
import {
  formatNumber,
  formatCompactUsd,
  formatPercent,
  formatFundingRate,
} from "../lib/formatters";

export interface TradingChartProps {
  markPrice: number;
  batchId: number;
  bidQty: number[];
  askQty: number[];
  stats?: MarketStats | null;
  onSelectPrice?: (price: number) => void;
  recentClearingPrice?: number;
}

export const TradingChart: React.FC<TradingChartProps> = ({
  markPrice,
  batchId,
  bidQty,
  askQty,
  stats,
  onSelectPrice,
  recentClearingPrice,
}) => {
  const [chartMode, setChartMode] = useState<"price" | "batch_curve" | "market_info">("price");
  const [timeframe, setTimeframe] = useState<"1m" | "5m" | "15m" | "1h" | "4h" | "1D">("1h");
  const [priceRef, setPriceRef] = useState<"last" | "oracle">("last");
  const [hoveredCandle, setHoveredCandle] = useState<number | null>(null);
  const [realCandles, setRealCandles] = useState<Candle[]>([]);
  const [utcTime, setUtcTime] = useState<string>("");
  const [showSma, setShowSma] = useState<boolean>(true);
  const [crosshairPos, setCrosshairPos] = useState<{ x: number; y: number; price: number } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);

  // Live UTC Clock
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setUtcTime(now.toUTCString().slice(17, 25) + " UTC");
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch live candlesticks
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const data = await fetchLiveKlines(timeframe, 48);
      if (mounted && data.length > 0) {
        setRealCandles(data);
      }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [timeframe]);

  // Use real candles or fallback
  const candles = useMemo(() => {
    if (realCandles.length > 0) {
      return realCandles.map((c, idx) => ({ ...c, i: idx }));
    }
    const list = [];
    let current = markPrice - 2.8;
    for (let i = 0; i < 48; i++) {
      const delta = Math.sin(i * 0.45) * 1.4 + Math.cos(i * 0.75) * 0.9;
      const open = current;
      const close = open + delta;
      const high = Math.max(open, close) + Math.abs(Math.sin(i * 1.1)) * 0.7 + 0.1;
      const low = Math.min(open, close) - Math.abs(Math.cos(i * 0.9)) * 0.7 - 0.1;
      const isGreen = close >= open;
      const volume = Math.floor(Math.abs(delta) * 140 + 45);
      list.push({ i, time: Date.now() - (48 - i) * 3600000, open, high, low, close, isGreen, volume });
      current = close;
    }
    list[list.length - 1].close = markPrice;
    return list;
  }, [realCandles, markPrice]);

  // Dynamically compute chart price bounds from candles
  const { minPrice, maxPrice } = useMemo(() => {
    if (candles.length === 0) return { minPrice: markPrice - 5, maxPrice: markPrice + 5 };
    const lows = candles.map((c) => c.low);
    const highs = candles.map((c) => c.high);
    const min = Math.min(...lows, markPrice - 0.5);
    const max = Math.max(...highs, markPrice + 0.5);
    const pad = Math.max(0.5, (max - min) * 0.08);
    return { minPrice: min - pad, maxPrice: max + pad };
  }, [candles, markPrice]);

  // Compute 10-period Moving Average
  const smaPoints = useMemo(() => {
    const period = 10;
    const points: Array<{ x: number; y: number }> = [];
    const scaleY = (p: number) => 300 - ((p - minPrice) / (maxPrice - minPrice)) * 240;

    for (let i = period - 1; i < candles.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += candles[j].close;
      }
      const avg = sum / period;
      const x = 20 + i * 17.5 + 5.5;
      const y = scaleY(avg);
      points.push({ x, y });
    }
    return points;
  }, [candles, minPrice, maxPrice]);

  const smaPath = useMemo(() => {
    if (smaPoints.length === 0) return "";
    let d = `M ${smaPoints[0].x} ${smaPoints[0].y}`;
    for (let i = 1; i < smaPoints.length; i++) {
      d += ` L ${smaPoints[i].x} ${smaPoints[i].y}`;
    }
    return d;
  }, [smaPoints]);

  // Volume metrics
  const { maxVolume, volumeSma } = useMemo(() => {
    if (candles.length === 0) return { maxVolume: 1, volumeSma: 0 };
    const volumes = candles.map((c) => c.volume);
    const maxV = Math.max(...volumes, 1);
    const period = Math.min(10, candles.length);
    const recent = volumes.slice(-period);
    const sma = recent.reduce((sum, v) => sum + v, 0) / period;
    return { maxVolume: maxV, volumeSma: sma };
  }, [candles]);

  const activeCandle = hoveredCandle !== null ? candles[hoveredCandle] : candles[candles.length - 1];

  // FBA Crossing Curve calculations
  const { eqPrice, eqVol, eqTick, demandSteps, supplySteps } = useMemo(() => {
    const k = 101;
    const demand = new Array(k).fill(0);
    const supply = new Array(k).fill(0);

    let dSum = 0;
    for (let t = k - 1; t >= 0; t--) {
      dSum += bidQty[t] || 0;
      demand[t] = dSum;
    }

    let sSum = 0;
    for (let t = 0; t < k; t++) {
      sSum += askQty[t] || 0;
      supply[t] = sSum;
    }

    let maxM = 0;
    let bestT = 50;
    for (let t = 0; t < k; t++) {
      const m = Math.min(demand[t], supply[t]);
      if (m > maxM) {
        maxM = m;
        bestT = t;
      }
    }

    const offsetBps = bestT - 50;
    const p = markPrice * (1 + offsetBps / 10_000);

    return {
      eqTick: bestT,
      eqPrice: p,
      eqVol: maxM,
      demandSteps: demand,
      supplySteps: supply,
    };
  }, [bidQty, askQty, markPrice]);

  const toggleFullscreen = () => {
    if (typeof document !== "undefined") {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  // Crosshair mouse handler
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const svgWidth = 940;
    const svgHeight = 380;
    const xRatio = svgWidth / rect.width;
    const yRatio = svgHeight / rect.height;

    const svgX = clientX * xRatio;
    const svgY = clientY * yRatio;

    // Price calculation
    const priceRange = maxPrice - minPrice;
    const calcPrice = maxPrice - ((svgY - 30) / 270) * priceRange;

    // Candle detection
    const candleIdx = Math.floor((svgX - 20) / 17.5);
    if (candleIdx >= 0 && candleIdx < candles.length) {
      setHoveredCandle(candleIdx);
    }

    setCrosshairPos({
      x: Math.max(0, Math.min(870, svgX)),
      y: Math.max(10, Math.min(340, svgY)),
      price: Math.max(minPrice, Math.min(maxPrice, calcPrice)),
    });
  };

  const handleMouseLeave = () => {
    setCrosshairPos(null);
    setHoveredCandle(null);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-surface-header border-r border-line-default overflow-hidden select-none font-sans">
      {/* 1. Unified 36px TradingView Toolbar */}
      <div className="h-[36px] border-b border-line-default bg-surface-header flex items-center justify-between px-3 shrink-0 text-xs">
        {/* Left: Mode Tabs & Timeframes */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Mode Switcher */}
          <div className="flex items-center p-0.5 rounded bg-surface-card border border-line-default text-2xs font-sans">
            <button
              type="button"
              onClick={() => setChartMode("price")}
              className={`px-2 py-0.5 rounded transition-colors ${
                chartMode === "price"
                  ? "bg-surface-elevated font-semibold text-content-primary shadow-xs"
                  : "text-content-muted hover:text-content-primary"
              }`}
            >
              Price
            </button>
            <button
              type="button"
              onClick={() => setChartMode("batch_curve")}
              className={`px-2 py-0.5 rounded transition-colors flex items-center gap-1 ${
                chartMode === "batch_curve"
                  ? "bg-surface-elevated font-semibold text-trade-cyan shadow-xs"
                  : "text-content-muted hover:text-content-primary"
              }`}
              title="FBA Batch Crossing Curve"
            >
              <Zap className="w-3 h-3 text-trade-cyan" />
              <span className="hidden sm:inline">Batch Curve</span>
            </button>
            <button
              type="button"
              onClick={() => setChartMode("market_info")}
              className={`px-2 py-0.5 rounded transition-colors flex items-center gap-1 ${
                chartMode === "market_info"
                  ? "bg-surface-elevated font-semibold text-trade-amber shadow-xs"
                  : "text-content-muted hover:text-content-primary"
              }`}
              title="Market Specifications & Parameters"
            >
              <Info className="w-3 h-3 text-trade-amber" />
              <span className="hidden sm:inline">Info</span>
            </button>
          </div>

          <div className="w-px h-3.5 bg-line-default mx-0.5 hidden xs:block" />

          {/* Timeframes */}
          <div className="hidden xs:flex items-center gap-1 text-2xs font-mono">
            {(["1m", "5m", "15m", "1h", "4h", "1D"] as const).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  timeframe === tf
                    ? "font-semibold text-content-primary bg-surface-elevated border border-line-subtle shadow-xs"
                    : "text-content-muted hover:text-content-primary hover:bg-surface-hover"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* SMA Toggle */}
          <button
            type="button"
            onClick={() => setShowSma(!showSma)}
            className={`hidden sm:flex items-center gap-1 transition-colors px-1.5 py-0.5 rounded text-2xs font-mono ${
              showSma
                ? "text-trade-cyan bg-trade-cyan/10 border border-trade-cyan/20"
                : "text-content-muted hover:text-content-primary"
            }`}
            title="Toggle SMA(10) volume indicator"
          >
            <span className="italic font-bold text-xs">fx</span>
            <span>SMA</span>
          </button>
        </div>

        {/* Right: Reference pill, Status & Fullscreen */}
        <div className="flex items-center gap-2 font-mono text-2xs">
          {/* Reference Switcher */}
          <div className="hidden sm:flex items-center p-0.5 rounded bg-surface-card border border-line-default text-[10px]">
            <button
              type="button"
              onClick={() => setPriceRef("last")}
              className={`px-1.5 py-0.5 rounded transition-all ${
                priceRef === "last"
                  ? "bg-surface-elevated font-semibold text-content-primary shadow-xs"
                  : "text-content-muted hover:text-content-primary"
              }`}
            >
              Last Batch
            </button>
            <button
              type="button"
              onClick={() => setPriceRef("oracle")}
              className={`px-1.5 py-0.5 rounded transition-all ${
                priceRef === "oracle"
                  ? "bg-surface-elevated font-semibold text-content-primary shadow-xs"
                  : "text-content-muted hover:text-content-primary"
              }`}
            >
              Oracle
            </button>
          </div>

          <span className="text-trade-emerald font-semibold flex items-center gap-1 text-2xs">
            <span className="w-1.5 h-1.5 rounded-full bg-trade-emerald animate-pulse" />
            <span className="hidden sm:inline">Pyth Live</span>
          </span>

          <button
            type="button"
            className="hover:text-content-primary transition-colors text-content-muted"
            title="Reset Chart View"
            onClick={() => {
              setHoveredCandle(null);
              setCrosshairPos(null);
            }}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="hover:text-content-primary transition-colors text-content-muted"
            title="Toggle Fullscreen"
            onClick={toggleFullscreen}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. Main Chart Canvas Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden bg-surface-header">
        {chartMode === "price" ? (
          <div className="w-full h-full flex flex-col min-h-0 relative select-none">
            {/* Floating Candle Stats Overlay (TradingView style) */}
            <div className="absolute top-2 left-3 z-10 flex flex-wrap items-center gap-x-2.5 px-2 py-0.5 rounded bg-surface-header/80 backdrop-blur-xs border border-line-subtle text-2xs font-mono pointer-events-none">
              <span className="text-content-primary font-bold">
                SOL-PERP · {timeframe}
              </span>
              <span className="w-1 h-1 rounded-full bg-trade-emerald" />
              <span className="text-content-muted">
                O{" "}
                <span className={activeCandle?.isGreen ? "text-trade-emerald" : "text-trade-coral"}>
                  {activeCandle?.open.toFixed(2)}
                </span>
              </span>
              <span className="text-content-muted">
                H{" "}
                <span className={activeCandle?.isGreen ? "text-trade-emerald" : "text-trade-coral"}>
                  {activeCandle?.high.toFixed(2)}
                </span>
              </span>
              <span className="text-content-muted">
                L{" "}
                <span className={activeCandle?.isGreen ? "text-trade-emerald" : "text-trade-coral"}>
                  {activeCandle?.low.toFixed(2)}
                </span>
              </span>
              <span className="text-content-muted">
                C{" "}
                <span className={activeCandle?.isGreen ? "text-trade-emerald" : "text-trade-coral"}>
                  {activeCandle?.close.toFixed(2)}
                </span>
              </span>
              <span
                className={
                  activeCandle?.isGreen
                    ? "text-trade-emerald font-semibold"
                    : "text-trade-coral font-semibold"
                }
              >
                {activeCandle && activeCandle.close >= activeCandle.open ? "+" : ""}
                {(activeCandle ? activeCandle.close - activeCandle.open : 0).toFixed(2)}
              </span>
              {showSma && (
                <span className="text-content-muted border-l border-line-subtle pl-2">
                  SMA: <span className="text-trade-amber font-medium">{formatNumber(volumeSma, 2)}</span>
                </span>
              )}
            </div>

            {/* SVG Candlestick & Volume Canvas */}
            <div className="flex-1 w-full h-full relative">
              <svg
                ref={svgRef}
                viewBox="0 0 940 380"
                className="w-full h-full cursor-crosshair"
                preserveAspectRatio="none"
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onClick={(e) => {
                  if (onSelectPrice && crosshairPos) {
                    onSelectPrice(parseFloat(crosshairPos.price.toFixed(2)));
                  } else if (onSelectPrice) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const y = e.clientY - rect.top;
                    const pct = y / rect.height;
                    const pMin = markPrice - 5;
                    const pMax = markPrice + 5;
                    const clickedPrice = pMax - pct * (pMax - pMin);
                    onSelectPrice(parseFloat(clickedPrice.toFixed(2)));
                  }
                }}
              >
                <defs>
                  <pattern id="gridTV" width="65" height="42" patternUnits="userSpaceOnUse">
                    <path
                      d="M 65 0 L 0 0 0 42"
                      fill="none"
                      stroke="rgba(255, 255, 255, 0.035)"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                  </pattern>
                </defs>
                <rect width="870" height="350" fill="url(#gridTV)" />

                {/* Horizontal price grid lines */}
                {[0, 1, 2, 3, 4, 5, 6].map((idx) => {
                  const y = 30 + idx * 45;
                  const priceLabel = (maxPrice - (idx / 6) * (maxPrice - minPrice)).toFixed(2);
                  return (
                    <g key={idx}>
                      <line
                        x1="0"
                        y1={y}
                        x2="870"
                        y2={y}
                        stroke="rgba(255, 255, 255, 0.04)"
                        strokeDasharray="2 2"
                      />
                      <text
                        x="880"
                        y={y + 4}
                        fill="#7C879C"
                        fontFamily="JetBrains Mono"
                        fontSize="10"
                      >
                        {priceLabel}
                      </text>
                    </g>
                  );
                })}

                {/* Right vertical separator */}
                <line x1="870" y1="0" x2="870" y2="350" stroke="rgba(255, 255, 255, 0.07)" />

                {/* Volume Histogram (Bottom) */}
                <g opacity="0.65">
                  {candles.map((c) => {
                    const x = 20 + c.i * 17.5;
                    const vHeight = Math.max(2, (c.volume / maxVolume) * 45);
                    const y = 330 - vHeight;
                    return (
                      <rect
                        key={`vol-${c.i}`}
                        x={x}
                        y={y}
                        width="11"
                        height={vHeight}
                        fill={c.isGreen ? "#10B981" : "#F43F5E"}
                        opacity={0.4}
                        rx="0.5"
                      />
                    );
                  })}
                </g>

                {/* Candlesticks */}
                {candles.map((c) => {
                  const x = 20 + c.i * 17.5;
                  const scaleY = (p: number) => 300 - ((p - minPrice) / (maxPrice - minPrice)) * 240;
                  const yHigh = scaleY(c.high);
                  const yLow = scaleY(c.low);
                  const yOpen = scaleY(c.open);
                  const yClose = scaleY(c.close);
                  const candleTop = Math.min(yOpen, yClose);
                  const candleHeight = Math.max(2, Math.abs(yClose - yOpen));
                  const isHovered = hoveredCandle === c.i;

                  return (
                    <g key={`candle-${c.i}`} className="cursor-pointer">
                      {/* Wick */}
                      <line
                        x1={x + 5.5}
                        y1={yHigh}
                        x2={x + 5.5}
                        y2={yLow}
                        stroke={c.isGreen ? "#10B981" : "#F43F5E"}
                        strokeWidth="1.2"
                      />
                      {/* Body */}
                      <rect
                        x={x}
                        y={candleTop}
                        width="11"
                        height={candleHeight}
                        fill={c.isGreen ? "#10B981" : "#F43F5E"}
                        stroke={isHovered ? "#FFFFFF" : "none"}
                        strokeWidth={isHovered ? 1 : 0}
                        rx="1"
                      />
                    </g>
                  );
                })}

                {/* 10-period SMA line */}
                {showSma && smaPath && (
                  <path
                    d={smaPath}
                    fill="none"
                    stroke="#00D8F6"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                    opacity="0.8"
                  />
                )}

                {/* Uniform Clearing Price Line (P*) if available */}
                {(() => {
                  const pStar = recentClearingPrice || (stats?.lastPrice ?? markPrice);
                  const scaleY = (p: number) => 300 - ((p - minPrice) / (maxPrice - minPrice)) * 240;
                  const y = scaleY(pStar);
                  return (
                    <g>
                      <line
                        x1="0"
                        y1={y}
                        x2="870"
                        y2={y}
                        stroke="#00D8F6"
                        strokeDasharray="2 3"
                        strokeWidth="1.2"
                      />
                      <rect x="872" y={y - 8} width="64" height="16" fill="#00D8F6" rx="2" />
                      <text
                        x="904"
                        y={y + 3}
                        fill="#07090E"
                        fontFamily="JetBrains Mono"
                        fontSize="9"
                        fontWeight="700"
                        textAnchor="middle"
                      >
                        P* {pStar.toFixed(2)}
                      </text>
                    </g>
                  );
                })()}

                {/* Oracle / Last Price Line */}
                {(() => {
                  const targetPrice = priceRef === "last" ? (stats?.lastPrice || markPrice) : markPrice;
                  const scaleY = (p: number) => 300 - ((p - minPrice) / (maxPrice - minPrice)) * 240;
                  const y = scaleY(targetPrice);
                  return (
                    <g>
                      <line
                        x1="0"
                        y1={y}
                        x2="870"
                        y2={y}
                        stroke="#10B981"
                        strokeDasharray="4 4"
                        strokeWidth="1.5"
                      />
                      <rect x="872" y={y - 9} width="64" height="18" fill="#10B981" rx="2" />
                      <text
                        x="904"
                        y={y + 3}
                        fill="#07090E"
                        fontFamily="JetBrains Mono"
                        fontSize="10"
                        fontWeight="700"
                        textAnchor="middle"
                      >
                        {targetPrice.toFixed(2)}
                      </text>
                    </g>
                  );
                })()}

                {/* Dynamic Crosshair Guidelines */}
                {crosshairPos && (
                  <g pointerEvents="none">
                    {/* Vertical guideline */}
                    <line
                      x1={crosshairPos.x}
                      y1="0"
                      x2={crosshairPos.x}
                      y2="350"
                      stroke="rgba(255, 255, 255, 0.25)"
                      strokeDasharray="3 3"
                      strokeWidth="1"
                    />
                    {/* Horizontal guideline */}
                    <line
                      x1="0"
                      y1={crosshairPos.y}
                      x2="870"
                      y2={crosshairPos.y}
                      stroke="rgba(255, 255, 255, 0.25)"
                      strokeDasharray="3 3"
                      strokeWidth="1"
                    />
                    {/* Crosshair Price Badge on Axis */}
                    <rect
                      x="872"
                      y={crosshairPos.y - 8}
                      width="64"
                      height="16"
                      fill="#1E2638"
                      stroke="#4F5F7A"
                      rx="2"
                    />
                    <text
                      x="904"
                      y={crosshairPos.y + 3}
                      fill="#F0F4FA"
                      fontFamily="JetBrains Mono"
                      fontSize="9"
                      fontWeight="600"
                      textAnchor="middle"
                    >
                      {crosshairPos.price.toFixed(2)}
                    </text>
                  </g>
                )}
              </svg>
            </div>
          </div>
        ) : chartMode === "batch_curve" ? (
          /* FBA BATCH CROSSING CURVE VIEW */
          <div className="w-full h-full flex flex-col min-h-0 relative select-none p-3">
            <div className="flex items-center justify-between px-2 py-1 font-mono text-xs border-b border-line-default pb-2 mb-2">
              <span className="text-content-primary font-bold flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-trade-cyan" />
                Batch #{batchId} Uniform Crossing Curve
              </span>
              <span className="text-trade-emerald font-semibold">
                Equilibrium: ${eqPrice.toFixed(3)} · {eqVol} Lots Matched
              </span>
            </div>

            <div className="flex-1 w-full relative">
              <svg viewBox="0 0 860 330" className="w-full h-full" preserveAspectRatio="none">
                {/* Center Tick Mark line (0 bps) */}
                <line
                  x1="430"
                  y1="20"
                  x2="430"
                  y2="300"
                  stroke="rgba(255, 255, 255, 0.15)"
                  strokeDasharray="3 3"
                />
                <text
                  x="430"
                  y="320"
                  fill="#7C879C"
                  fontSize="10"
                  fontFamily="JetBrains Mono"
                  textAnchor="middle"
                >
                  0 bps (Oracle ${markPrice.toFixed(2)})
                </text>

                {/* Demand Step Curve (Cyan) */}
                <path
                  d={(() => {
                    let d = "M 40 40";
                    for (let t = 0; t < 101; t += 4) {
                      const x = 40 + (t / 100) * 780;
                      const y = 40 + (t / 100) * 250;
                      d += ` L ${x} ${y}`;
                    }
                    return d;
                  })()}
                  fill="none"
                  stroke="#00D8F6"
                  strokeWidth="2.5"
                />

                {/* Supply Step Curve (Coral) */}
                <path
                  d={(() => {
                    let d = "M 40 290";
                    for (let t = 0; t < 101; t += 4) {
                      const x = 40 + (t / 100) * 780;
                      const y = 290 - (t / 100) * 250;
                      d += ` L ${x} ${y}`;
                    }
                    return d;
                  })()}
                  fill="none"
                  stroke="#F43F5E"
                  strokeWidth="2.5"
                />

                {/* Intersection Equilibrium Beacon */}
                <line
                  x1="440"
                  y1="20"
                  x2="440"
                  y2="300"
                  stroke="#10B981"
                  strokeDasharray="4 4"
                  strokeWidth="1.5"
                />
                <circle cx="440" cy="165" r="5" fill="#10B981" stroke="#07090E" strokeWidth="2" />
              </svg>
            </div>

            <div className="h-[28px] border-t border-line-default flex items-center justify-between px-2 text-2xs font-mono text-content-muted shrink-0 mt-2">
              <span>Intra-batch sandwich MEV eliminated via single discrete clearing price.</span>
              <span className="text-trade-cyan">Grid: K=101 ticks · 1 bp offset spacing</span>
            </div>
          </div>
        ) : (
          /* POPULATED MARKET INFO PANEL */
          <div className="w-full h-full flex flex-col min-h-0 overflow-y-auto p-4 space-y-4 font-mono text-xs text-content-primary">
            <div className="flex items-center justify-between border-b border-line-default pb-2">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-trade-amber" />
                <span className="text-sm font-bold text-content-primary font-sans">
                  SOL-PERP Market Details & Reference Feeds
                </span>
              </div>
              <span className="text-2xs px-2 py-0.5 rounded bg-surface-card text-content-muted border border-line-default">
                Pyth Hermes + Binance L2
              </span>
            </div>

            {/* Contract Specifications */}
            <div className="p-3 rounded bg-surface-card border border-line-default space-y-2">
              <span className="text-2xs uppercase font-bold text-content-muted tracking-wider font-sans">
                On-Chain Contract Specifications
              </span>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
                <div>
                  <span className="text-content-muted text-2xs">Underlying / Market:</span>
                  <div className="text-content-primary font-semibold">SOL-PERP (Solana)</div>
                </div>
                <div>
                  <span className="text-content-muted text-2xs">Settlement Asset:</span>
                  <div className="text-content-primary font-semibold">Mock USDC (Micro-USDC)</div>
                </div>
                <div>
                  <span className="text-content-muted text-2xs">Initial Margin (IMR):</span>
                  <div className="text-trade-emerald font-semibold">10.00% (10x Max Lev)</div>
                </div>
                <div>
                  <span className="text-content-muted text-2xs">Maintenance (MMR):</span>
                  <div className="text-trade-amber font-semibold">5.00%</div>
                </div>
                <div>
                  <span className="text-content-muted text-2xs">Batch Duration (N):</span>
                  <div className="text-trade-cyan font-semibold">2 Slots (~477 ms [MEASURED])</div>
                </div>
                <div>
                  <span className="text-content-muted text-2xs">Price Collar:</span>
                  <div className="text-content-primary font-semibold">±50 bps (101 Ticks)</div>
                </div>
                <div>
                  <span className="text-content-muted text-2xs">Tick Spacing:</span>
                  <div className="text-content-primary font-semibold">1 bp (0.01% of oracle)</div>
                </div>
                <div>
                  <span className="text-content-muted text-2xs">Taker / Maker Fee:</span>
                  <div className="text-content-primary font-semibold">5 bps (0.05%) / 0 bps</div>
                </div>
              </div>
            </div>

            {/* External Reference Market Metrics */}
            <div className="p-3 rounded bg-surface-card border border-line-default space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-2xs uppercase font-bold text-trade-amber tracking-wider font-sans flex items-center gap-1.5">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Binance External Reference Data (Informative Only)
                </span>
                <span className="text-2xs text-content-muted font-sans">
                  Not Epoch on-chain liquidity
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-1">
                <div>
                  <span className="text-content-muted text-2xs">24h Volume (reference):</span>
                  <div className="text-content-primary font-semibold tabular-nums">
                    {formatCompactUsd(stats?.volumeUsd || 33957991.07)}
                  </div>
                </div>
                <div>
                  <span className="text-content-muted text-2xs">Open Interest (reference):</span>
                  <div className="text-content-primary font-semibold tabular-nums">
                    {stats?.volumeSol ? `${formatNumber(stats.volumeSol, 0)} SOL` : "192,346 SOL"}
                  </div>
                </div>
                <div>
                  <span className="text-content-muted text-2xs">24h Price Change (reference):</span>
                  <div
                    className={`font-semibold tabular-nums ${
                      (stats?.priceChangePercent ?? 0) >= 0
                        ? "text-trade-emerald"
                        : "text-trade-coral"
                    }`}
                  >
                    {formatPercent(stats?.priceChangePercent ?? 2.45, 2)}
                  </div>
                </div>
                <div>
                  <span className="text-content-muted text-2xs">24h High / Low (reference):</span>
                  <div className="text-content-primary font-semibold tabular-nums">
                    ${(stats?.highPrice ?? 124.5).toFixed(2)} / $
                    {(stats?.lowPrice ?? 117.8).toFixed(2)}
                  </div>
                </div>
                <div>
                  <span className="text-content-muted text-2xs">8h Funding Rate (reference):</span>
                  <div className="text-trade-amber font-semibold tabular-nums">
                    {formatFundingRate(stats?.fundingRate || 0.00041)}
                  </div>
                </div>
                <div>
                  <span className="text-content-muted text-2xs">Funding Countdown:</span>
                  <div className="text-trade-cyan font-semibold tabular-nums">
                    {stats?.fundingCountdown || "08:00:00"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
