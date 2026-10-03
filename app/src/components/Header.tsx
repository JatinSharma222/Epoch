"use client";

import React from "react";
import Image from "next/image";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Coins, Search, ChevronDown, Activity, Sparkles } from "lucide-react";

interface HeaderProps {
  currentSlot: number;
  currentBatchId: number;
  slotsRemaining: number;
  markPrice: number;
  onOpenFaucetModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentSlot,
  currentBatchId,
  slotsRemaining,
  markPrice,
  onOpenFaucetModal,
}) => {
  const progressPercent = Math.max(0, Math.min(100, (1 - slotsRemaining / 2) * 100));
  const indexPrice = (markPrice * 1.0003).toFixed(2);
  const high24h = (markPrice * 1.031).toFixed(2);
  const low24h = (markPrice * 0.978).toFixed(2);

  return (
    <header className="h-[52px] border-b bp-border bg-[#0e1217] flex items-center justify-between px-3 shrink-0 gap-3 select-none overflow-x-auto">
      {/* Left: Brand Logo & Market Selector */}
      <div className="flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-2.5 pr-3 border-r bp-border">
          <div className="relative w-24 h-7">
            <Image
              src="/logo.png"
              alt="Epoch Logo"
              fill
              className="object-contain"
              priority
            />
          </div>
        </div>

        {/* Market Dropdown Pill (Backpack 1:1) */}
        <div className="flex items-center gap-2 cursor-pointer group pr-3 border-r bp-border hover:opacity-90 transition-opacity">
          <div className="w-6 h-6 rounded-full bg-[#181d24] border bp-border flex items-center justify-center shrink-0">
            <span className="text-[11px] font-bold text-[#9945ff]">◎</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-[14px] text-white tracking-tight">SOL-PERP</span>
            <span className="text-[10px] font-mono px-1 py-[1px] rounded bg-[#181d24] text-[#848e9c] font-medium border bp-border">
              10x
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-[#848e9c] group-hover:text-white transition-colors" />
          </div>
        </div>

        {/* Price Ticker & Primary Metrics */}
        <div className="flex flex-col">
          <span className="text-[16px] font-bold font-mono text-[#0ecb81] tracking-tight leading-none">
            ${markPrice.toFixed(2)}
          </span>
          <span className="text-[10px] font-mono text-[#848e9c] leading-tight">
            ${indexPrice}
          </span>
        </div>

        {/* 24h & Index Strip */}
        <div className="flex items-center gap-4 text-[11px]">
          <div className="flex flex-col">
            <span className="text-[#848e9c] text-[10px]">Index Price</span>
            <span className="font-mono text-[#f0f3f6] font-medium">${indexPrice}</span>
          </div>

          <div className="flex flex-col">
            <span className="text-[#848e9c] text-[10px]">24H Change</span>
            <span className="font-mono text-[#0ecb81] font-medium">+2.45%</span>
          </div>

          <div className="flex flex-col hidden lg:flex">
            <span className="text-[#848e9c] text-[10px]">1H Funding / Countdown</span>
            <span className="font-mono text-[#eab308] font-medium">
              0.00041% <span className="text-[#848e9c]">/ 00:30:13</span>
            </span>
          </div>

          <div className="flex flex-col hidden xl:flex">
            <span className="text-[#848e9c] text-[10px]">24H High</span>
            <span className="font-mono text-[#f0f3f6] font-medium">${high24h}</span>
          </div>

          <div className="flex flex-col hidden xl:flex">
            <span className="text-[#848e9c] text-[10px]">24H Low</span>
            <span className="font-mono text-[#f0f3f6] font-medium">${low24h}</span>
          </div>

          <div className="flex flex-col hidden 2xl:flex">
            <span className="text-[#848e9c] text-[10px]">24H Volume (USD)</span>
            <span className="font-mono text-[#f0f3f6] font-medium">$33,957,991.07</span>
          </div>

          <div className="flex flex-col hidden 2xl:flex">
            <span className="text-[#848e9c] text-[10px]">Open Interest (SOL)</span>
            <span className="font-mono text-[#f0f3f6] font-medium">192,346.18</span>
          </div>

          {/* FBA Batch Indicator (Clean Discreet Badge) */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#161b22] border bp-border text-[10px] font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0ecb81] animate-pulse"></span>
            <span className="text-[#848e9c]">Slot #{currentSlot || "..."}</span>
            <span className="text-[#4b5563]">·</span>
            <span className="text-[#f0f3f6] font-medium">Batch #{currentBatchId}</span>
            <div className="w-12 h-1.5 rounded-full bg-[#1e2430] overflow-hidden ml-1">
              <div
                className="h-full bg-gradient-to-r from-[#00f0ff] to-[#0ecb81] transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-[#00f0ff] font-semibold">{slotsRemaining}s</span>
          </div>
        </div>
      </div>

      {/* Right Header Actions */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Search Bar with shortcut key */}
        <div className="hidden 2xl:flex items-center gap-2 px-2.5 py-1 rounded bg-[#12161c] border bp-border text-[#848e9c] text-[11px] w-52">
          <Search className="w-3.5 h-3.5 text-[#848e9c] shrink-0" />
          <span className="flex-1 truncate text-[#848e9c]">Search markets...</span>
          <kbd className="px-1.5 py-[1px] rounded bg-[#1a1f29] border bp-border text-[9px] font-mono text-[#848e9c]">
            /
          </kbd>
        </div>

        {/* Faucet Trigger */}
        <button
          onClick={onOpenFaucetModal}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#161b22] hover:bg-[#1f2633] text-[#f0f3f6] border bp-border text-[11px] font-medium transition-colors"
          title="Claim mock USDC for devnet testing"
        >
          <Coins className="w-3.5 h-3.5 text-[#eab308]" />
          <span>Faucet</span>
        </button>

        {/* Network Badge */}
        <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded bg-[#12161c] border bp-border text-[10px] font-mono text-[#848e9c]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#0ecb81]"></span>
          <span>Devnet</span>
        </div>

        {/* Solana Wallet Adapter MultiButton */}
        <WalletMultiButton />
      </div>
    </header>
  );
};
