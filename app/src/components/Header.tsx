"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { MarketStats } from "../lib/marketData";
import { MarketSelector } from "./MarketSelector";
import { WalletMenu } from "./WalletMenu";
import { SystemStatusCenter } from "./SystemStatusCenter";
import {
  formatUsd,
  formatCompactUsd,
  formatNumber,
  formatPercent,
  formatFundingRate,
  formatOracle,
} from "../lib/formatters";

export interface HeaderProps {
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
  activeTab?: "trade" | "batches" | "evidence" | "compare";
  onSelectTab?: (tab: "trade" | "batches" | "evidence" | "compare") => void;
  isDevnetOutage?: boolean;
  vaultInventoryNotice?: string | null;
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
  activeTab = "trade",
  onSelectTab,
  isDevnetOutage = false,
  vaultInventoryNotice = null,
}) => {
  // Progress within 2-slot batch (UX-02)
  const progressPercent = Math.max(0, Math.min(100, (1 - slotsRemaining / 2) * 100));

  // Determine configured cluster
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
  const isLocalnet = rpcUrl.includes("127.0.0.1") || rpcUrl.includes("localhost");
  const isDevnet = rpcUrl.includes("devnet");
  const clusterLabel = isLocalnet ? "Localnet" : isDevnet ? "Devnet" : "Custom RPC";

  // Market stats formatted per UX spec
  const changePercent = stats?.priceChangePercent ?? 2.45;
  const isPositive = changePercent >= 0;
  const lastBatchPrice = stats?.lastPrice ? stats.lastPrice : markPrice;
  const oraclePrice = markPrice;

  return (
    <header className="h-[44px] border-b border-line-default bg-surface-header flex items-center justify-between px-3 shrink-0 gap-3 select-none overflow-hidden font-sans">
      {/* 1. Left Section: Logo, Navigation Tabs & Market Selector */}
      <div className="flex items-center gap-3 shrink-0 min-w-0">
        {/* Brand Logo & Tag */}
        <div className="flex items-center gap-2 pr-3 border-r border-line-default shrink-0">
          <div className="relative w-20 h-6">
            <Image
              src="/logo.png"
              alt="Epoch Protocol"
              fill
              className="object-contain"
              priority
            />
          </div>
          <span className="hidden sm:inline-block text-[9px] font-mono tracking-widest uppercase px-1.5 py-0.5 rounded bg-surface-panel border border-line-subtle text-content-muted">
            FBA PERP
          </span>
        </div>

        {/* Top Navigation Tabs */}
        {onSelectTab && (
          <nav className="hidden md:flex items-center gap-1 shrink-0" aria-label="Main Navigation">
            <button
              type="button"
              onClick={() => onSelectTab("trade")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                activeTab === "trade"
                  ? "bg-surface-elevated text-trade-cyan font-semibold border border-trade-cyan/30 shadow-xs"
                  : "text-content-secondary hover:text-content-primary hover:bg-surface-hover"
              }`}
            >
              Trade
            </button>
            <button
              type="button"
              onClick={() => onSelectTab("batches")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                activeTab === "batches"
                  ? "bg-surface-elevated text-trade-cyan font-semibold border border-trade-cyan/30 shadow-xs"
                  : "text-content-secondary hover:text-content-primary hover:bg-surface-hover"
              }`}
            >
              Batches
            </button>
            <button
              type="button"
              onClick={() => onSelectTab("evidence")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                activeTab === "evidence"
                  ? "bg-surface-elevated text-trade-cyan font-semibold border border-trade-cyan/30 shadow-xs"
                  : "text-content-secondary hover:text-content-primary hover:bg-surface-hover"
              }`}
            >
              Evidence
            </button>
            <button
              type="button"
              onClick={() => onSelectTab("compare")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                activeTab === "compare"
                  ? "bg-surface-elevated text-trade-cyan font-semibold border border-trade-cyan/30 shadow-xs"
                  : "text-content-secondary hover:text-content-primary hover:bg-surface-hover"
              }`}
            >
              Compare
            </button>
            <Link
              href="/design-system"
              target="_blank"
              className="px-2 py-1 rounded text-xs text-content-muted hover:text-content-secondary transition-colors"
              title="Open Design System Primitives Catalog"
            >
              Design
            </Link>
          </nav>
        )}

        <div className="hidden lg:block w-px h-4 bg-line-default shrink-0" />

        {/* Dynamic Market Selector */}
        <MarketSelector />

        {/* Price & 24h Change Metric */}
        <div className="flex flex-col shrink-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`text-sm font-bold font-mono tracking-tight leading-none tabular-nums ${
                isPositive ? "text-trade-emerald" : "text-trade-coral"
              }`}
            >
              {formatUsd(lastBatchPrice, 2)}
            </span>
            <span
              className={`text-2xs font-mono font-medium leading-none px-1 py-0.5 rounded ${
                isPositive
                  ? "bg-trade-emerald/10 text-trade-emerald border border-trade-emerald/20"
                  : "bg-trade-coral/10 text-trade-coral border border-trade-coral/20"
              }`}
            >
              {formatPercent(changePercent, 2)}
            </span>
          </div>
          <span className="text-2xs font-mono text-content-muted leading-tight tabular-nums mt-0.5">
            Oracle: {formatOracle(oraclePrice)}
          </span>
        </div>

        {/* 2. Secondary Ticker Metrics */}
        <div className="hidden xl:flex items-center gap-3.5 text-xs shrink-0">
          {/* Funding Rate & Countdown */}
          <div className="flex flex-col">
            <span className="text-content-muted text-2xs font-sans flex items-center gap-1">
              Funding (8h)
              <span className="text-2xs text-content-muted tabular-nums font-mono">
                ({stats?.fundingCountdown || "08:00:00"})
              </span>
            </span>
            <span className="font-mono text-trade-amber font-medium tabular-nums text-2xs">
              {formatFundingRate(stats?.fundingRate || 0.00041)}
            </span>
          </div>

          {/* Secondary stats: collapse below 1500px per UX-17 and spec */}
          <div className="hidden min-[1500px]:flex items-center gap-3.5">
            {/* 24h Epoch Volume */}
            <div className="flex flex-col">
              <span className="text-content-muted text-2xs font-sans">24h Vol (Epoch)</span>
              <span className="font-mono text-content-primary font-medium tabular-nums text-2xs">
                {formatCompactUsd(epochVolumeUsd)}
              </span>
            </div>

            {/* Open Interest */}
            <div className="flex flex-col">
              <span className="text-content-muted text-2xs font-sans">Open Interest</span>
              <span className="font-mono text-content-primary font-medium tabular-nums text-2xs">
                {formatNumber(epochOpenInterestSol, 1)} SOL
              </span>
            </div>
          </div>

          {/* FBA Batch Status Indicator & Countdown */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-card border border-line-default text-2xs font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-trade-emerald animate-pulse" />
            <span className="text-content-muted hidden min-[1400px]:inline">
              Slot #{currentSlot || "..."}
            </span>
            <span className="text-line-strong hidden min-[1400px]:inline">·</span>
            <span className="text-content-primary font-medium">Batch #{currentBatchId}</span>
            <div className="w-8 h-1.5 rounded-full bg-surface-panel border border-line-subtle overflow-hidden ml-0.5">
              <div
                className="h-full bg-gradient-to-r from-trade-cyan to-trade-emerald transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-trade-cyan font-semibold">
              {slotsRemaining} slot{slotsRemaining === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Right Header Actions: System Status Center & Wallet Menu */}
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        {/* System Status Center (Replaces old multi-row warning banners with compact indicator + diagnostic drawer) */}
        <SystemStatusCenter
          currentSlot={currentSlot}
          currentBatchId={currentBatchId}
          isKeeperOffline={isKeeperOffline}
          lastClearedAgeSec={lastClearedAgeSec}
          isDevnetOutage={isDevnetOutage}
          vaultInventoryNotice={vaultInventoryNotice}
          rpcUrl={rpcUrl}
          clusterLabel={clusterLabel}
          oraclePrice={oraclePrice}
          oracleAgeSec={1}
          venueCount={stats?.venueCount ?? 6}
        />

        {/* Custom WalletMenu */}
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
