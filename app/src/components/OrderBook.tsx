"use client";

import React, { useState, useMemo } from "react";
import { clear, clearingPrice, computeMatchedHighlights, TickHighlight } from "../lib/clearingEngine";
import { BookRow } from "../lib/marketData";
import { Eye, Info, Layers, ExternalLink } from "lucide-react";

interface OrderBookProps {
  currentBatchId: number;
  oraclePrice: number;
  bidQty: number[];
  askQty: number[];
  userOrders?: Array<{
    batchId: number;
    slotId: number;
    side: "BUY" | "SELL";
    tickOffset: number;
    lots: number;
  }>;
  dynamicBids?: BookRow[];
  dynamicAsks?: BookRow[];
  onSelectOffset?: (offsetBps: number) => void;
  onSelectPrice?: (price: number) => void;
}

export const OrderBook: React.FC<OrderBookProps> = ({
  currentBatchId,
  oraclePrice,
  bidQty,
  askQty,
  userOrders = [],
  dynamicBids = [],
  dynamicAsks = [],
  onSelectOffset,
  onSelectPrice,
}) => {
  // Tabs: Primary is Batch Auction Book (09 §3.3), Secondary is Reference Market (Binance)
  const [activeTab, setActiveTab] = useState<"batch_book" | "reference_market">("batch_book");
  // Zoom window: how many 1 bp ticks around center/clearing to display
  const [zoomRange, setZoomRange] = useState<number>(21); // 21 rows = ±10 bps

  // Execute client-side reference clearing auction (09 §3.3 & T-29)
  const clearResult = useMemo(() => {
    return clear(bidQty, askQty);
  }, [bidQty, askQty]);

  // Compute matched volume highlights
  const highlights = useMemo(() => {
    return computeMatchedHighlights(bidQty, askQty, clearResult, 101);
  }, [bidQty, askQty, clearResult]);

  // Indicative clearing price
  const indicativePrice = useMemo(() => {
    if (!clearResult) return oraclePrice;
    return (
      clearingPrice(
        Math.round(oraclePrice * 1_000_000),
        clearResult.tick,
        101,
        1,
        1000
      ) / 1_000_000
    );
  }, [clearResult, oraclePrice]);

  // Visible tick range around the active clearing/center tick
  const visibleTicks = useMemo(() => {
    const center = clearResult ? clearResult.tick : 50;
    const half = Math.floor(zoomRange / 2);
    let start = Math.max(0, center - half);
    let end = Math.min(100, center + half);

    // Ensure fixed count
    if (end - start + 1 < zoomRange) {
      if (start === 0) end = Math.min(100, start + zoomRange - 1);
      else if (end === 100) start = Math.max(0, end - zoomRange + 1);
    }

    const rows: Array<{
      tick: number;
      offsetBps: number;
      price: number;
      bidLots: number;
      askLots: number;
      highlight: TickHighlight;
      userBidLots: number;
      userAskLots: number;
    }> = [];

    // Highest price at top, lowest price at bottom
    for (let t = end; t >= start; t--) {
      const offsetBps = t - 50;
      const price = oraclePrice * (1 + offsetBps / 10_000);
      const bLots = bidQty[t] || 0;
      const aLots = askQty[t] || 0;

      const userBid = userOrders
        .filter((o) => o.side === "BUY" && o.tickOffset === offsetBps)
        .reduce((sum, o) => sum + o.lots, 0);
      const userAsk = userOrders
        .filter((o) => o.side === "SELL" && o.tickOffset === offsetBps)
        .reduce((sum, o) => sum + o.lots, 0);

      rows.push({
        tick: t,
        offsetBps,
        price,
        bidLots: bLots,
        askLots: aLots,
        highlight: highlights[t],
        userBidLots: userBid,
        userAskLots: userAsk,
      });
    }

    return rows;
  }, [clearResult, zoomRange, oraclePrice, bidQty, askQty, highlights, userOrders]);

  const handleRowClick = (price: number, offsetBps: number) => {
    if (onSelectPrice) onSelectPrice(price);
    if (onSelectOffset) onSelectOffset(offsetBps);
  };

  return (
    <div className="w-[300px] xl:w-[320px] hidden lg:flex flex-col min-h-0 bg-[#0e1217] border-r bp-border select-none font-mono text-[11px]">
      {/* Header Tabs: 09 §6 Epoch Chain vs Reference Market */}
      <div className="h-[38px] border-b bp-border flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-3 text-[12px]">
          <button
            onClick={() => setActiveTab("batch_book")}
            className={`pb-2.5 pt-2 -mb-[1px] transition-colors font-medium flex items-center gap-1.5 ${
              activeTab === "batch_book"
                ? "text-white border-b-2 border-[#00f0ff] font-semibold"
                : "text-[#848e9c] hover:text-white"
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-[#00f0ff]" />
            <span>Batch #{currentBatchId}</span>
          </button>
          <button
            onClick={() => setActiveTab("reference_market")}
            className={`pb-2.5 pt-2 -mb-[1px] transition-colors font-medium flex items-center gap-1 ${
              activeTab === "reference_market"
                ? "text-white border-b-2 border-[#eab308] font-semibold"
                : "text-[#848e9c] hover:text-white"
            }`}
            title="External CEX reference prices for comparison only (09 §6)"
          >
            <span>Reference</span>
            <span className="text-[9px] px-1 py-[0.5px] rounded bg-[#181d24] text-[#848e9c] border bp-border">
              Binance
            </span>
          </button>
        </div>

        {/* Zoom selector */}
        {activeTab === "batch_book" && (
          <div className="flex items-center gap-1 text-[10px] text-[#848e9c]">
            <span className="text-[9px]">±{Math.floor(zoomRange / 2)}bp</span>
            <select
              value={zoomRange}
              onChange={(e) => setZoomRange(Number(e.target.value))}
              aria-label="Select tick zoom range"
              className="bg-[#12161c] border bp-border rounded px-1 py-0.5 text-white outline-none cursor-pointer"
            >
              <option value={15}>15 ticks</option>
              <option value={21}>21 ticks</option>
              <option value={31}>31 ticks</option>
              <option value={51}>51 ticks</option>
            </select>
          </div>
        )}
      </div>

      {activeTab === "batch_book" ? (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Indicative match status banner (09 §3.3) */}
          <div className="px-3 py-2 bg-[#12161c] border-b bp-border flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00f0ff] animate-pulse"></span>
              <span className="text-white font-medium">
                {clearResult && clearResult.matched > 0
                  ? `Would match: ${(clearResult.matched * 0.001).toFixed(2)} SOL`
                  : "No match yet"}
              </span>
            </div>
            <div className="text-[10px] text-[#848e9c]">
              {clearResult && clearResult.matched > 0 ? (
                <span className="text-[#00f0ff] font-semibold">
                  P* ${indicativePrice.toFixed(3)}
                </span>
              ) : (
                <span>Bids below asks</span>
              )}
            </div>
          </div>

          {/* Ladder Column Headers (09 §3.3: Bid sz, Price, Ask sz) */}
          <div className="grid grid-cols-3 px-3 py-1.5 text-[10px] text-[#848e9c] border-b bp-border font-sans font-medium">
            <span className="text-left text-[#0ecb81]">Bid Sz (SOL)</span>
            <span className="text-center">Price / Offset</span>
            <span className="text-right text-[#f6465d]">Ask Sz (SOL)</span>
          </div>

          {/* Overlapping Batch Ladder (09 §3.3) */}
          <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-white/[0.02]">
            {visibleTicks.map((row) => {
              const isClearing = row.highlight.isClearingLine;
              const bidStatus = row.highlight.bidStatus;
              const askStatus = row.highlight.askStatus;

              return (
                <div
                  key={row.tick}
                  onClick={() => handleRowClick(row.price, row.offsetBps)}
                  className={`grid grid-cols-3 px-2 py-1 items-center cursor-pointer transition-colors relative ${
                    isClearing
                      ? "bg-[#00f0ff]/10 border-y border-[#00f0ff]/40"
                      : "hover:bg-white/[0.04]"
                  }`}
                >
                  {/* Left: Bid Cell */}
                  <div className="flex items-center gap-1">
                    {row.userBidLots > 0 && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-[#0ecb81] shrink-0"
                        title={`Your buy order: ${(row.userBidLots * 0.001).toFixed(2)} SOL`}
                      />
                    )}
                    <div
                      className={`flex-1 px-1.5 py-0.5 rounded text-left tabular-nums ${
                        bidStatus === "matched"
                          ? "border border-[#0ecb81] bg-[#0ecb81]/15 text-[#0ecb81] font-semibold"
                          : bidStatus === "marginal"
                          ? "border border-dashed border-[#0ecb81] bg-[#0ecb81]/10 text-[#0ecb81]"
                          : row.bidLots > 0
                          ? "text-[#0ecb81]"
                          : "text-[#848e9c]/30"
                      }`}
                    >
                      {row.bidLots > 0 ? (
                        <div className="flex items-center justify-between">
                          <span>{(row.bidLots * 0.001).toFixed(2)}</span>
                          {bidStatus === "marginal" && (
                            <span className="text-[9px] font-sans font-bold bg-[#0ecb81]/30 px-1 rounded ml-1">
                              {row.highlight.bidMarginalPct.toFixed(0)}%
                            </span>
                          )}
                        </div>
                      ) : (
                        "-"
                      )}
                    </div>
                  </div>

                  {/* Center: Price & Offset */}
                  <div className="flex flex-col items-center justify-center text-center">
                    <span
                      className={`tabular-nums font-semibold ${
                        isClearing
                          ? "text-[#00f0ff]"
                          : row.offsetBps === 0
                          ? "text-white"
                          : row.offsetBps > 0
                          ? "text-[#0ecb81]/80"
                          : "text-[#f6465d]/80"
                      }`}
                    >
                      ${row.price.toFixed(2)}
                    </span>
                    <span className="text-[9px] text-[#848e9c] tabular-nums leading-none">
                      {row.offsetBps >= 0 ? `+${row.offsetBps}` : row.offsetBps} bp
                    </span>
                  </div>

                  {/* Right: Ask Cell */}
                  <div className="flex items-center gap-1 justify-end">
                    <div
                      className={`flex-1 px-1.5 py-0.5 rounded text-right tabular-nums ${
                        askStatus === "matched"
                          ? "border border-[#f6465d] bg-[#f6465d]/15 text-[#f6465d] font-semibold"
                          : askStatus === "marginal"
                          ? "border border-dashed border-[#f6465d] bg-[#f6465d]/10 text-[#f6465d]"
                          : row.askLots > 0
                          ? "text-[#f6465d]"
                          : "text-[#848e9c]/30"
                      }`}
                    >
                      {row.askLots > 0 ? (
                        <div className="flex items-center justify-between">
                          {askStatus === "marginal" && (
                            <span className="text-[9px] font-sans font-bold bg-[#f6465d]/30 px-1 rounded mr-1">
                              {row.highlight.askMarginalPct.toFixed(0)}%
                            </span>
                          )}
                          <span className="ml-auto">{(row.askLots * 0.001).toFixed(2)}</span>
                        </div>
                      ) : (
                        "-"
                      )}
                    </div>
                    {row.userAskLots > 0 && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-[#f6465d] shrink-0"
                        title={`Your sell order: ${(row.userAskLots * 0.001).toFixed(2)} SOL`}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer note: Indicative disclaimer (09 §3.3) */}
          <div className="px-3 py-2 bg-[#0b0e11] border-t bp-border text-[10px] text-[#848e9c] flex items-center justify-between">
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 border border-[#0ecb81] inline-block"></span>
              <span>Solid = matched</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 border border-dashed border-[#0ecb81] inline-block"></span>
              <span>Dashed = marginal pro-rata</span>
            </div>
          </div>
        </div>
      ) : (
        /* Reference Market (Binance Live Depth) - Clearly labeled (09 §6) */
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-2.5 bg-[#12161c] border-b bp-border text-[10px] text-[#848e9c] flex items-center justify-between">
            <span className="flex items-center gap-1">
              <ExternalLink className="w-3 h-3 text-[#eab308]" />
              Reference market (Binance)
            </span>
            <span className="text-[#0ecb81] font-mono">Live WebSocket</span>
          </div>

          <div className="grid grid-cols-3 px-3 py-1.5 text-[10px] text-[#848e9c] border-b bp-border font-sans font-medium">
            <span>Price (USD)</span>
            <span className="text-right">Size (SOL)</span>
            <span className="text-right">Total (SOL)</span>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 text-[11px]">
            {/* Asks (descending) */}
            <div className="flex flex-col">
              {dynamicAsks.slice(0, 10).reverse().map((a, i) => (
                <div
                  key={`ref-ask-${i}`}
                  onClick={() => handleRowClick(a.price, 0)}
                  className="grid grid-cols-3 px-3 py-0.5 hover:bg-white/[0.04] cursor-pointer tabular-nums"
                >
                  <span className="text-[#f6465d]">${a.price.toFixed(2)}</span>
                  <span className="text-right text-[#b7bdc6]">{a.lots.toFixed(1)}</span>
                  <span className="text-right text-[#848e9c]">{a.cumulative.toFixed(1)}</span>
                </div>
              ))}
            </div>

            {/* Mid reference price */}
            <div className="py-1 px-3 my-1 bg-[#12161c] border-y bp-border flex items-center justify-between text-[11px] font-bold">
              <span className="text-white font-mono">${oraclePrice.toFixed(2)}</span>
              <span className="text-[10px] text-[#848e9c] font-sans font-normal">
                Binance Mid
              </span>
            </div>

            {/* Bids */}
            <div className="flex flex-col">
              {dynamicBids.slice(0, 10).map((b, i) => (
                <div
                  key={`ref-bid-${i}`}
                  onClick={() => handleRowClick(b.price, 0)}
                  className="grid grid-cols-3 px-3 py-0.5 hover:bg-white/[0.04] cursor-pointer tabular-nums"
                >
                  <span className="text-[#0ecb81]">${b.price.toFixed(2)}</span>
                  <span className="text-right text-[#b7bdc6]">{b.lots.toFixed(1)}</span>
                  <span className="text-right text-[#848e9c]">{b.cumulative.toFixed(1)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
