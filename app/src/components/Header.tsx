"use client";

import React from "react";
import Image from "next/image";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Coins, ExternalLink, Activity } from "lucide-react";

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

  return (
    <header className="h-[52px] border-b bp-border bg-[#0e1217] flex items-center justify-between px-3 shrink-0 gap-3 select-none">
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

        {/* Market Pill */}
        <div className="flex items-center gap-2 cursor-pointer group pr-3 border-r bp-border">
          <div className="w-6 h-6 rounded-full bg-[#181d24] border bp-border flex items-center justify-center shrink-0">
            <span className="text-[11px] font-bold text-[#9945ff]">◎</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-[13px] text-white tracking-tight">SOL-PERP</span>
            <span className="text-[9px] font-mono px-1 py-[1px] rounded bg-[#181d24] text-[#848e9c] font-medium border bp-border">
              10x
            </span>
          </div>
        </div>

        {/* Live Mark Price & 24h Stats */}
        <div className="flex items-center gap-4 text-[11px]">
          <div className="flex flex-col">
            <span className="text-[15px] font-bold font-mono text-[#0ecb81] tracking-tight leading-none">
              ${markPrice.toFixed(2)}
            </span>
            <span className="text-[10px] font-mono text-[#848e9c] leading-tight">
              Oracle Mark
            </span>
          </div>

          <div className="flex flex-col hidden sm:flex">
            <span className="text-[#848e9c] text-[10px]">24H Change</span>
            <span className="font-mono text-[#0ecb81] font-medium">+2.45%</span>
          </div>

          <div className="flex flex-col hidden md:flex">
            <span className="text-[#848e9c] text-[10px]">24H Volume</span>
            <span className="font-mono text-[#f0f3f6] font-medium">$159,354.20</span>
          </div>

          <div className="flex flex-col hidden lg:flex">
            <span className="text-[#848e9c] text-[10px]">Funding Rate (8h)</span>
            <span className="font-mono text-[#eab308] font-medium">+0.0100%</span>
          </div>
        </div>
      </div>

      {/* Center/Right: Live Batch Countdown Progress Bar */}
      <div className="hidden xl:flex items-center gap-2.5 px-3 py-1.5 rounded-md bg-[#12161c] border bp-border text-[11px] font-mono">
        <Activity className="w-3.5 h-3.5 text-[#0ecb81] animate-pulse" />
        <span className="text-[#848e9c]">Slot #{currentSlot || "..."}</span>
        <span className="text-[#4b5563]">|</span>
        <span className="text-white font-medium">Batch #{currentBatchId}</span>
        <div className="w-16 h-1.5 rounded-full bg-[#1e2430] overflow-hidden ml-1">
          <div
            className="h-full bg-gradient-to-r from-[#00f0ff] to-[#0ecb81] transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="text-[10px] text-[#00f0ff] font-semibold">
          {slotsRemaining}s left
        </span>
      </div>

      {/* Right Header Actions */}
      <div className="flex items-center gap-2 shrink-0">
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
