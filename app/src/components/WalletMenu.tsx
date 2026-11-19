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

  const [testWallet, setTestWallet] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined" && (window as any).__EPOCH_TEST_WALLET__) {
      setTestWallet((window as any).__EPOCH_TEST_WALLET__);
    }
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

  const isConnected = connected || Boolean(testWallet);
  const base58 = publicKey ? publicKey.toBase58() : testWallet || "";

  // SSR hydration safety (UX-19)
  if (!mounted) {
    return (
      <button
        disabled
        className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md bg-surface-card text-content-muted text-xs font-medium border border-line-default flex items-center gap-1.5 opacity-60 shrink-0"
      >
        <Wallet className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline">Connect Wallet</span>
        <span className="sm:hidden">Connect</span>
      </button>
    );
  }

  if (!isConnected || !base58) {
    return (
      <button
        onClick={() => setVisible(true)}
        disabled={connecting}
        className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md bg-trade-cyan hover:bg-[#00D8E6] text-black font-semibold text-xs transition-all flex items-center gap-1.5 shadow-sm active:scale-95 shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-trade-cyan"
      >
        <Wallet className="w-3.5 h-3.5 text-black shrink-0" />
        <span className="hidden sm:inline">{connecting ? "Connecting..." : "Connect Wallet"}</span>
        <span className="sm:hidden">{connecting ? "..." : "Connect"}</span>
      </button>
    );
  }

  const shortened = `${base58.slice(0, 4)}...${base58.slice(-4)}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(base58);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleChangeWallet = async () => {
    setIsOpen(false);
    setTestWallet(null);
    if (typeof window !== "undefined") {
      (window as any).__EPOCH_TEST_WALLET__ = null;
    }
    await disconnect();
    setVisible(true);
  };

  const handleDisconnect = async () => {
    setIsOpen(false);
    setTestWallet(null);
    if (typeof window !== "undefined") {
      (window as any).__EPOCH_TEST_WALLET__ = null;
    }
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
        className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md bg-surface-card hover:bg-surface-elevated text-content-primary border border-line-default text-xs font-mono transition-all shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-trade-cyan"
        aria-expanded={isOpen}
      >
        <span className="w-2 h-2 rounded-full bg-trade-emerald shrink-0" />
        <span className="font-medium text-content-primary">{shortened}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-content-muted transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Wallet Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 top-[38px] w-[260px] bg-surface-panel border border-line-strong rounded-lg shadow-modal z-50 overflow-hidden text-xs font-sans animate-scale-in">
          {/* Top Address & Copy / Explorer */}
          <div className="p-3 border-b border-line-default bg-surface-card space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-content-muted">
                Connected Wallet
              </span>
              <span className="text-[10px] font-mono text-trade-emerald bg-trade-emerald/10 px-1.5 py-0.5 rounded border border-trade-emerald/30">
                Devnet
              </span>
            </div>
            <div className="flex items-center justify-between font-mono text-[11px] text-content-primary bg-surface-canvas p-1.5 rounded border border-line-default">
              <span className="truncate mr-2">{shortened}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={handleCopy}
                  title="Copy address"
                  className="p-1 hover:bg-surface-elevated rounded text-content-muted hover:text-content-primary transition-colors"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-trade-emerald" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
                <a
                  href={`https://explorer.solana.com/address/${base58}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View on Solana Explorer"
                  className="p-1 hover:bg-surface-elevated rounded text-content-muted hover:text-content-primary transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>

          {/* Balances Section */}
          <div className="p-3 border-b border-line-default space-y-2 font-mono text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-content-muted">SOL Balance:</span>
              <span className="text-content-primary font-medium tabular-nums">
                {solBalance !== null ? `${solBalance.toFixed(4)} SOL` : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-content-muted">Test USDC:</span>
              <span className="text-trade-emerald font-bold tabular-nums">
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
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-surface-hover text-trade-amber transition-colors text-left"
            >
              <Coins className="w-3.5 h-3.5 shrink-0" />
              <span>Claim Test USDC (Faucet)</span>
            </button>

            {/* Change Wallet */}
            <button
              onClick={handleChangeWallet}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-surface-hover text-content-secondary hover:text-content-primary transition-colors text-left"
            >
              <RefreshCw className="w-3.5 h-3.5 shrink-0" />
              <span>Change Wallet</span>
            </button>

            {/* Disconnect */}
            <button
              onClick={handleDisconnect}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-trade-coral/10 text-trade-coral transition-colors text-left font-medium"
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
