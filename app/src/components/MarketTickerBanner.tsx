"use client";

import React from "react";

interface TickerItem {
  symbol: string;
  price: string;
  change: string;
  isPositive: boolean;
}

const TICKERS: TickerItem[] = [
  { symbol: "SOL-PERP", price: "$150.04", change: "+2.4%", isPositive: true },
  { symbol: "BTC-PERP", price: "$64,280.50", change: "+1.8%", isPositive: true },
  { symbol: "ETH-PERP", price: "$2,642.10", change: "-0.4%", isPositive: false },
  { symbol: "JUP-PERP", price: "$0.884", change: "+5.2%", isPositive: true },
  { symbol: "BONK-PERP", price: "$0.0000214", change: "+4.8%", isPositive: true },
  { symbol: "WIF-PERP", price: "$2.14", change: "-1.3%", isPositive: false },
  { symbol: "RENDER-PERP", price: "$5.62", change: "+3.1%", isPositive: true },
  { symbol: "PYTH-PERP", price: "$0.342", change: "+0.9%", isPositive: true },
  { symbol: "TIA-PERP", price: "$5.84", change: "-2.1%", isPositive: false },
  { symbol: "SUI-PERP", price: "$1.92", change: "+6.4%", isPositive: true },
  { symbol: "INJ-PERP", price: "$21.15", change: "+1.2%", isPositive: true },
  { symbol: "NEAR-PERP", price: "$4.95", change: "-0.8%", isPositive: false },
];

export const MarketTickerBanner: React.FC = () => {
  return (
    <div className="h-[26px] bg-[#080a0d] border-b bp-border flex items-center overflow-hidden shrink-0 z-50 select-none text-[11px] font-mono">
      <div className="flex items-center gap-1.5 px-2.5 h-full bg-[#0e1217] border-r bp-border shrink-0 z-10 text-[10px] uppercase font-semibold text-[#848e9c]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#0ecb81] animate-pulse"></span>
        <span>Markets</span>
      </div>

      <div className="flex overflow-hidden whitespace-nowrap group">
        <div className="flex items-center gap-6 animate-marquee group-hover:[animation-play-state:paused] py-0.5">
          {TICKERS.concat(TICKERS).map((t, idx) => (
            <div
              key={`${t.symbol}-${idx}`}
              className="inline-flex items-center gap-2 hover:bg-[#12161c] px-2 py-0.5 rounded cursor-pointer transition-colors"
            >
              <span className="text-[#e1e2e7] font-semibold">{t.symbol}</span>
              <span className="text-white font-medium">{t.price}</span>
              <span
                className={`text-[10px] px-1 py-[1px] rounded ${
                  t.isPositive
                    ? "text-[#0ecb81] bg-[#0ecb81]/10"
                    : "text-[#f6465d] bg-[#f6465d]/10"
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
