"use client";

import React, { useState, useMemo, useRef } from "react";
import {
  Zap,
  Activity,
  Maximize2,
  Camera,
  RotateCcw,
  Sliders,
  TrendingUp,
  Crosshair,
  Minus,
  PenTool,
  Type,
  Maximize,
  Compass,
  Magnet,
  Lock,
  Eye,
  Trash2,
} from "lucide-react";

interface TradingChartProps {
  markPrice: number;
  batchId: number;
  bidQty: number[];
  askQty: number[];
  onSelectPrice?: (price: number) => void;
}

export const TradingChart: React.FC<TradingChartProps> = ({
  markPrice,
  batchId,
  bidQty,
  askQty,
  onSelectPrice,
}) => {
  const [chartMode, setChartMode] = useState<"candles" | "fba">("candles");
  const [timeframe, setTimeframe] = useState<"1m" | "5m" | "15m" | "1h" | "4h" | "1D">("1h");
  const [priceRef, setPriceRef] = useState<"last" | "mark" | "index">("last");
  const [hoveredCandle, setHoveredCandle] = useState<number | null>(null);
  const [activeTool, setActiveTool] = useState<string>("crosshair");

  // Synthetic deterministic candlestick data centered on markPrice
  const candles = useMemo(() => {
    const list = [];
    let current = markPrice - 2.8;
    for (let i = 0; i < 48; i++) {
      const delta = Math.sin(i * 0.45) * 1.4 + (Math.cos(i * 0.75) * 0.9);
      const open = current;
      const close = open + delta;
      const high = Math.max(open, close) + Math.abs(Math.sin(i * 1.1)) * 0.7 + 0.1;
      const low = Math.min(open, close) - Math.abs(Math.cos(i * 0.9)) * 0.7 - 0.1;
      const isGreen = close >= open;
      const volume = Math.floor(Math.abs(delta) * 140 + 45);
      list.push({ i, open, high, low, close, isGreen, volume });
      current = close;
    }
    // Ensure the last candle closes at exact markPrice
    list[list.length - 1].close = markPrice;
    list[list.length - 1].high = Math.max(list[list.length - 1].high, markPrice + 0.2);
    list[list.length - 1].low = Math.min(list[list.length - 1].low, markPrice - 0.2);
    return list;
  }, [markPrice]);

  // Compute 20-period Moving Average
  const smaPoints = useMemo(() => {
    const period = 10;
    const points: Array<{ x: number; y: number }> = [];
    const minPrice = markPrice - 5;
    const maxPrice = markPrice + 5;
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
  }, [candles, markPrice]);

  const smaPath = useMemo(() => {
    if (smaPoints.length === 0) return "";
    let d = `M ${smaPoints[0].x} ${smaPoints[0].y}`;
    for (let i = 1; i < smaPoints.length; i++) {
      d += ` L ${smaPoints[i].x} ${smaPoints[i].y}`;
    }
    return d;
  }, [smaPoints]);

  // Active displayed candle stats
  const activeCandle = hoveredCandle !== null ? candles[hoveredCandle] : candles[candles.length - 1];

  // FBA Crossing Curve calculations for the "Depth / FBA Curve" tab
  const { cumulativeDemand, cumulativeSupply, eqTick, eqPrice, eqVol } = useMemo(() => {
    const k = 101;
    const demand = new Array(k).fill(0);
    const supply = new Array(k).fill(0);

    let dSum = 0;
    for (let t = k - 1; t >= 0; t--) {
      dSum += bidQty[t] || Math.floor(Math.sin((t / 50) * Math.PI) * 35 + 10);
      demand[t] = dSum;
    }

    let sSum = 0;
    for (let t = 0; t < k; t++) {
      sSum += askQty[t] || Math.floor(Math.sin(((100 - t) / 50) * Math.PI) * 35 + 10);
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
      cumulativeDemand: demand,
      cumulativeSupply: supply,
      eqTick: bestT,
      eqPrice: p,
      eqVol: maxM,
    };
  }, [bidQty, askQty, markPrice]);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#0e1217] border-r bp-border overflow-hidden select-none">
      {/* 1. CHART TOP TABS & CONTROLS (Backpack exact match) */}
      <div className="h-[38px] border-b bp-border bg-[#0e1217] flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-1 text-[12px]">
          <button
            onClick={() => setChartMode("candles")}
            className={`px-2.5 py-1 rounded transition-colors ${
              chartMode === "candles"
                ? "bg-[#181d24] font-semibold text-white shadow-sm"
                : "font-medium text-[#848e9c] hover:text-white"
            }`}
          >
            Chart
          </button>
          <button
            onClick={() => setChartMode("fba")}
            className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1.5 ${
              chartMode === "fba"
                ? "bg-[#181d24] font-semibold text-white shadow-sm"
                : "font-medium text-[#848e9c] hover:text-white"
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-[#00f0ff]" />
            <span>Depth & FBA Curve</span>
          </button>
          <button className="px-2.5 py-1 rounded font-medium text-[#848e9c] hover:text-white transition-colors hidden sm:block">
            Margin
          </button>
          <button className="px-2.5 py-1 rounded font-medium text-[#848e9c] hover:text-white transition-colors hidden sm:block">
            Funding
          </button>
          <button className="px-2.5 py-1 rounded font-medium text-[#848e9c] hover:text-white transition-colors hidden md:block">
            Market Info
          </button>
        </div>

        {/* Price Reference Switcher */}
        <div className="flex items-center p-0.5 rounded bg-[#12161c] border bp-border text-[10px] font-mono">
          <button
            onClick={() => setPriceRef("last")}
            className={`px-2 py-0.5 rounded transition-all ${
              priceRef === "last"
                ? "bg-[#1f2633] font-semibold text-white shadow-sm"
                : "text-[#848e9c] hover:text-white"
            }`}
          >
            Last
          </button>
          <button
            onClick={() => setPriceRef("mark")}
            className={`px-2 py-0.5 rounded transition-all ${
              priceRef === "mark"
                ? "bg-[#1f2633] font-semibold text-white shadow-sm"
                : "text-[#848e9c] hover:text-white"
            }`}
          >
            Mark
          </button>
          <button
            onClick={() => setPriceRef("index")}
            className={`px-2 py-0.5 rounded transition-all ${
              priceRef === "index"
                ? "bg-[#1f2633] font-semibold text-white shadow-sm"
                : "text-[#848e9c] hover:text-white"
            }`}
          >
            Index
          </button>
        </div>
      </div>

      {/* 2. TRADINGVIEW TOOLBAR STRIP */}
      <div className="h-[32px] border-b bp-border bg-[#0e1217] flex items-center justify-between px-3 shrink-0 text-[11px] text-[#848e9c] font-mono">
        <div className="flex items-center gap-2.5">
          {(["1m", "5m", "15m", "1h", "4h", "1D"] as const).map((tf) => (
            <span
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`cursor-pointer px-1 py-0.5 rounded transition-colors ${
                timeframe === tf ? "font-semibold text-white bg-[#181d24]" : "hover:text-white"
              }`}
            >
              {tf}
            </span>
          ))}

          <div className="w-[1px] h-3.5 bg-[#242b35] mx-0.5"></div>

          {/* Indicator Button */}
          <button className="flex items-center gap-1 text-[#848e9c] hover:text-white transition-colors">
            <span className="font-serif italic font-semibold text-[12px]">fx</span>
            <span className="text-[11px] font-sans">Indicators</span>
          </button>

          <span className="text-[#848e9c] hidden xl:inline">SMA (10)</span>
          <span className="text-[#848e9c] hidden 2xl:inline">EMA (20, 50)</span>
        </div>

        {/* Right Tools */}
        <div className="flex items-center gap-2.5 text-[11px]">
          <span className="text-[#0ecb81] font-semibold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0ecb81] animate-pulse"></span>
            Pyth Live
          </span>
          <button
            className="hover:text-white transition-colors text-[#848e9c]"
            title="Reset Chart View"
            onClick={() => setHoveredCandle(null)}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            className="hover:text-white transition-colors text-[#848e9c]"
            title="Take Snapshot"
          >
            <Camera className="w-3.5 h-3.5" />
          </button>
          <button
            className="hover:text-white transition-colors text-[#848e9c]"
            title="Toggle Fullscreen"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 3. MAIN WORKSPACE: DRAWING DOCK + CANVAS VIEW */}
      <div className="flex-1 flex min-h-0 bg-[#0e1217] relative overflow-hidden">
        {/* Left Drawing Tools Toolbar (Backpack / TradingView 1:1) */}
        <div className="w-[38px] border-r bp-border flex flex-col items-center py-2 gap-2 text-[#848e9c] shrink-0 bg-[#0e1217] z-20">
          <button
            onClick={() => setActiveTool("crosshair")}
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
              activeTool === "crosshair" ? "bg-[#181d24] text-white" : "hover:bg-[#161b22] hover:text-white"
            }`}
            title="Crosshair"
          >
            <Crosshair className="w-4 h-4" />
          </button>

          <button
            onClick={() => setActiveTool("trendline")}
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
              activeTool === "trendline" ? "bg-[#181d24] text-white" : "hover:bg-[#161b22] hover:text-white"
            }`}
            title="Trend Line"
          >
            <Minus className="w-4 h-4 rotate-45" />
          </button>

          <button
            onClick={() => setActiveTool("brush")}
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
              activeTool === "brush" ? "bg-[#181d24] text-white" : "hover:bg-[#161b22] hover:text-white"
            }`}
            title="Brush"
          >
            <PenTool className="w-4 h-4" />
          </button>

          <button
            onClick={() => setActiveTool("text")}
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
              activeTool === "text" ? "bg-[#181d24] text-white" : "hover:bg-[#161b22] hover:text-white"
            }`}
            title="Text Note"
          >
            <Type className="w-4 h-4" />
          </button>

          <button
            onClick={() => setActiveTool("measure")}
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
              activeTool === "measure" ? "bg-[#181d24] text-white" : "hover:bg-[#161b22] hover:text-white"
            }`}
            title="Measure"
          >
            <Compass className="w-4 h-4" />
          </button>

          <div className="w-4 h-[1px] bg-[#242b35] my-1"></div>

          <button
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#161b22] hover:text-white transition-colors"
            title="Magnet Mode"
          >
            <Magnet className="w-4 h-4" />
          </button>

          <button
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#161b22] hover:text-white transition-colors"
            title="Lock Drawings"
          >
            <Lock className="w-4 h-4" />
          </button>

          <button
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#161b22] hover:text-white transition-colors"
            title="Hide Drawings"
          >
            <Eye className="w-4 h-4" />
          </button>

          <button
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#161b22] hover:text-white transition-colors"
            title="Clear Chart Tools"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Main Canvas Viewport */}
        <div className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden bg-[#0e1217]">
          {chartMode === "candles" ? (
            <div className="w-full h-full flex flex-col min-h-0 relative select-none">
              {/* Floating Candle Stats Strip */}
              <div className="absolute top-2 left-3 z-10 flex flex-wrap items-center gap-x-3 text-[11px] font-mono pointer-events-none">
                <span className="text-[#f0f3f6] font-bold">SOL-PERP · {timeframe} · Epoch</span>
                <span className="w-1.5 h-1.5 rounded-full bg-[#0ecb81]"></span>
                <span className="text-[#848e9c]">
                  O <span className={activeCandle?.isGreen ? "text-[#0ecb81]" : "text-[#f6465d]"}>{activeCandle?.open.toFixed(2)}</span>
                </span>
                <span className="text-[#848e9c]">
                  H <span className={activeCandle?.isGreen ? "text-[#0ecb81]" : "text-[#f6465d]"}>{activeCandle?.high.toFixed(2)}</span>
                </span>
                <span className="text-[#848e9c]">
                  L <span className={activeCandle?.isGreen ? "text-[#0ecb81]" : "text-[#f6465d]"}>{activeCandle?.low.toFixed(2)}</span>
                </span>
                <span className="text-[#848e9c]">
                  C <span className={activeCandle?.isGreen ? "text-[#0ecb81]" : "text-[#f6465d]"}>{activeCandle?.close.toFixed(2)}</span>
                </span>
                <span className={activeCandle?.isGreen ? "text-[#0ecb81] font-semibold" : "text-[#f6465d] font-semibold"}>
                  {activeCandle && activeCandle.close >= activeCandle.open ? "+" : ""}
                  {(activeCandle ? activeCandle.close - activeCandle.open : 0).toFixed(2)}
                </span>
              </div>

              {/* Volume SMA Label */}
              <div className="absolute top-7 left-3 z-10 flex items-center gap-1.5 font-mono text-[10px] text-[#848e9c] pointer-events-none">
                <span>Volume SMA:</span>
                <span className="text-[#eab308]">79.38</span>
              </div>

              {/* SVG Candlestick & Volume Canvas */}
              <div className="flex-1 w-full h-full relative">
                <svg
                  viewBox="0 0 940 380"
                  className="w-full h-full"
                  preserveAspectRatio="none"
                  onClick={(e) => {
                    if (onSelectPrice) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const y = e.clientY - rect.top;
                      const pct = y / rect.height;
                      const minPrice = markPrice - 5;
                      const maxPrice = markPrice + 5;
                      const clickedPrice = maxPrice - pct * (maxPrice - minPrice);
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
                    const priceLabel = (markPrice + (3 - idx) * 1.5).toFixed(2);
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
                          fill="#848e9c"
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
                  <g opacity="0.5">
                    {candles.map((c, i) => {
                      const x = 20 + i * 17.5;
                      const h = Math.min(65, c.volume * 0.4);
                      return (
                        <rect
                          key={`vol-${i}`}
                          x={x}
                          y={340 - h}
                          width="11"
                          height={h}
                          fill={c.isGreen ? "#0ecb81" : "#f6465d"}
                          rx="1"
                        />
                      );
                    })}
                  </g>

                  {/* Moving Average Line (Yellow) */}
                  <path
                    d={smaPath}
                    fill="none"
                    stroke="#eab308"
                    strokeWidth="1.5"
                    opacity="0.8"
                  />

                  {/* Candlesticks */}
                  <g>
                    {candles.map((c, i) => {
                      const x = 20 + i * 17.5;
                      const candleMidX = x + 5.5;
                      const minPrice = markPrice - 5;
                      const maxPrice = markPrice + 5;
                      const scaleY = (p: number) =>
                        300 - ((p - minPrice) / (maxPrice - minPrice)) * 240;

                      const yHigh = scaleY(c.high);
                      const yLow = scaleY(c.low);
                      const yOpen = scaleY(c.open);
                      const yClose = scaleY(c.close);

                      const top = Math.min(yOpen, yClose);
                      const height = Math.max(3, Math.abs(yClose - yOpen));
                      const color = c.isGreen ? "#0ecb81" : "#f6465d";

                      return (
                        <g
                          key={`candle-${i}`}
                          onMouseEnter={() => setHoveredCandle(i)}
                          className="cursor-pointer"
                        >
                          {/* Wick */}
                          <line
                            x1={candleMidX}
                            y1={yHigh}
                            x2={candleMidX}
                            y2={yLow}
                            stroke={color}
                            strokeWidth="1.2"
                          />
                          {/* Body */}
                          <rect
                            x={x}
                            y={top}
                            width="11"
                            height={height}
                            fill={color}
                            rx="1"
                          />
                        </g>
                      );
                    })}
                  </g>

                  {/* Current Mark Price Horizontal Line */}
                  <line
                    x1="0"
                    y1="165"
                    x2="870"
                    y2="165"
                    stroke="#0ecb81"
                    strokeDasharray="3 3"
                    strokeWidth="1"
                    opacity="0.85"
                  />
                  {/* Current Price Beacon on right axis */}
                  <rect x="872" y="155" width="64" height="20" rx="2" fill="#00c087" />
                  <text
                    x="878"
                    y="169"
                    fill="#002114"
                    fontFamily="JetBrains Mono"
                    fontSize="11"
                    fontWeight="700"
                  >
                    {markPrice.toFixed(2)}
                  </text>
                </svg>
              </div>

              {/* Bottom Timeframe Range Strip */}
              <div className="h-[28px] border-t bp-border flex items-center justify-between px-3 text-[10px] font-mono text-[#848e9c] shrink-0 bg-[#0e1217]">
                <div className="flex items-center gap-3">
                  <span className="text-[#f0f3f6] font-semibold cursor-pointer">1D</span>
                  <span className="hover:text-white cursor-pointer">5D</span>
                  <span className="hover:text-white cursor-pointer">1M</span>
                  <span className="hover:text-white cursor-pointer">3M</span>
                  <span className="hover:text-white cursor-pointer">6M</span>
                  <span className="hover:text-white cursor-pointer">YTD</span>
                  <span className="hover:text-white cursor-pointer">1Y</span>
                  <span className="hover:text-white cursor-pointer">ALL</span>
                </div>
                <div className="flex items-center gap-4">
                  <span>29 30 Oct 2 3 15:00</span>
                  <span className="text-[#4b5563]">|</span>
                  <span>08:24:12 (UTC)</span>
                  <span className="hover:text-white cursor-pointer">%</span>
                  <span className="hover:text-white cursor-pointer">log</span>
                  <span className="text-[#0ecb81] font-semibold cursor-pointer">auto</span>
                </div>
              </div>
            </div>
          ) : (
            /* FBA BATCH CROSSING CURVE VIEW */
            <div className="w-full h-full flex flex-col min-h-0 relative select-none p-3">
              <div className="flex items-center justify-between px-2 py-1 font-mono text-[11px] border-b bp-border-subtle pb-2 mb-2">
                <span className="text-white font-bold flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-[#00f0ff]" />
                  Batch #{batchId} Uniform Crossing Curve
                </span>
                <span className="text-[#0ecb81]">
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
                  <text x="430" y="320" fill="#848e9c" fontSize="10" fontFamily="JetBrains Mono" textAnchor="middle">
                    0 bps (Mark ${markPrice.toFixed(2)})
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
                    stroke="#00f0ff"
                    strokeWidth="2.5"
                  />

                  {/* Supply Step Curve (Red) */}
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
                    stroke="#f6465d"
                    strokeWidth="2.5"
                  />

                  {/* Intersection Equilibrium Beacon */}
                  <line x1="440" y1="20" x2="440" y2="300" stroke="#0ecb81" strokeDasharray="4 4" strokeWidth="1.5" />
                  <circle cx="440" cy="165" r="5" fill="#0ecb81" stroke="#0e1217" strokeWidth="2" />
                </svg>
              </div>

              <div className="h-[28px] border-t bp-border flex items-center justify-between px-2 text-[10px] font-mono text-[#848e9c] shrink-0 mt-2">
                <span>Intra-batch sandwich MEV eliminated via single discrete clearing price.</span>
                <span className="text-[#00f0ff]">Grid: K=101 ticks · 1 bp offset spacing</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
