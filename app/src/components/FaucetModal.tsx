"use client";

import React, { useState } from "react";
import { Coins, X, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "./ui/Button";

interface FaucetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRequestFaucet: (amountUsd: number) => Promise<void>;
}

export const FaucetModal: React.FC<FaucetModalProps> = ({
  isOpen,
  onClose,
  onRequestFaucet,
}) => {
  const [amount, setAmount] = useState<number>(1000);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleClaim = async () => {
    setLoading(true);
    setSuccess(false);
    try {
      await onRequestFaucet(amount);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1500);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 font-mono text-xs select-none animate-scale-in"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Devnet Faucet"
        className="w-full max-w-md bg-surface-panel border border-line-strong rounded-lg shadow-modal p-5 relative"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-content-muted hover:text-content-primary p-1 rounded hover:bg-surface-elevated transition-colors"
          aria-label="Close faucet modal"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-full bg-surface-card border border-line-default flex items-center justify-center text-trade-amber">
            <Coins className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-sans font-bold text-sm text-content-primary">Devnet Faucet</h3>
            <p className="text-2xs text-content-muted font-sans">Mint mock USDC collateral for test trading</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-2xs text-content-muted mb-1.5 font-sans">
              Select Airdrop Amount
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[500, 1000, 5000].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setAmount(amt)}
                  className={`py-2 rounded border text-center transition-all ${
                    amount === amt
                      ? "bg-surface-elevated border-trade-emerald text-trade-emerald font-bold"
                      : "bg-surface-card border-line-default text-content-secondary hover:text-content-primary hover:bg-surface-hover"
                  }`}
                >
                  ${amt.toLocaleString()} USDC
                </button>
              ))}
            </div>
          </div>

          <div className="p-3 rounded bg-surface-card border border-line-default text-[11px] text-content-secondary space-y-1">
            <div className="flex justify-between">
              <span className="text-content-muted">Token:</span>
              <span className="text-content-primary font-medium">Mock USDC (6 Decimals)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-content-muted">Destination:</span>
              <span className="text-content-primary font-medium">Your Associated Token Account</span>
            </div>
            <div className="flex justify-between">
              <span className="text-content-muted">Max per request:</span>
              <span className="text-trade-emerald font-semibold">$10,000 USDC</span>
            </div>
          </div>

          <Button
            variant="buy"
            size="md"
            onClick={handleClaim}
            disabled={loading || success}
            className="w-full font-bold"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                <span>Minting Mock USDC...</span>
              </>
            ) : success ? (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                <span>Airdropped Successfully!</span>
              </>
            ) : (
              <span>Claim ${amount.toLocaleString()} Mock USDC</span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
