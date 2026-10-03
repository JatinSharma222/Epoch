"use client";

import React from "react";

interface TickerItem {
  symbol: string;
  price: string;
  change: string;
  isPositive: boolean;
}

const TICKERS: TickerItem[] = [
  { symbol: "SOL-PERP", price: "$150.04", change: "+2.45%", isPositive: true },
  { symbol: "BTC-PERP", price: "$64,280.50", change: "+1.82%", isPositive: true },
  { symbol: "ETH-PERP", price: "$2,642.10", change: "-0.41%", isPositive: false },
  { symbol: "JUP-PERP", price: "$0.884", change: "+5.22%", isPositive: true },
  { symbol: "PYTH-PERP", price: "$0.342", change: "+0.93%", isPositive: true },
  { symbol: "JTO-PERP", price: "$2.41", change: "-1.27%", isPositive: false },
  { symbol: "TIA-PERP", price: "$5.84", change: "-2.11%", isPositive: false },
  { symbol: "SUI-PERP", price: "$1.92", change: "+6.38%", isPositive: true },
  { symbol: "INJ-PERP", price: "$21.15", change: "+1.18%", isPositive: true },
  { symbol: "NEAR-PERP", price: "$4.95", change: "-0.82%", isPositive: false },
  { symbol: "RENDER-PERP", price: "$5.62", change: "+3.14%", isPositive: true },
  { symbol: "WIF-PERP", price: "$2.14", change: "+4.81%", isPositive: true },
];

export const MarketTickerBanner: React.FC = () => {
  // Double the list for seamless infinite loop
  const doubledTickers = [...TICKERS, ...TICKERS];

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
