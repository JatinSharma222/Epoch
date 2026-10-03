"use client";

import React, { useState, useMemo } from "react";
import { Zap, Activity } from "lucide-react";

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
  const [timeframe, setTimeframe] = useState<"1m" | "5m" | "15m" | "1h" | "1D">("1h");
  const [priceRef, setPriceRef] = useState<"last" | "mark" | "index">("last");

  // Synthetic deterministic candlestick data centered on markPrice
  const candles = useMemo(() => {
    const list = [];
    let current = markPrice - 2.4;
    for (let i = 0; i < 48; i++) {
      const delta = Math.sin(i * 0.45) * 1.2 + (Math.cos(i * 0.8) * 0.8);
      const open = current;
      const close = open + delta;
      const high = Math.max(open, close) + Math.random() * 0.6;
      const low = Math.min(open, close) - Math.random() * 0.6;
      const isGreen = close >= open;
      const volume = Math.floor(Math.abs(delta) * 120 + 35);
      list.push({ i, open, high, low, close, isGreen, volume });
      current = close;
    }
    // Ensure the last candle closes at exact markPrice
    list[list.length - 1].close = markPrice;
    return list;
  }, [markPrice]);

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
                ? "bg-[#181d24] font-semibold text-white"
                : "font-medium text-[#848e9c] hover:text-white"
            }`}
          >
            Chart
          </button>
          <button
            onClick={() => setChartMode("fba")}
            className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1 ${
              chartMode === "fba"
                ? "bg-[#181d24] font-semibold text-white"
                : "font-medium text-[#848e9c] hover:text-white"
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-[#00f0ff]" />
            <span>FBA Crossing Curve</span>
          </button>
          <button className="px-2.5 py-1 rounded font-medium text-[#848e9c] hover:text-white transition-colors hidden sm:block">
            Margin
          </button>
          <button className="px-2.5 py-1 rounded font-medium text-[#848e9c] hover:text-white transition-colors hidden sm:block">
            Funding
          </button>
        </div>

        {/* Price Reference Switcher */}
        <div className="flex items-center p-0.5 rounded bg-[#12161c] border bp-border text-[10px] font-mono">
          <button
            onClick={() => setPriceRef("last")}
            className={`px-2 py-0.5 rounded ${
              priceRef === "last" ? "bg-[#1f2633] font-medium text-white" : "text-[#848e9c] hover:text-white"
            }`}
          >
            Last
          </button>
          <button
            onClick={() => setPriceRef("mark")}
            className={`px-2 py-0.5 rounded ${
              priceRef === "mark" ? "bg-[#1f2633] font-medium text-white" : "text-[#848e9c] hover:text-white"
            }`}
          >
            Mark
          </button>
          <button
            onClick={() => setPriceRef("index")}
            className={`px-2 py-0.5 rounded ${
              priceRef === "index" ? "bg-[#1f2633] font-medium text-white" : "text-[#848e9c] hover:text-white"
            }`}
          >
            Index
          </button>
        </div>
      </div>

      {/* 2. TIMEFRAME & TOOLBAR STRIP */}
      <div className="h-[32px] border-b bp-border bg-[#0e1217] flex items-center justify-between px-3 shrink-0 text-[11px] text-[#848e9c] font-mono">
        <div className="flex items-center gap-3">
          {(["1m", "5m", "15m", "1h", "1D"] as const).map((tf) => (
            <span
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`cursor-pointer transition-colors ${
                timeframe === tf ? "font-semibold text-white" : "hover:text-white"
              }`}
            >
              {tf}
            </span>
          ))}
          <div className="w-[1px] h-3 bg-[#242b35]"></div>
          <span className="text-[#848e9c]">Indicators</span>
          <span className="text-[#848e9c] hidden md:inline">EMA 20/50</span>
        </div>

        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-[#0ecb81] font-semibold">● Live Feed</span>
          <span className="text-[#848e9c] hidden lg:inline">Pyth SOL/USD</span>
        </div>
      </div>

      {/* 3. MAIN CANVAS AREA */}
      <div className="flex-1 relative bg-[#0e1217] overflow-hidden flex flex-col justify-between">
        {chartMode === "candles" ? (
          /* TRADINGVIEW STYLE CANDLESTICK CHART */
          <div className="w-full h-full flex flex-col min-h-0 relative select-none">
            {/* Candle stats header */}
            <div className="absolute top-2 left-3 z-10 flex flex-wrap items-center gap-x-3 text-[11px] font-mono pointer-events-none">
              <span className="text-white font-bold">SOL-PERP · {timeframe} · Epoch</span>
              <span className="text-[#848e9c]">
                O <span className="text-[#0ecb81]">{(markPrice - 0.45).toFixed(2)}</span>
              </span>
              <span className="text-[#848e9c]">
                H <span className="text-[#0ecb81]">{(markPrice + 0.65).toFixed(2)}</span>
              </span>
              <span className="text-[#848e9c]">
                L <span className="text-[#0ecb81]">{(markPrice - 0.75).toFixed(2)}</span>
              </span>
              <span className="text-[#848e9c]">
                C <span className="text-[#0ecb81]">{markPrice.toFixed(2)}</span>
              </span>
              <span className="text-[#0ecb81] font-semibold">+2.45%</span>
            </div>

            {/* SVG Candlestick & Volume Canvas */}
            <div className="flex-1 w-full h-full relative">
              <svg
                viewBox="0 0 940 380"
                className="w-full h-full"
                preserveAspectRatio="none"
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
                <g opacity="0.45">
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
                      />
                    );
                  })}
                </g>

                {/* Candlesticks */}
                <g>
                  {candles.map((c, i) => {
                    const x = 20 + i * 17.5;
                    const candleMidX = x + 5.5;
                    const minPrice = markPrice - 5;
                    const maxPrice = markPrice + 5;
                    const scaleY = (p: number) =>
                      310 - ((p - minPrice) / (maxPrice - minPrice)) * 260;

                    const yHigh = scaleY(c.high);
                    const yLow = scaleY(c.low);
                    const yOpen = scaleY(c.open);
                    const yClose = scaleY(c.close);

                    const top = Math.min(yOpen, yClose);
                    const height = Math.max(3, Math.abs(yClose - yOpen));
                    const color = c.isGreen ? "#0ecb81" : "#f6465d";

                    return (
                      <g key={`candle-${i}`}>
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

                {/* Current Price Horizontal Beacon */}
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

            {/* Timeframe range bar */}
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
                <span>08:24:12 (UTC)</span>
                <span className="text-[#0ecb81] font-semibold cursor-pointer">auto</span>
              </div>
            </div>
          </div>
        ) : (
          /* FBA BATCH CROSSING CURVE VIEW */
          <div className="w-full h-full flex flex-col min-h-0 relative select-none p-2">
            <div className="flex items-center justify-between px-2 py-1 font-mono text-[11px]">
              <span className="text-white font-bold flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-[#00f0ff]" />
                Batch #{batchId} Uniform Crossing Curve
              </span>
              <span className="text-[#0ecb81]">Equilibrium: ${eqPrice.toFixed(3)} · {eqVol} Lots</span>
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
          </div>
        )}
      </div>
    </div>
  );
};
