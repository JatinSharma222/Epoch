"use client";

import React, { useState, useMemo } from "react";
import { BookRow } from "../lib/marketData";

interface OrderBookProps {
  oraclePrice: number;
  bidQty: number[];
  askQty: number[];
  dynamicBids?: BookRow[];
  dynamicAsks?: BookRow[];
  dynamicBidRatio?: number;
  onSelectOffset?: (offsetBps: number) => void;
  onSelectPrice?: (price: number) => void;
}

export const OrderBook: React.FC<OrderBookProps> = ({
  oraclePrice,
  bidQty,
  askQty,
  dynamicBids,
  dynamicAsks,
  dynamicBidRatio,
  onSelectOffset,
  onSelectPrice,
}) => {
  const [activeTab, setActiveTab] = useState<"book" | "trades">("book");
  const [depthMode, setDepthMode] = useState<"both" | "bids" | "asks">("both");
  const [precision, setPrecision] = useState<"0.01" | "0.05" | "0.10">("0.01");

  // Asks: Use live Binance/Pyth depth if available, otherwise synthetic offset grid
  const asks = useMemo(() => {
    if (dynamicAsks && dynamicAsks.length > 0) {
      return [...dynamicAsks].reverse(); // Asks displayed descending
    }
    const list = [];
    let cumulative = 0;
    for (let offset = 1; offset <= 10; offset++) {
      const tick = 50 + offset;
      const lots = askQty[tick] || Math.floor(Math.sin(offset * 0.7) * 400 + 800);
      cumulative += lots;
      const price = oraclePrice * (1 + offset / 10_000);
      list.push({ offset, tick, price, lots, cumulative });
    }
    return list.reverse();
  }, [dynamicAsks, askQty, oraclePrice]);

  // Bids: Use live Binance/Pyth depth if available, otherwise synthetic offset grid
  const bids = useMemo(() => {
    if (dynamicBids && dynamicBids.length > 0) {
      return dynamicBids;
    }
    const list = [];
    let cumulative = 0;
    for (let offset = -1; offset >= -10; offset--) {
      const tick = 50 + offset;
      const lots = bidQty[tick] || Math.floor(Math.cos(offset * 0.7) * 400 + 800);
      cumulative += lots;
      const price = oraclePrice * (1 + offset / 10_000);
      list.push({ offset, tick, price, lots, cumulative });
    }
    return list;
  }, [dynamicBids, bidQty, oraclePrice]);

  const maxTotal = useMemo(() => {
    const maxA = asks[0]?.cumulative || 1000;
    const maxB = bids[bids.length - 1]?.cumulative || 1000;
    return Math.max(maxA, maxB);
  }, [asks, bids]);

  const bidRatio = dynamicBidRatio ?? 60;

  // Recent live tape trades
  const recentTrades = useMemo(() => {
    const trades = [];
    let p = oraclePrice;
    for (let i = 0; i < 16; i++) {
      const isBuy = i % 2 === 0;
      p += isBuy ? 0.01 : -0.01;
      const size = (Math.random() * 25 + 1.5).toFixed(2);
      const time = new Date(Date.now() - i * 1800).toLocaleTimeString();
      trades.push({ id: i, price: p, size, isBuy, time });
    }
    return trades;
  }, [oraclePrice]);

  const handleRowClick = (price: number, offset: number) => {
    if (onSelectPrice) onSelectPrice(price);
    if (onSelectOffset) onSelectOffset(offset);
  };

  return (
    <div className="w-[280px] xl:w-[290px] hidden lg:flex flex-col min-h-0 bg-[#0e1217] border-r bp-border select-none font-mono text-[11px]">
      {/* Book / Trades Tabs & Controls (Backpack 1:1 match) */}
      <div className="h-[38px] border-b bp-border flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-4 text-[12px]">
          <button
            onClick={() => setActiveTab("book")}
            className={`pb-2.5 pt-2 -mb-[1px] transition-colors ${
              activeTab === "book"
                ? "font-bold text-white border-b-2 border-white"
                : "font-medium text-[#848e9c] hover:text-white"
            }`}
          >
            Book
          </button>
          <button
            onClick={() => setActiveTab("trades")}
            className={`pb-2.5 pt-2 -mb-[1px] transition-colors ${
              activeTab === "trades"
                ? "font-bold text-white border-b-2 border-white"
                : "font-medium text-[#848e9c] hover:text-white"
            }`}
          >
            Trades
          </button>
        </div>

        {activeTab === "book" && (
          <div className="flex items-center gap-2.5 text-[#848e9c]">
            {/* Depth display switcher */}
            <div className="flex items-center gap-1.5 cursor-pointer">
              <button
                onClick={() => setDepthMode("both")}
                className={`w-3.5 h-3.5 flex flex-col justify-between py-0.5 rounded transition-opacity ${
                  depthMode === "both" ? "opacity-100" : "opacity-40 hover:opacity-80"
                }`}
                title="Default: Bids and Asks"
              >
                <span className="h-[2px] bg-[#f6465d] w-full rounded-sm"></span>
                <span className="h-[2px] bg-[#0ecb81] w-full rounded-sm"></span>
              </button>
              <button
                onClick={() => setDepthMode("bids")}
                className={`w-3.5 h-3.5 flex flex-col justify-center py-0.5 rounded transition-opacity ${
                  depthMode === "bids" ? "opacity-100" : "opacity-40 hover:opacity-80"
                }`}
                title="Bids only"
              >
                <span className="h-[3px] bg-[#0ecb81] w-full rounded-sm"></span>
              </button>
              <button
                onClick={() => setDepthMode("asks")}
                className={`w-3.5 h-3.5 flex flex-col justify-center py-0.5 rounded transition-opacity ${
                  depthMode === "asks" ? "opacity-100" : "opacity-40 hover:opacity-80"
                }`}
                title="Asks only"
              >
                <span className="h-[3px] bg-[#f6465d] w-full rounded-sm"></span>
              </button>
            </div>

            <div className="w-[1px] h-3 bg-[#242b35]"></div>

            {/* Grouping Selector */}
            <button
              onClick={() => {
                const next = precision === "0.01" ? "0.05" : precision === "0.05" ? "0.10" : "0.01";
                setPrecision(next);
              }}
              className="px-1.5 py-0.5 rounded bg-[#12161c] border bp-border text-[10px] text-[#848e9c] hover:text-white transition-colors"
              title="Tick size precision"
            >
              {precision}
            </button>
          </div>
        )}
      </div>

      {activeTab === "trades" ? (
        /* RECENT TRADES LIST */
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="grid grid-cols-3 px-3 py-1.5 text-[10px] font-mono text-[#848e9c] border-b bp-border-subtle">
            <span>Price (USD)</span>
            <span className="text-right">Size (SOL)</span>
            <span className="text-right">Time</span>
          </div>
          <div className="flex-1 overflow-y-auto px-1 divide-y bp-border-subtle">
            {recentTrades.map((t) => (
              <div
                key={t.id}
                onClick={() => onSelectPrice && onSelectPrice(t.price)}
                className="grid grid-cols-3 px-2 py-1 hover:bg-[#161b22] cursor-pointer text-[11px]"
              >
                <span className={`tabular-nums ${t.isBuy ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                  {t.price.toFixed(2)}
                </span>
                <span className="text-right text-[#f0f3f6] tabular-nums">{t.size}</span>
                <span className="text-right text-[#848e9c] text-[10px] tabular-nums">{t.time}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* ORDER BOOK LADDER */
        <div className="flex-1 flex flex-col justify-between overflow-hidden">
          {/* Table Column Headers */}
          <div className="grid grid-cols-3 px-3 py-1.5 text-[10px] font-mono text-[#848e9c] border-b bp-border-subtle shrink-0">
            <span>Price (USD)</span>
            <span className="text-right">Size (SOL)</span>
            <span className="text-right">Total (SOL)</span>
          </div>

          <div
            className="flex-1 flex flex-col justify-between overflow-hidden font-mono text-[11px] leading-[18px]"
            style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}
          >
            {/* ASKS (RED) */}
            {(depthMode === "both" || depthMode === "asks") && (
              <div className="flex flex-col justify-end overflow-hidden flex-1 px-1">
                {asks.slice(depthMode === "asks" ? 0 : 2).map((a, idx) => {
                  const depthPct = Math.min(100, Math.round((a.cumulative / maxTotal) * 100));
                  return (
                    <div
                      key={`ask-${a.price}-${idx}`}
                      onClick={() => handleRowClick(a.price, a.offset)}
                      className="grid grid-cols-3 px-2 py-[1px] relative hover:bg-[#161b22] cursor-pointer group"
                    >
                      <div
                        className="absolute inset-y-0 right-0 bg-[#f6465d]/12 pointer-events-none transition-all duration-150 group-hover:bg-[#f6465d]/20"
                        style={{ width: `${depthPct}%` }}
                      />
                      <span className="text-[#f6465d] relative tabular-nums">{a.price.toFixed(2)}</span>
                      <span className="text-right text-[#f0f3f6] relative tabular-nums">
                        {a.lots.toLocaleString()}
                      </span>
                      <span className="text-right text-[#848e9c] relative tabular-nums">
                        {a.cumulative.toLocaleString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* SPREAD / CURRENT BATCH CLEARING (Backpack Exact Row) */}
            <div className="py-1 px-3 bg-[#13171d] border-y bp-border flex items-center justify-between shrink-0 my-0.5">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold text-white tabular-nums">
                  ${oraclePrice.toFixed(2)}
                </span>
                <span className="text-[10px] text-[#848e9c]">Index</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-[#0ecb81]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0ecb81] animate-pulse"></span>
                <span>FBA 0.01 Spread</span>
              </div>
            </div>

            {/* BIDS (GREEN) */}
            {(depthMode === "both" || depthMode === "bids") && (
              <div className="flex flex-col justify-start overflow-hidden flex-1 px-1">
                {bids.slice(0, depthMode === "bids" ? 10 : 8).map((b, idx) => {
                  const depthPct = Math.min(100, Math.round((b.cumulative / maxTotal) * 100));
                  return (
                    <div
                      key={`bid-${b.price}-${idx}`}
                      onClick={() => handleRowClick(b.price, b.offset)}
                      className="grid grid-cols-3 px-2 py-[1px] relative hover:bg-[#161b22] cursor-pointer group"
                    >
                      <div
                        className="absolute inset-y-0 right-0 bg-[#0ecb81]/12 pointer-events-none transition-all duration-150 group-hover:bg-[#0ecb81]/20"
                        style={{ width: `${depthPct}%` }}
                      />
                      <span className="text-[#0ecb81] relative tabular-nums">{b.price.toFixed(2)}</span>
                      <span className="text-right text-[#f0f3f6] relative tabular-nums">
                        {b.lots.toLocaleString()}
                      </span>
                      <span className="text-right text-[#848e9c] relative tabular-nums">
                        {b.cumulative.toLocaleString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* BOTTOM DEPTH RATIO BAR */}
            <div className="px-3 py-1.5 border-t bp-border shrink-0 bg-[#0e1217]">
              <div className="w-full h-1 rounded-full overflow-hidden flex bg-[#161b22]">
                <div
                  className="bg-[#0ecb81] h-full transition-all duration-300"
                  style={{ width: `${bidRatio}%` }}
                ></div>
                <div
                  className="bg-[#f6465d] h-full transition-all duration-300"
                  style={{ width: `${100 - bidRatio}%` }}
                ></div>
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono text-[#848e9c] mt-1">
                <span className="text-[#0ecb81] tabular-nums">{bidRatio}% Buy</span>
                <span className="text-[#f6465d] tabular-nums">{100 - bidRatio}% Sell</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
