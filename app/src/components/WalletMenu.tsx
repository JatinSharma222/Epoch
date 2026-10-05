"use client";

import React, { useState, useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  Wallet,
  LogOut,
  Copy,
  Check,
  ExternalLink,
  ChevronDown,
  RefreshCw,
  Coins,
} from "lucide-react";
import { formatUsd } from "../lib/formatters";

interface WalletMenuProps {
  solBalance: number | null;
  collateralBalance: number;
  onOpenFaucet: () => void;
  onDisconnect?: () => void;
}

export const WalletMenu: React.FC<WalletMenuProps> = ({
  solBalance,
  collateralBalance,
  onOpenFaucet,
  onDisconnect,
}) => {
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { publicKey, connected, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();

  useEffect(() => {
    setMounted(true);
  }, []);

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

  // SSR hydration safety (UX-19)
  if (!mounted) {
    return (
      <button
        disabled
        className="px-3 py-1.5 rounded-md bg-[#181D24] text-[#848E9C] text-[12px] font-medium border bp-border flex items-center gap-1.5 opacity-60"
      >
        <Wallet className="w-3.5 h-3.5" />
        <span>Connect Wallet</span>
      </button>
    );
  }

  if (!connected || !publicKey) {
    return (
      <button
        onClick={() => setVisible(true)}
        disabled={connecting}
        className="px-3 py-1.5 rounded-md bg-[#00F0FF] hover:bg-[#00D8E6] text-black font-semibold text-[12px] transition-all flex items-center gap-1.5 shadow-sm active:scale-95 shrink-0"
      >
        <Wallet className="w-3.5 h-3.5 text-black" />
        <span>{connecting ? "Connecting..." : "Connect Wallet"}</span>
      </button>
    );
  }

  const base58 = publicKey.toBase58();
  const shortened = `${base58.slice(0, 4)}...${base58.slice(-4)}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(base58);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleChangeWallet = async () => {
    setIsOpen(false);
    await disconnect();
    setVisible(true);
  };

  const handleDisconnect = async () => {
    setIsOpen(false);
    await disconnect();
    if (onDisconnect) {
      onDisconnect();
    }
  };

  return (
    <div className="relative shrink-0" ref={dropdownRef}>
      {/* Connected Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[#161B22] hover:bg-[#1F2633] text-white border bp-border text-[12px] font-mono transition-all shrink-0"
        aria-expanded={isOpen}
      >
        <span className="w-2 h-2 rounded-full bg-[#0ECB81] shrink-0" />
        <span className="font-medium text-white">{shortened}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[#848E9C] transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Wallet Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 top-[42px] w-[260px] bg-[#0E1217] border border-[#272A2E] rounded-lg shadow-2xl z-50 overflow-hidden text-[12px] font-sans animate-in fade-in zoom-in-95 duration-100">
          {/* Top Address & Copy / Explorer */}
          <div className="p-3 border-b bp-border bg-[#12161C] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-[#848E9C]">
                Connected Wallet
              </span>
              <span className="text-[10px] font-mono text-[#0ECB81] bg-[#0ECB81]/10 px-1.5 py-0.5 rounded border border-[#0ECB81]/30">
                Devnet
              </span>
            </div>
            <div className="flex items-center justify-between font-mono text-[11px] text-white bg-[#0B0E11] p-1.5 rounded border bp-border">
              <span className="truncate mr-2">{shortened}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={handleCopy}
                  title="Copy address"
                  className="p-1 hover:bg-[#1E2430] rounded text-[#848E9C] hover:text-white transition-colors"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-[#0ECB81]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
                <a
                  href={`https://explorer.solana.com/address/${base58}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View on Solana Explorer"
                  className="p-1 hover:bg-[#1E2430] rounded text-[#848E9C] hover:text-white transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>

          {/* Balances Section */}
          <div className="p-3 border-b bp-border space-y-2 font-mono text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-[#848E9C]">SOL Balance:</span>
              <span className="text-white font-medium tabular-nums">
                {solBalance !== null ? `${solBalance.toFixed(4)} SOL` : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#848E9C]">Test USDC:</span>
              <span className="text-[#0ECB81] font-bold tabular-nums">
                {formatUsd(collateralBalance, 2)}
              </span>
            </div>
          </div>

          {/* Actions List */}
          <div className="p-1.5 space-y-0.5 text-[11px]">
            {/* Faucet Entry (09 §3.5 rule 4) */}
            <button
              onClick={() => {
                setIsOpen(false);
                onOpenFaucet();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-[#161B22] text-[#EAB308] transition-colors text-left"
            >
              <Coins className="w-3.5 h-3.5 shrink-0" />
              <span>Claim Test USDC (Faucet)</span>
            </button>

            {/* Change Wallet */}
            <button
              onClick={handleChangeWallet}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-[#161B22] text-[#848E9C] hover:text-white transition-colors text-left"
            >
              <RefreshCw className="w-3.5 h-3.5 shrink-0" />
              <span>Change Wallet</span>
            </button>

            {/* Disconnect */}
            <button
              onClick={handleDisconnect}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-[#29171A] text-[#F6465D] transition-colors text-left font-medium"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span>Disconnect</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
