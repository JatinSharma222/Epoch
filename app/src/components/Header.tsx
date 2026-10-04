"use client";

import React from "react";
import Image from "next/image";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Coins, Search } from "lucide-react";
import { MarketStats } from "../lib/marketData";
import { MarketSelector } from "./MarketSelector";
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
  onOpenFaucetModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentSlot,
  currentBatchId,
  slotsRemaining,
  markPrice,
  stats,
  onOpenFaucetModal,
}) => {
  const { connected } = useWallet();

  // Progress within 2-slot batch
  const progressPercent = Math.max(0, Math.min(100, (1 - slotsRemaining / 2) * 100));

  // Determine configured cluster (UX-15: Localnet vs Devnet, never hardcoded)
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8899";
  const isLocalnet = rpcUrl.includes("127.0.0.1") || rpcUrl.includes("localhost");
  const isDevnet = rpcUrl.includes("devnet");
  const clusterLabel = isLocalnet ? "Localnet" : isDevnet ? "Devnet" : "Custom RPC";

  // Market stats formatted per 09 §8.1
  const changePercent = stats?.priceChangePercent ?? 2.45;
  const isPositive = changePercent >= 0;
  const rawVolUsd = stats?.volumeUsd || 33957991.07;
  const compactVolumeUsd = formatCompactUsd(rawVolUsd);
  const volumeSolFormatted = stats?.volumeSol
    ? `${formatNumber(stats.volumeSol, 0)} SOL`
    : "192,346 SOL";

  const lastBatchPrice = stats?.lastPrice ? stats.lastPrice : markPrice;
  const oraclePrice = markPrice;

  // Faucet eligibility (09 §3.4 & UX-13)
  const canUseFaucet = connected && (isLocalnet || isDevnet);

  return (
    <header className="h-[52px] border-b bp-border bg-[#0E1217] flex items-center justify-between px-3 shrink-0 gap-3 select-none overflow-x-auto">
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

        {/* Dynamic Market Selector with Authentic Logos (09 §3.4) */}
        <MarketSelector />

        {/* Price Metrics: Oracle (Pyth) & Last Batch Price (09 §8.1 vocabulary) */}
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[16px] font-bold font-mono tracking-tight leading-none tabular-nums ${
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
        <div className="flex items-center gap-4 text-[11px]">
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
            <span className="text-[#848E9C] text-[10px] font-sans">Funding (8h)</span>
            <span className="font-mono text-[#EAB308] font-medium tabular-nums">
              {formatFundingRate(stats?.fundingRate || 0.00041)}
            </span>
          </div>

          <div className="flex flex-col hidden xl:flex">
            <span className="text-[#848E9C] text-[10px] font-sans">24h Volume</span>
            <span className="font-mono text-[#F0F3F6] font-medium tabular-nums">
              {compactVolumeUsd}
            </span>
          </div>

          <div className="flex flex-col hidden 2xl:flex">
            <span className="text-[#848E9C] text-[10px] font-sans">Open Interest</span>
            <span className="font-mono text-[#F0F3F6] font-medium tabular-nums">
              {volumeSolFormatted}
            </span>
          </div>

          {/* FBA Batch Indicator & Countdown (09 §2.2) */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#161B22] border bp-border text-[10px] font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0ECB81] animate-pulse"></span>
            <span className="text-[#848E9C]">Slot #{currentSlot || "..."}</span>
            <span className="text-[#4B5563]">·</span>
            <span className="text-[#F0F3F6] font-medium">Batch #{currentBatchId}</span>
            <div className="w-12 h-1.5 rounded-full bg-[#1E2430] overflow-hidden ml-1">
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
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Search Bar */}
        <div className="hidden 2xl:flex items-center gap-2 px-2.5 py-1 rounded bg-[#12161C] border bp-border text-[#848E9C] text-[11px] w-48">
          <Search className="w-3.5 h-3.5 text-[#848E9C] shrink-0" />
          <span className="flex-1 truncate text-[#848E9C]">Search markets...</span>
          <kbd className="px-1.5 py-[1px] rounded bg-[#1A1F29] border bp-border text-[9px] font-mono text-[#848E9C]">
            /
          </kbd>
        </div>

        {/* Faucet Trigger (09 §3.4 & UX-13: Disabled unless connected + local/devnet) */}
        <button
          onClick={canUseFaucet ? onOpenFaucetModal : undefined}
          disabled={!canUseFaucet}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded border bp-border text-[11px] font-medium transition-all ${
            canUseFaucet
              ? "bg-[#161B22] hover:bg-[#1F2633] text-[#F0F3F6] cursor-pointer"
              : "bg-[#12161C] text-[#848E9C] opacity-45 cursor-not-allowed"
          }`}
          title={
            !connected
              ? "Connect a wallet to claim test USDC"
              : !canUseFaucet
              ? "Faucet available on Localnet & Devnet only"
              : "Claim 1,000 test USDC"
          }
        >
          <Coins className={`w-3.5 h-3.5 ${canUseFaucet ? "text-[#EAB308]" : "text-[#848E9C]"}`} />
          <span>Faucet</span>
        </button>

        {/* Dynamic Network Cluster Badge (UX-15) */}
        <div
          className="hidden sm:flex items-center gap-1 px-2 py-1 rounded bg-[#12161C] border bp-border text-[10px] font-mono text-[#848E9C]"
          title={`Configured RPC: ${rpcUrl}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#0ECB81]"></span>
          <span>{clusterLabel}</span>
        </div>

        {/* Solana Wallet Adapter MultiButton */}
        <WalletMultiButton />
      </div>
    </header>
  );
};
