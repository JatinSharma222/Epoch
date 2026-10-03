"use client";

import React, { useState, useEffect } from "react";
import { fetchLiveTickers, MarketTicker } from "../lib/marketData";

export const MarketTickerBanner: React.FC = () => {
  const [tickers, setTickers] = useState<MarketTicker[]>([]);

  useEffect(() => {
    let mounted = true;

    const loadTickers = async () => {
      const data = await fetchLiveTickers();
      if (mounted && data.length > 0) {
        setTickers(data);
      }
    };

    loadTickers();
    const interval = setInterval(loadTickers, 8000); // Poll live prices every 8s

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const displayList = tickers.length > 0 ? tickers : [];
  const doubledTickers = [...displayList, ...displayList];

  return (
    <div
      className="h-[28px] bg-[#0B0E11] border-b bp-border flex items-center overflow-hidden shrink-0 z-50 select-none"
      role="marquee"
      aria-label="Live market prices"
    >
      {/* Static left badge */}
      <div className="flex items-center gap-1.5 px-2.5 h-full bg-[#0e1217] border-r bp-border shrink-0 z-10 text-[10px] uppercase tracking-wider font-semibold text-[#848e9c]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#0ECB81] animate-pulse" />
        <span>Markets</span>
      </div>

      {/* Scrolling ticker strip */}
      <div className="flex-1 overflow-hidden whitespace-nowrap">
        <div className="flex items-center gap-6 animate-marquee hover:[animation-play-state:paused] py-0.5">
          {doubledTickers.map((t, idx) => (
            <div
              key={`${t.symbol}-${idx}`}
              className="inline-flex items-center gap-2 hover:bg-[#12161c] px-2 py-0.5 rounded cursor-pointer transition-colors font-mono text-[11px]"
            >
              <span className="text-[#B7BDC6] font-semibold">{t.symbol}</span>
              <span className="text-white font-medium tabular-nums">{t.price}</span>
              <span
                className={`text-[10px] px-1 py-[1px] rounded tabular-nums font-medium ${
                  t.isPositive
                    ? "text-[#0ECB81] bg-[#0ECB81]/10"
                    : "text-[#F6465D] bg-[#F6465D]/10"
                }`}
              >
                {t.change}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
