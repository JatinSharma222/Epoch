"use client";

import React, { useState } from "react";
import { X, ArrowDownLeft, ArrowUpRight, Loader2, AlertCircle } from "lucide-react";
import { Button } from "./ui/Button";

interface DepositWithdrawModalProps {
  isOpen: boolean;
  mode: "deposit" | "withdraw";
  onClose: () => void;
  collateralBalance: number;
  isPositionFlat: boolean;
  onDeposit: (amountUsd: number) => Promise<void>;
  onWithdraw: (amountUsd: number) => Promise<void>;
}

export const DepositWithdrawModal: React.FC<DepositWithdrawModalProps> = ({
  isOpen,
  mode: initialMode,
  onClose,
  collateralBalance,
  isPositionFlat,
  onDeposit,
  onWithdraw,
}) => {
  const [mode, setMode] = useState<"deposit" | "withdraw">(initialMode);
  const [amount, setAmount] = useState<string>("500");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const numAmount = parseFloat(amount) || 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (numAmount <= 0) return;
    setLoading(true);
    try {
      if (mode === "deposit") {
        await onDeposit(numAmount);
      } else {
        await onWithdraw(numAmount);
      }
      onClose();
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
        aria-label="Deposit and Withdraw Collateral"
        className="w-full max-w-md bg-surface-panel border border-line-strong rounded-lg shadow-modal p-5 relative"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-content-muted hover:text-content-primary p-1 rounded hover:bg-surface-elevated transition-colors"
          aria-label="Close deposit and withdrawal modal"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Mode Toggle Header */}
        <div className="flex gap-2 mb-4 p-1 bg-surface-card rounded-lg border border-line-default">
          <button
            type="button"
            onClick={() => setMode("deposit")}
            className={`flex-1 py-1.5 rounded font-semibold text-xs flex items-center justify-center gap-1.5 transition-all ${
              mode === "deposit"
                ? "bg-trade-emerald/15 text-trade-emerald border border-trade-emerald/40 shadow-xs"
                : "text-content-muted hover:text-content-primary hover:bg-surface-hover"
            }`}
          >
            <ArrowDownLeft className="w-4 h-4" />
            <span>Deposit Collateral</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("withdraw")}
            className={`flex-1 py-1.5 rounded font-semibold text-xs flex items-center justify-center gap-1.5 transition-all ${
              mode === "withdraw"
                ? "bg-surface-elevated text-content-primary border border-line-strong shadow-xs"
                : "text-content-muted hover:text-content-primary hover:bg-surface-hover"
            }`}
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>Withdraw Collateral</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex justify-between text-2xs text-content-muted mb-1 font-sans">
              <span>Amount</span>
              {mode === "withdraw" && (
                <span>
                  Available: ${collateralBalance.toFixed(2)} USDC
                </span>
              )}
            </div>

            <div className="flex items-center justify-between bg-surface-card rounded-md border border-line-default px-3 py-2">
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-transparent text-content-primary font-mono text-sm font-semibold focus:outline-none"
              />
              {mode === "withdraw" && (
                <button
                  type="button"
                  onClick={() => setAmount(collateralBalance.toString())}
                  className="px-2 py-0.5 rounded bg-surface-elevated text-trade-emerald text-[10px] font-bold uppercase ml-2 hover:bg-surface-hover transition-colors"
                >
                  Max
                </button>
              )}
              <span className="text-xs font-bold text-content-primary ml-2">USDC</span>
            </div>
          </div>

          {/* Flat Position Rule Warning for Withdrawals (Guardrail G-07) */}
          {mode === "withdraw" && !isPositionFlat && (
            <div className="p-3 rounded bg-trade-coral/10 border border-trade-coral/30 text-trade-coral text-2xs flex gap-2 items-start font-sans">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>Flat Position & Zero Orders Rule (G-07):</strong> Withdrawals require base position to be 0 and zero active batch orders to ensure exact collateral conservation.
              </span>
            </div>
          )}

          <Button
            variant={mode === "deposit" ? "buy" : "primary"}
            size="md"
            type="submit"
            disabled={
              loading ||
              numAmount <= 0 ||
              (mode === "withdraw" && (!isPositionFlat || numAmount > collateralBalance))
            }
            className="w-full font-bold"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                <span>Processing Transaction...</span>
              </>
            ) : mode === "deposit" ? (
              <span>Deposit ${numAmount.toFixed(2)} USDC</span>
            ) : (
              <span>Withdraw ${numAmount.toFixed(2)} USDC</span>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
};
