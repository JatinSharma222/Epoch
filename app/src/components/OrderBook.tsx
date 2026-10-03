"use client";

import React, { useMemo } from "react";

interface OrderBookProps {
  oraclePrice: number;
  bidQty: number[];
  askQty: number[];
  onSelectOffset?: (offsetBps: number) => void;
}

export const OrderBook: React.FC<OrderBookProps> = ({
  oraclePrice,
  bidQty,
  askQty,
  onSelectOffset,
}) => {
  // Aggregate top 8 asks (ticks 51..58)
  const asks = useMemo(() => {
    const list = [];
    let cumulative = 0;
    for (let offset = 1; offset <= 8; offset++) {
      const tick = 50 + offset;
      const lots = askQty[tick] || Math.floor(Math.sin(offset) * 20 + 25);
      cumulative += lots;
      const price = oraclePrice * (1 + offset / 10_000);
      list.push({ offset, tick, price, lots, cumulative });
    }
    return list.reverse(); // Asks displayed descending
  }, [askQty, oraclePrice]);

  // Aggregate top 8 bids (ticks 49..42)
  const bids = useMemo(() => {
    const list = [];
    let cumulative = 0;
    for (let offset = -1; offset >= -8; offset--) {
      const tick = 50 + offset;
      const lots = bidQty[tick] || Math.floor(Math.cos(offset) * 20 + 25);
      cumulative += lots;
      const price = oraclePrice * (1 + offset / 10_000);
      list.push({ offset, tick, price, lots, cumulative });
    }
    return list;
  }, [bidQty, oraclePrice]);

  const maxTotal = useMemo(() => {
    const maxA = asks[0]?.cumulative || 100;
    const maxB = bids[bids.length - 1]?.cumulative || 100;
    return Math.max(maxA, maxB);
  }, [asks, bids]);

  const totalBids = bids.reduce((acc, b) => acc + b.lots, 0);
  const totalAsks = asks.reduce((acc, a) => acc + a.lots, 0);
  const bidRatio = Math.round((totalBids / (totalBids + totalAsks || 1)) * 100);

  return (
    <div className="w-[260px] hidden lg:flex flex-col min-h-0 bg-[#0e1217] border-r bp-border select-none font-mono text-[11px]">
      {/* Header */}
      <div className="h-[38px] border-b bp-border flex items-center justify-between px-3 shrink-0">
        <span className="font-bold text-white text-[12px]">Order Book</span>
        <span className="text-[10px] text-[#848e9c]">1 bp Tick Grid</span>
      </div>

      {/* Table Headers */}
      <div className="grid grid-cols-3 px-3 py-1.5 text-[10px] text-[#848e9c] border-b bp-border-subtle">
        <span>Price (USD)</span>
        <span className="text-right">Size (Lots)</span>
        <span className="text-right">Total (Lots)</span>
      </div>

      {/* Ladder Container */}
      <div className="flex-1 flex flex-col justify-between overflow-hidden">
        {/* ASKS (RED) */}
        <div className="flex flex-col justify-end overflow-hidden flex-1 px-1">
          {asks.map((a) => {
            const depthPct = Math.min(100, (a.cumulative / maxTotal) * 100);
            return (
              <div
                key={`ask-${a.tick}`}
                onClick={() => onSelectOffset && onSelectOffset(a.offset)}
                className="grid grid-cols-3 px-2 py-[2px] relative hover:bg-[#161b22] cursor-pointer"
              >
                <div
                  className="absolute inset-y-0 right-0 bg-[#f6465d]/10 pointer-events-none"
                  style={{ width: `${depthPct}%` }}
                />
                <span className="text-[#f6465d] relative">{a.price.toFixed(3)}</span>
                <span className="text-right text-[#f0f3f6] relative">{a.lots}</span>
                <span className="text-right text-[#848e9c] relative">{a.cumulative}</span>
              </div>
            );
          })}
        </div>

        {/* MID SPREAD ROW */}
        <div className="py-1 px-3 bg-[#13171d] border-y bp-border flex items-center justify-between shrink-0 my-0.5">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-bold text-white">${oraclePrice.toFixed(2)}</span>
            <span className="text-[10px] text-[#848e9c]">Oracle Mark</span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-[#0ecb81]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0ecb81]"></span>
            <span>Uniform FBA</span>
          </div>
        </div>

        {/* BIDS (GREEN) */}
        <div className="flex flex-col justify-start overflow-hidden flex-1 px-1">
          {bids.map((b) => {
            const depthPct = Math.min(100, (b.cumulative / maxTotal) * 100);
            return (
              <div
                key={`bid-${b.tick}`}
                onClick={() => onSelectOffset && onSelectOffset(b.offset)}
                className="grid grid-cols-3 px-2 py-[2px] relative hover:bg-[#161b22] cursor-pointer"
              >
                <div
                  className="absolute inset-y-0 right-0 bg-[#0ecb81]/10 pointer-events-none"
                  style={{ width: `${depthPct}%` }}
                />
                <span className="text-[#0ecb81] relative">{b.price.toFixed(3)}</span>
                <span className="text-right text-[#f0f3f6] relative">{b.lots}</span>
                <span className="text-right text-[#848e9c] relative">{b.cumulative}</span>
              </div>
            );
          })}
        </div>

        {/* BOTTOM DEPTH RATIO BAR */}
        <div className="px-3 py-1.5 border-t bp-border shrink-0 bg-[#0e1217]">
          <div className="w-full h-1 rounded-full overflow-hidden flex bg-[#161b22]">
            <div className="bg-[#0ecb81] h-full" style={{ width: `${bidRatio}%` }}></div>
            <div className="bg-[#f6465d] h-full" style={{ width: `${100 - bidRatio}%` }}></div>
          </div>
          <div className="flex items-center justify-between text-[10px] text-[#848e9c] mt-1">
            <span className="text-[#0ecb81]">{bidRatio}% Buy</span>
            <span className="text-[#f6465d]">{100 - bidRatio}% Sell</span>
          </div>
        </div>
      </div>
    </div>
  );
};
