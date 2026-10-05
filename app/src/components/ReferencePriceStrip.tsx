"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { fetchLiveTickers, MarketTicker } from "../lib/marketData";

const ICON_MAP: Record<string, string> = {
  "SOL": "/icons/sol.svg",
  "BTC": "/icons/btc.svg",
  "ETH": "/icons/eth.svg",
  "JUP": "/icons/jup.svg",
  "PYTH": "/icons/pyth.svg",
  "JTO": "/icons/jto.svg",
  "TIA": "/icons/tia.svg",
  "SUI": "/icons/sui.svg",
  "INJ": "/icons/inj.svg",
  "NEAR": "/icons/near.svg",
  "RENDER": "/icons/render.svg",
  "WIF": "/icons/sol.svg",
};

export const ReferencePriceStrip: React.FC = () => {
  const [tickers, setTickers] = useState<MarketTicker[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  const [isStale, setIsStale] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;

    const loadTickers = async () => {
      try {
        const data = await fetchLiveTickers();
        if (mounted && data.length > 0) {
          setTickers(data);
          setLastUpdated(Date.now());
          setIsStale(false);
        }
      } catch {
        // Handled via stale timer
      }
    };

    loadTickers();
    const pollInterval = setInterval(loadTickers, 4000); // Poll every 4 seconds

    // Stale check interval: older than 30s turns grey (09 §3.4)
    const staleInterval = setInterval(() => {
      if (Date.now() - lastUpdated > 30000) {
        setIsStale(true);
      }
    }, 2000);

    return () => {
      mounted = false;
      clearInterval(pollInterval);
      clearInterval(staleInterval);
    };
  }, [lastUpdated]);

  const displayList = tickers.length > 0 ? tickers : [];
  const doubledTickers = [...displayList, ...displayList];

  return (
    <div
      className={`h-[28px] border-b bp-border flex items-center overflow-hidden shrink-0 z-40 select-none transition-colors ${
        isStale ? "bg-[#121417] opacity-60 text-gray-500" : "bg-[#0B0E11]"
      }`}
      role="region"
      aria-label="Reference Prices"
    >
      {/* Static Left Badge (09 §3.4) */}
      <div className="flex items-center gap-1.5 px-2.5 h-full bg-[#0E1217] border-r bp-border shrink-0 z-10 text-[10px] uppercase tracking-wider font-semibold text-[#848E9C]">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            isStale ? "bg-[#848E9C]" : "bg-[#0ECB81] animate-pulse"
          }`}
        />
        <span>REFERENCE PRICES</span>
        {isStale && (
          <span className="text-[9px] px-1 py-[0.5px] rounded bg-[#272A2E] text-[#EAB308] font-mono">
            STALE
          </span>
        )}
      </div>

      {/* Scrolling / Static Ticker Strip (09 §3.4 & §3.5 rule 8: Plain symbols SOL, NEAR, etc.) */}
      <div className="flex-1 overflow-hidden whitespace-nowrap">
        <div className="flex items-center gap-6 animate-marquee motion-reduce:animate-none hover:[animation-play-state:paused] py-0.5">
          {doubledTickers.map((t, idx) => {
            const rawSymbol = t.symbol || "";
            const plainSymbol = rawSymbol.replace("-PERP", "");
            const isSol = plainSymbol === "SOL";
            const iconPath = ICON_MAP[plainSymbol] || "/icons/sol.svg";

            return (
              <div
                key={`${t.symbol}-${idx}`}
                title={
                  isSol
                    ? "Active Epoch Market (SOL-PERP)"
                    : `Reference only. Epoch v0 trades SOL-PERP.`
                }
                className={`inline-flex items-center gap-2 px-2 py-0.5 rounded transition-colors font-mono text-[11px] ${
                  isSol
                    ? "cursor-pointer hover:bg-[#12161C] text-white"
                    : "cursor-default text-[#848E9C] hover:bg-[#12161C]/50"
                }`}
              >
                <div className="relative w-3.5 h-3.5 rounded-full overflow-hidden shrink-0">
                  <Image
                    src={iconPath}
                    alt={plainSymbol}
                    width={14}
                    height={14}
                    className="object-contain"
                  />
                </div>
                <span className={`font-semibold ${isSol ? "text-white" : "text-[#B7BDC6]"}`}>
                  {plainSymbol}
                </span>
                <span className={`tabular-nums font-medium ${isStale ? "text-[#848E9C]" : "text-white"}`}>
                  {t.price}
                </span>
                <span
                  className={`text-[10px] px-1 py-[1px] rounded tabular-nums font-medium ${
                    isStale
                      ? "text-[#848E9C] bg-[#1F2633]"
                      : t.isPositive
                      ? "text-[#0ECB81] bg-[#0ECB81]/10"
                      : "text-[#F6465D] bg-[#F6465D]/10"
                  }`}
                >
                  {isStale ? "stale" : t.change}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
