"use client";

import React, { useState, useMemo } from "react";
import { clear, clearingPrice, computeMatchedHighlights, TickHighlight } from "../lib/clearingEngine";
import { BookRow } from "../lib/marketData";
import { Layers, ExternalLink } from "lucide-react";

export interface OrderBookProps {
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
  const [activeTab, setActiveTab] = useState<"batch_book" | "reference_market">("batch_book");
  const [zoomRange, setZoomRange] = useState<number>(21);

  // Execute client-side reference clearing auction
  const clearResult = useMemo(() => {
    return clear(bidQty, askQty);
  }, [bidQty, askQty]);

  // Compute matched volume highlights
  const highlights = useMemo(() => {
    return computeMatchedHighlights(bidQty, askQty, clearResult, 101);
  }, [bidQty, askQty, clearResult]);

  // Total order volume in batch
  const totalBatchLots = useMemo(() => {
    const b = bidQty.reduce((acc, q) => acc + q, 0);
    const a = askQty.reduce((acc, q) => acc + q, 0);
    return b + a;
  }, [bidQty, askQty]);

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

  // Max lots for depth heatmap scaling
  const maxDepthLots = useMemo(() => {
    let m = 1;
    visibleTicks.forEach((r) => {
      if (r.bidLots > m) m = r.bidLots;
      if (r.askLots > m) m = r.askLots;
    });
    return m;
  }, [visibleTicks]);

  const handleRowClick = (price: number, offsetBps: number) => {
    if (onSelectPrice) onSelectPrice(price);
    if (onSelectOffset) onSelectOffset(offsetBps);
  };

  return (
    <div className="w-[280px] xl:w-[310px] hidden lg:flex flex-col min-h-0 bg-surface-header border-r border-line-default select-none font-mono text-2xs">
      {/* Header Tabs: Epoch Batch Book vs External Reference Depth */}
      <div className="h-[36px] border-b border-line-default flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("batch_book")}
            className={`pb-2 pt-2 -mb-px transition-colors font-medium flex items-center gap-1.5 ${
              activeTab === "batch_book"
                ? "text-content-primary border-b-2 border-trade-cyan font-semibold"
                : "text-content-muted hover:text-content-primary"
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-trade-cyan" />
            <span>Batch #{currentBatchId}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("reference_market")}
            className={`pb-2 pt-2 -mb-px transition-colors font-medium flex items-center gap-1 ${
              activeTab === "reference_market"
                ? "text-content-primary border-b-2 border-trade-amber font-semibold"
                : "text-content-muted hover:text-content-primary"
            }`}
            title="External CEX reference prices for comparison only"
          >
            <span>Reference</span>
            <span className="text-[9px] px-1 py-px rounded bg-surface-card text-content-muted border border-line-default">
              L2
            </span>
          </button>
        </div>

        {/* Zoom selector */}
        {activeTab === "batch_book" && (
          <div className="flex items-center gap-1 text-2xs text-content-muted">
            <span className="text-[9px]">±{Math.floor(zoomRange / 2)}bp</span>
            <select
              value={zoomRange}
              onChange={(e) => setZoomRange(Number(e.target.value))}
              aria-label="Select tick zoom range"
              className="bg-surface-card border border-line-default rounded px-1 py-0.5 text-content-primary outline-none cursor-pointer text-2xs"
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
          {/* Indicative match status banner */}
          <div className="px-3 py-1.5 bg-surface-card border-b border-line-default flex items-center justify-between text-2xs">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-trade-cyan animate-pulse" />
              <span className="text-content-primary font-medium">
                {clearResult && clearResult.matched > 0
                  ? `Would match: ${(clearResult.matched * 0.001).toFixed(2)} SOL`
                  : "No match yet"}
              </span>
            </div>
            <div className="text-2xs text-content-muted">
              {clearResult && clearResult.matched > 0 ? (
                <span className="text-trade-cyan font-bold">
                  P* ${indicativePrice.toFixed(3)}
                </span>
              ) : (
                <span>{totalBatchLots === 0 ? "Batch empty" : "Bids below asks"}</span>
              )}
            </div>
          </div>

          {/* Ladder Column Headers */}
          <div className="grid grid-cols-3 px-3 py-1 text-2xs text-content-muted border-b border-line-default font-sans font-medium">
            <span className="text-left text-trade-emerald">Bid Sz (SOL)</span>
            <span className="text-center">Price / Offset</span>
            <span className="text-right text-trade-coral">Ask Sz (SOL)</span>
          </div>

          {/* Overlapping Batch Ladder */}
          {totalBatchLots === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-content-muted space-y-2">
              <div className="w-9 h-9 rounded-full bg-surface-card border border-line-default flex items-center justify-center text-trade-cyan">
                <Layers className="w-4 h-4" />
              </div>
              <div className="text-content-primary font-semibold text-xs">
                No orders in current batch
              </div>
              <p className="text-2xs text-content-muted max-w-[200px]">
                Batch #{currentBatchId} has no active orders. Place an order on the ticket to seed the batch auction book.
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-white/[0.02]">
              {visibleTicks.map((row) => {
                const isClearing = row.highlight.isClearingLine;
                const bidStatus = row.highlight.bidStatus;
                const askStatus = row.highlight.askStatus;

                // Cumulative depth bar percentage
                const bidPct = Math.min(100, Math.round((row.bidLots / maxDepthLots) * 100));
                const askPct = Math.min(100, Math.round((row.askLots / maxDepthLots) * 100));

                return (
                  <div
                    key={row.tick}
                    onClick={() => handleRowClick(row.price, row.offsetBps)}
                    className={`grid grid-cols-3 px-2 py-0.5 items-center cursor-pointer transition-colors relative ${
                      isClearing
                        ? "bg-trade-cyan/10 border-y border-trade-cyan/50 shadow-xs"
                        : "hover:bg-surface-hover"
                    }`}
                  >
                    {/* Background Cumulative Heatmap Bars */}
                    {row.bidLots > 0 && (
                      <div
                        className="absolute left-0 top-0 bottom-0 bg-trade-emerald/10 pointer-events-none transition-all duration-150"
                        style={{ width: `${Math.min(33, bidPct * 0.33)}%` }}
                      />
                    )}
                    {row.askLots > 0 && (
                      <div
                        className="absolute right-0 top-0 bottom-0 bg-trade-coral/10 pointer-events-none transition-all duration-150"
                        style={{ width: `${Math.min(33, askPct * 0.33)}%` }}
                      />
                    )}

                    {/* Left: Bid Cell */}
                    <div className="flex items-center gap-1 relative z-1">
                      {row.userBidLots > 0 && (
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-trade-emerald shrink-0 shadow-xs ring-1 ring-trade-emerald"
                          title={`Your buy order: ${(row.userBidLots * 0.001).toFixed(2)} SOL`}
                        />
                      )}
                      <div
                        className={`flex-1 px-1 py-0.5 rounded text-left tabular-nums ${
                          bidStatus === "matched"
                            ? "border border-trade-emerald bg-trade-emerald/15 text-trade-emerald font-semibold"
                            : bidStatus === "marginal"
                            ? "border border-dashed border-trade-emerald bg-trade-emerald/10 text-trade-emerald"
                            : row.bidLots > 0
                            ? "text-trade-emerald"
                            : "text-content-muted/30"
                        }`}
                      >
                        {row.bidLots > 0 ? (
                          <div className="flex items-center justify-between">
                            <span>{(row.bidLots * 0.001).toFixed(2)}</span>
                            {bidStatus === "marginal" && (
                              <span className="text-[9px] font-sans font-bold bg-trade-emerald/30 px-1 rounded ml-1 text-trade-emerald">
                                {row.highlight.bidMarginalPct.toFixed(0)}%
                              </span>
                            )}
                          </div>
                        ) : (
                          "—"
                        )}
                      </div>
                    </div>

                    {/* Center: Price & Offset */}
                    <div className="flex flex-col items-center justify-center text-center relative z-1">
                      <span
                        className={`tabular-nums font-semibold ${
                          isClearing
                            ? "text-trade-cyan font-bold"
                            : row.offsetBps === 0
                            ? "text-content-primary"
                            : row.offsetBps > 0
                            ? "text-trade-emerald/90"
                            : "text-trade-coral/90"
                        }`}
                      >
                        ${row.price.toFixed(2)}
                      </span>
                      <span className="text-[9px] text-content-muted tabular-nums leading-none">
                        {row.offsetBps >= 0 ? `+${row.offsetBps}` : row.offsetBps} bp
                      </span>
                    </div>

                    {/* Right: Ask Cell */}
                    <div className="flex items-center gap-1 justify-end relative z-1">
                      <div
                        className={`flex-1 px-1 py-0.5 rounded text-right tabular-nums ${
                          askStatus === "matched"
                            ? "border border-trade-coral bg-trade-coral/15 text-trade-coral font-semibold"
                            : askStatus === "marginal"
                            ? "border border-dashed border-trade-coral bg-trade-coral/10 text-trade-coral"
                            : row.askLots > 0
                            ? "text-trade-coral"
                            : "text-content-muted/30"
                        }`}
                      >
                        {row.askLots > 0 ? (
                          <div className="flex items-center justify-between">
                            {askStatus === "marginal" && (
                              <span className="text-[9px] font-sans font-bold bg-trade-coral/30 px-1 rounded mr-1 text-trade-coral">
                                {row.highlight.askMarginalPct.toFixed(0)}%
                              </span>
                            )}
                            <span className="ml-auto">{(row.askLots * 0.001).toFixed(2)}</span>
                          </div>
                        ) : (
                          "—"
                        )}
                      </div>
                      {row.userAskLots > 0 && (
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-trade-coral shrink-0 shadow-xs ring-1 ring-trade-coral"
                          title={`Your sell order: ${(row.userAskLots * 0.001).toFixed(2)} SOL`}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer note: Clearing notation */}
          <div className="px-3 py-1.5 bg-surface-header border-t border-line-default text-[10px] text-content-muted flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 border border-trade-emerald bg-trade-emerald/20 inline-block rounded-xs" />
              <span>Solid = matched</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 border border-dashed border-trade-emerald bg-trade-emerald/10 inline-block rounded-xs" />
              <span>Dashed = marginal %</span>
            </div>
          </div>
        </div>
      ) : (
        /* Reference Depth (Binance L2) */
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-2 bg-surface-card border-b border-line-default text-2xs text-content-muted flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-semibold text-trade-amber">
              <ExternalLink className="w-3.5 h-3.5 text-trade-amber" />
              REFERENCE DEPTH (Binance L2)
            </span>
            <span className="text-trade-emerald font-mono">Live WebSocket</span>
          </div>

          <div className="grid grid-cols-3 px-3 py-1 text-2xs text-content-muted border-b border-line-default font-sans font-medium">
            <span>Price (USD)</span>
            <span className="text-right">Size (SOL)</span>
            <span className="text-right">Total (SOL)</span>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 text-2xs">
            {/* Asks (descending) */}
            <div className="flex flex-col">
              {dynamicAsks
                .slice(0, 10)
                .reverse()
                .map((a, i) => (
                  <div
                    key={`ref-ask-${i}`}
                    onClick={() => handleRowClick(a.price, 0)}
                    className="grid grid-cols-3 px-3 py-0.5 hover:bg-surface-hover cursor-pointer tabular-nums"
                  >
                    <span className="text-trade-coral font-medium">${a.price.toFixed(2)}</span>
                    <span className="text-right text-content-primary">{a.lots.toFixed(1)}</span>
                    <span className="text-right text-content-muted">{a.cumulative.toFixed(1)}</span>
                  </div>
                ))}
            </div>

            {/* Mid reference price */}
            <div className="py-1 px-3 my-0.5 bg-surface-card border-y border-line-default flex items-center justify-between text-2xs font-bold">
              <span className="text-content-primary font-mono">${oraclePrice.toFixed(2)}</span>
              <span className="text-[10px] text-content-muted font-sans font-normal">
                Binance Mid
              </span>
            </div>

            {/* Bids */}
            <div className="flex flex-col">
              {dynamicBids.slice(0, 10).map((b, i) => (
                <div
                  key={`ref-bid-${i}`}
                  onClick={() => handleRowClick(b.price, 0)}
                  className="grid grid-cols-3 px-3 py-0.5 hover:bg-surface-hover cursor-pointer tabular-nums"
                >
                  <span className="text-trade-emerald font-medium">${b.price.toFixed(2)}</span>
                  <span className="text-right text-content-primary">{b.lots.toFixed(1)}</span>
                  <span className="text-right text-content-muted">{b.cumulative.toFixed(1)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
