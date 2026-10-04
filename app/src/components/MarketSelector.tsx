"use client";

import React, { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { Search, ChevronDown, Check } from "lucide-react";

interface MarketItem {
  symbol: string;
  name: string;
  icon: string;
  leverage: string;
  status: "active" | "soon";
}

const MARKETS: MarketItem[] = [
  { symbol: "SOL-PERP", name: "Solana", icon: "/icons/sol.svg", leverage: "10x", status: "active" },
  { symbol: "BTC-PERP", name: "Bitcoin", icon: "/icons/btc.svg", leverage: "20x", status: "soon" },
  { symbol: "ETH-PERP", name: "Ethereum", icon: "/icons/eth.svg", leverage: "20x", status: "soon" },
  { symbol: "JUP-PERP", name: "Jupiter", icon: "/icons/jup.svg", leverage: "10x", status: "soon" },
  { symbol: "PYTH-PERP", name: "Pyth Network", icon: "/icons/pyth.svg", leverage: "10x", status: "soon" },
  { symbol: "JTO-PERP", name: "Jito", icon: "/icons/jto.svg", leverage: "10x", status: "soon" },
  { symbol: "TIA-PERP", name: "Celestia", icon: "/icons/tia.svg", leverage: "10x", status: "soon" },
  { symbol: "SUI-PERP", name: "Sui", icon: "/icons/sui.svg", leverage: "10x", status: "soon" },
  { symbol: "INJ-PERP", name: "Injective", icon: "/icons/inj.svg", leverage: "10x", status: "soon" },
  { symbol: "NEAR-PERP", name: "Near Protocol", icon: "/icons/near.svg", leverage: "10x", status: "soon" },
  { symbol: "RENDER-PERP", name: "Render", icon: "/icons/render.svg", leverage: "10x", status: "soon" },
];

export const MarketSelector: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const filteredMarkets = MARKETS.filter(
    (m) =>
      m.symbol.toLowerCase().includes(search.toLowerCase()) ||
      m.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 cursor-pointer group pr-3 border-r bp-border hover:opacity-90 transition-opacity focus:outline-none"
        aria-label="Select market"
        aria-expanded={isOpen}
      >
        <div className="relative w-6 h-6 rounded-full overflow-hidden border bp-border flex items-center justify-center shrink-0 bg-[#181d24]">
          <Image
            src="/icons/sol.svg"
            alt="SOL"
            width={18}
            height={18}
            className="object-contain"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-[14px] text-white tracking-tight">SOL-PERP</span>
          <span className="text-[10px] font-mono px-1 py-[1px] rounded bg-[#181d24] text-[#848e9c] font-medium border bp-border">
            10x
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-[#848e9c] group-hover:text-white transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>

      {/* Dropdown Modal / Popover */}
      {isOpen && (
        <div className="absolute top-[42px] left-0 w-[280px] bg-[#0E1217] border border-[#272A2E] rounded-lg shadow-2xl z-50 overflow-hidden text-[12px] animate-in fade-in zoom-in-95 duration-100">
          {/* Search Header */}
          <div className="p-2 border-b bp-border bg-[#12161C]">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-[#181D24] border bp-border">
              <Search className="w-3.5 h-3.5 text-[#848E9C] shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search market (e.g. BTC, ETH)..."
                autoFocus
                className="bg-transparent text-white text-[12px] outline-none w-full placeholder-[#848E9C]"
              />
            </div>
          </div>

          {/* Markets List */}
          <div className="max-h-[280px] overflow-y-auto py-1 divide-y divide-white/[0.03]">
            {filteredMarkets.length === 0 ? (
              <div className="px-3 py-6 text-center text-[#848E9C] text-[11px]">
                No markets found
              </div>
            ) : (
              filteredMarkets.map((m) => {
                const isActive = m.status === "active";
                return (
                  <div
                    key={m.symbol}
                    title={
                      isActive
                        ? "Active on-chain market"
                        : "Soon. Epoch v0 trades SOL-PERP."
                    }
                    onClick={() => {
                      if (isActive) {
                        setIsOpen(false);
                      }
                    }}
                    className={`flex items-center justify-between px-3 py-2 transition-colors ${
                      isActive
                        ? "hover:bg-[#181D24] cursor-pointer"
                        : "opacity-45 cursor-not-allowed hover:bg-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="relative w-5 h-5 rounded-full overflow-hidden shrink-0">
                        <Image
                          src={m.icon}
                          alt={m.symbol}
                          width={20}
                          height={20}
                          className="object-contain"
                        />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-semibold text-white leading-tight">
                          {m.symbol}
                        </span>
                        <span className="text-[10px] text-[#848E9C] leading-tight">
                          {m.name}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-[#848E9C]">
                        {m.leverage}
                      </span>
                      {isActive ? (
                        <div className="flex items-center gap-1 text-[10px] text-[#0ECB81] font-semibold bg-[#0ECB81]/10 px-1.5 py-0.5 rounded border border-[#0ECB81]/30">
                          <Check className="w-3 h-3" />
                          <span>Active</span>
                        </div>
                      ) : (
                        <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-[#1F2633] text-[#848E9C] border bp-border">
                          Soon
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
