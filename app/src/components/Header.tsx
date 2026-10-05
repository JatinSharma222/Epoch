"use client";

import React from "react";
import Image from "next/image";
import { MarketStats } from "../lib/marketData";
import { MarketSelector } from "./MarketSelector";
import { WalletMenu } from "./WalletMenu";
import {
  formatUsd,
  formatCompactUsd,
  formatNumber,
  formatPercent,
  formatFundingRate,
  formatOracle,
} from "../lib/formatters";

interface HeaderProps {
  currentSlot: number;
  currentBatchId: number;
  slotsRemaining: number;
  markPrice: number;
  stats?: MarketStats | null;
  epochVolumeUsd?: number;
  epochOpenInterestSol?: number;
  solBalance?: number | null;
  collateralBalance?: number;
  onOpenFaucetModal: () => void;
  onDisconnect?: () => void;
  isKeeperOffline?: boolean;
  lastClearedAgeSec?: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentSlot,
  currentBatchId,
  slotsRemaining,
  markPrice,
  stats,
  epochVolumeUsd = 0,
  epochOpenInterestSol = 0,
  solBalance = null,
  collateralBalance = 0,
  onOpenFaucetModal,
  onDisconnect,
  isKeeperOffline = false,
  lastClearedAgeSec = 0,
}) => {
  // Progress within 2-slot batch
  const progressPercent = Math.max(0, Math.min(100, (1 - slotsRemaining / 2) * 100));

  // Determine configured cluster (UX-15: Localnet vs Devnet, never hardcoded)
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
  const isLocalnet = rpcUrl.includes("127.0.0.1") || rpcUrl.includes("localhost");
  const isDevnet = rpcUrl.includes("devnet");
  const clusterLabel = isLocalnet ? "Localnet" : isDevnet ? "Devnet" : "Custom RPC";

  // Market stats formatted per 09 §8.1
  const changePercent = stats?.priceChangePercent ?? 2.45;
  const isPositive = changePercent >= 0;
  const lastBatchPrice = stats?.lastPrice ? stats.lastPrice : markPrice;
  const oraclePrice = markPrice;

  return (
    <header className="h-[52px] border-b bp-border bg-[#0E1217] flex items-center justify-between px-3 shrink-0 gap-3 select-none overflow-hidden">
      {/* Left: Brand Logo & Market Selector */}
      <div className="flex items-center gap-3.5 shrink-0 min-w-0">
        <div className="flex items-center gap-2.5 pr-3 border-r bp-border shrink-0">
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

        {/* Dynamic Market Selector with Authentic Logos (09 §3.4) */}
        <MarketSelector />

        {/* Price Metrics: Oracle (Pyth) & Last Batch Price (09 §8.1 vocabulary) */}
        <div className="flex flex-col shrink-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[15px] font-bold font-mono tracking-tight leading-none tabular-nums ${
                isPositive ? "text-[#0ECB81]" : "text-[#F6465D]"
              }`}
            >
              {formatUsd(lastBatchPrice, 2)}
            </span>
          </div>
          <span className="text-[10px] font-mono text-[#848E9C] leading-tight tabular-nums">
            Oracle: {formatOracle(oraclePrice)}
          </span>
        </div>

        {/* 24h & Protocol Metrics */}
        <div className="flex items-center gap-3.5 text-[11px] shrink-0">
          <div className="flex flex-col">
            <span className="text-[#848E9C] text-[10px] font-sans">24h Change</span>
            <span
              className={`font-mono font-medium tabular-nums ${
                isPositive ? "text-[#0ECB81]" : "text-[#F6465D]"
              }`}
            >
              {formatPercent(changePercent, 2)}
            </span>
          </div>

          <div className="flex flex-col hidden lg:flex">
            <span className="text-[#848E9C] text-[10px] font-sans flex items-center gap-1">
              Funding (8h)
              <span className="text-[9px] text-[#848E9C] tabular-nums font-mono">({stats?.fundingCountdown || "08:00:00"})</span>
            </span>
            <span className="font-mono text-[#EAB308] font-medium tabular-nums">
              {formatFundingRate(stats?.fundingRate || 0.00041)}
            </span>
          </div>

          {/* Secondary stats: collapse below 1500px per UX-17 and 09 §3.5 */}
          <div className="hidden min-[1500px]:flex items-center gap-3.5">
            <div className="flex flex-col">
              <span className="text-[#848E9C] text-[10px] font-sans">24h Vol (Epoch)</span>
              <span className="font-mono text-[#F0F3F6] font-medium tabular-nums">
                {formatCompactUsd(epochVolumeUsd)}
              </span>
            </div>

            <div className="flex flex-col">
              <span className="text-[#848E9C] text-[10px] font-sans">Open Interest (Epoch)</span>
              <span className="font-mono text-[#F0F3F6] font-medium tabular-nums">
                {formatNumber(epochOpenInterestSol, 1)} SOL
              </span>
            </div>
          </div>

          {/* FBA Batch Indicator & Countdown (09 §2.2) */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#161B22] border bp-border text-[10px] font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0ECB81] animate-pulse"></span>
            <span className="text-[#848E9C] hidden sm:inline">Slot #{currentSlot || "..."}</span>
            <span className="text-[#4B5563] hidden sm:inline">·</span>
            <span className="text-[#F0F3F6] font-medium">Batch #{currentBatchId}</span>
            <div className="w-10 h-1.5 rounded-full bg-[#1E2430] overflow-hidden ml-1">
              <div
                className="h-full bg-gradient-to-r from-[#00F0FF] to-[#0ECB81] transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-[#00F0FF] font-semibold">{slotsRemaining}s</span>
          </div>
        </div>
      </div>

      {/* Right Header Actions */}
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        {/* Single Dynamic Status Pill (09 §3.5 rule 3: cluster + keeper in one pill) */}
        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#12161C] border bp-border text-[11px] font-mono text-[#848E9C] cursor-default"
          title={`Cluster: ${clusterLabel} (${rpcUrl})\nKeeper: ${isKeeperOffline ? "Offline" : "Online"} (last cleared ${lastClearedAgeSec}s ago)`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isKeeperOffline ? "bg-[#F6465D] animate-ping" : "bg-[#0ECB81]"
            }`}
          />
          <span className="text-[#F0F3F6] font-medium">{clusterLabel}</span>
          <span className="text-[#4B5563]">·</span>
          <span className={isKeeperOffline ? "text-[#F6465D]" : "text-[#0ECB81]"}>
            Keeper {isKeeperOffline ? "offline" : "online"}
          </span>
        </div>

        {/* Custom WalletMenu: Full features, Hydration-safe, Disconnect purging, No horizontal scroll */}
        <WalletMenu
          solBalance={solBalance}
          collateralBalance={collateralBalance}
          onOpenFaucet={onOpenFaucetModal}
          onDisconnect={onDisconnect}
        />
      </div>
    </header>
  );
};
