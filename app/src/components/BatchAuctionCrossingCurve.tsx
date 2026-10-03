"use client";

import React, { useState, useMemo } from "react";
import { Info, ShieldAlert, Zap } from "lucide-react";

interface BatchAuctionCrossingCurveProps {
  batchId: number;
  oraclePrice: number; // e.g. 150.04
  bidQty: number[]; // length 101
  askQty: number[]; // length 101
  clearingPrice?: number;
  matchedLots?: number;
}

export const BatchAuctionCrossingCurve: React.FC<BatchAuctionCrossingCurveProps> = ({
  batchId,
  oraclePrice,
  bidQty,
  askQty,
  clearingPrice,
  matchedLots,
}) => {
  const [hoveredTick, setHoveredTick] = useState<number | null>(null);

  // Compute cumulative supply and demand vectors across K=101 ticks
  const { cumulativeDemand, cumulativeSupply, equilibriumTick, equilibriumVolume, equilibriumPrice } = useMemo(() => {
    const k = 101;
    const demand = new Array(k).fill(0);
    const supply = new Array(k).fill(0);

    // Cumulative Demand D[t] = sum of bids at tick >= t
    let dSum = 0;
    for (let t = k - 1; t >= 0; t--) {
      dSum += bidQty[t] || 0;
      demand[t] = dSum;
    }

    // Cumulative Supply S[t] = sum of asks at tick <= t
    let sSum = 0;
    for (let t = 0; t < k; t++) {
      sSum += askQty[t] || 0;
      supply[t] = sSum;
    }

    // Find intersection tick where min(D[t], S[t]) is maximized
    let maxMatched = 0;
    let eqTick = 50; // default center tick
    for (let t = 0; t < k; t++) {
      const match = Math.min(demand[t], supply[t]);
      if (match > maxMatched) {
        maxMatched = match;
        eqTick = t;
      }
    }

    // If clearingPrice passed from on-chain, use it, else compute from eqTick
    const offsetBps = eqTick - 50;
    const calcPrice = oraclePrice * (1 + offsetBps / 10_000);

    return {
      cumulativeDemand: demand,
      cumulativeSupply: supply,
      equilibriumTick: eqTick,
      equilibriumVolume: matchedLots ?? maxMatched,
      equilibriumPrice: clearingPrice ?? calcPrice,
    };
  }, [bidQty, askQty, oraclePrice, clearingPrice, matchedLots]);

  // Max volume for Y-axis scaling
  const maxVolume = useMemo(() => {
    const maxD = Math.max(...cumulativeDemand, 10);
    const maxS = Math.max(...cumulativeSupply, 10);
    return Math.max(maxD, maxS) * 1.15;
  }, [cumulativeDemand, cumulativeSupply]);

  // SVG dimensions
  const width = 800;
  const height = 360;
  const padding = { top: 30, right: 30, bottom: 45, left: 60 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // Coordinate mapping
  const getX = (tick: number) => padding.left + (tick / 100) * chartW;
  const getY = (val: number) => padding.top + chartH - (val / maxVolume) * chartH;

  // Build step-line path for Demand
  const demandPath = useMemo(() => {
    let path = `M ${getX(0)} ${getY(cumulativeDemand[0])}`;
    for (let t = 1; t < 101; t++) {
      const prevX = getX(t - 1);
      const currX = getX(t);
      const prevY = getY(cumulativeDemand[t - 1]);
      const currY = getY(cumulativeDemand[t]);
      // Step line: horizontal to currX, then vertical to currY
      path += ` L ${currX} ${prevY} L ${currX} ${currY}`;
    }
    return path;
  }, [cumulativeDemand, maxVolume]);

  // Build step-line path for Supply
  const supplyPath = useMemo(() => {
    let path = `M ${getX(0)} ${getY(cumulativeSupply[0])}`;
    for (let t = 1; t < 101; t++) {
      const currX = getX(t);
      const prevY = getY(cumulativeSupply[t - 1]);
      const currY = getY(cumulativeSupply[t]);
      path += ` L ${currX} ${prevY} L ${currX} ${currY}`;
    }
    return path;
  }, [cumulativeSupply, maxVolume]);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#0e1217] relative select-none">
      {/* Top Controls Bar */}
      <div className="h-[38px] border-b bp-border bg-[#0e1217] flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="font-bold text-white tracking-tight flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-[#00f0ff]" />
            Batch Auction Crossing Curve
          </span>
          <span className="text-[10px] font-mono px-1.5 py-[1px] rounded bg-[#161b22] text-[#848e9c] border bp-border">
            Batch #{batchId}
          </span>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-[11px] font-mono">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-[#00f0ff]"></span>
            <span className="text-[#848e9c]">Demand D[t]</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-[#f6465d]"></span>
            <span className="text-[#848e9c]">Supply S[t]</span>
          </div>
          <div className="flex items-center gap-1.5 pl-2 border-l bp-border">
            <span className="text-[#0ecb81] font-semibold">
              Equilibrium: {equilibriumTick - 50 > 0 ? `+${equilibriumTick - 50}` : equilibriumTick - 50} bps
            </span>
          </div>
        </div>
      </div>

      {/* Main Interactive SVG Chart */}
      <div className="flex-1 relative w-full h-full min-h-[340px] p-2 flex items-center justify-center">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full max-h-[440px]"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="demandFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#00f0ff" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="supplyFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f6465d" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#f6465d" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => (
            <g key={i}>
              <line
                x1={padding.left}
                y1={padding.top + chartH * (1 - pct)}
                x2={width - padding.right}
                y2={padding.top + chartH * (1 - pct)}
                stroke="rgba(255, 255, 255, 0.04)"
                strokeDasharray="2 2"
              />
              <text
                x={padding.left - 8}
                y={padding.top + chartH * (1 - pct) + 4}
                fill="#848e9c"
                fontSize="10"
                fontFamily="JetBrains Mono"
                textAnchor="end"
              >
                {Math.round(maxVolume * pct)}
              </text>
            </g>
          ))}

          {/* Center Tick Mark line (Offset 0 bps) */}
          <line
            x1={getX(50)}
            y1={padding.top}
            x2={getX(50)}
            y2={padding.top + chartH}
            stroke="rgba(255, 255, 255, 0.15)"
            strokeDasharray="3 3"
          />
          <text
            x={getX(50)}
            y={height - 10}
            fill="#848e9c"
            fontSize="10"
            fontFamily="JetBrains Mono"
            textAnchor="middle"
          >
            0 bps (Mark ${oraclePrice.toFixed(2)})
          </text>

          {/* Boundaries: -50 bps and +50 bps */}
          <text
            x={getX(0)}
            y={height - 10}
            fill="#848e9c"
            fontSize="10"
            fontFamily="JetBrains Mono"
            textAnchor="start"
          >
            -50 bps (${(oraclePrice * 0.995).toFixed(2)})
          </text>
          <text
            x={getX(100)}
            y={height - 10}
            fill="#848e9c"
            fontSize="10"
            fontFamily="JetBrains Mono"
            textAnchor="end"
          >
            +50 bps (${(oraclePrice * 1.005).toFixed(2)})
          </text>

          {/* Demand Curve (Cyan) */}
          <path
            d={demandPath}
            fill="none"
            stroke="#00f0ff"
            strokeWidth="2.5"
            strokeLinecap="round"
          />

          {/* Supply Curve (Red) */}
          <path
            d={supplyPath}
            fill="none"
            stroke="#f6465d"
            strokeWidth="2.5"
            strokeLinecap="round"
          />

          {/* Equilibrium Beacon Line */}
          {equilibriumVolume > 0 && (
            <g>
              <line
                x1={getX(equilibriumTick)}
                y1={padding.top}
                x2={getX(equilibriumTick)}
                y2={padding.top + chartH}
                stroke="#0ecb81"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
              <circle
                cx={getX(equilibriumTick)}
                cy={getY(equilibriumVolume)}
                r="5"
                fill="#0ecb81"
                stroke="#0e1217"
                strokeWidth="2"
              />
            </g>
          )}
        </svg>

        {/* Floating Uniform Clearing Price Beacon Card */}
        <div className="absolute top-4 right-5 p-3 rounded-lg bg-[#12161c]/95 border bp-border shadow-2xl backdrop-blur-md font-mono text-[11px] pointer-events-none min-w-[200px]">
          <div className="flex items-center justify-between text-[#848e9c] pb-1 border-b bp-border-subtle">
            <span>Uniform Price (p*)</span>
            <span className="text-[#0ecb81] font-bold text-[13px]">
              ${equilibriumPrice.toFixed(3)}
            </span>
          </div>
          <div className="flex items-center justify-between py-1 text-[#848e9c]">
            <span>Matched Volume (Q*)</span>
            <span className="text-white font-semibold">{equilibriumVolume} Lots</span>
          </div>
          <div className="flex items-center justify-between py-1 text-[#848e9c]">
            <span>Clearing Offset</span>
            <span className="text-[#00f0ff] font-medium">
              {equilibriumTick - 50 > 0 ? `+${equilibriumTick - 50}` : equilibriumTick - 50} bps
            </span>
          </div>
          <div className="mt-2 pt-1.5 border-t bp-border-subtle flex items-center gap-1.5 text-[9px] text-[#0ecb81]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0ecb81]"></span>
            <span>Intra-Batch Sandwich MEV Eliminated</span>
          </div>
        </div>
      </div>

      {/* Bottom Educational Banner */}
      <div className="h-[28px] border-t bp-border bg-[#0b0e11] px-3 flex items-center justify-between text-[10px] font-mono text-[#848e9c] shrink-0">
        <span className="flex items-center gap-1.5">
          <Info className="w-3 h-3 text-[#00f0ff]" />
          All orders within Batch #{batchId} execute simultaneously at the exact uniform crossing price.
        </span>
        <span className="text-[#0ecb81] font-medium">
          Grid: K=101 ticks · 1 bp interval · Center tick c=50
        </span>
      </div>
    </div>
  );
};
