"use client";

import React, { useState } from "react";
import { X, ArrowDownLeft, ArrowUpRight, Loader2, AlertCircle } from "lucide-react";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 font-mono text-[12px]">
      <div className="w-full max-w-md bg-[#111418] border bp-border rounded-lg shadow-2xl p-5 relative select-none">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#848e9c] hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Mode Toggle Header */}
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setMode("deposit")}
            className={`flex-1 py-1.5 rounded font-semibold text-[13px] flex items-center justify-center gap-1.5 transition-all ${
              mode === "deposit"
                ? "bg-[#162720] text-[#0ecb81] border border-[#0ecb81]/30"
                : "text-[#848e9c] hover:text-white"
            }`}
          >
            <ArrowDownLeft className="w-4 h-4" />
            <span>Deposit Collateral</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("withdraw")}
            className={`flex-1 py-1.5 rounded font-semibold text-[13px] flex items-center justify-center gap-1.5 transition-all ${
              mode === "withdraw"
                ? "bg-[#181d24] text-white border bp-border"
                : "text-[#848e9c] hover:text-white"
            }`}
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>Withdraw Collateral</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex justify-between text-[11px] text-[#848e9c] mb-1">
              <span>Amount</span>
              {mode === "withdraw" && (
                <span>
                  Available: ${collateralBalance.toFixed(2)} USDC
                </span>
              )}
            </div>

            <div className="flex items-center justify-between bg-[#12161c] rounded-md border bp-border px-3 py-2">
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-transparent text-white font-mono text-[14px] font-semibold focus:outline-none"
              />
              {mode === "withdraw" && (
                <button
                  type="button"
                  onClick={() => setAmount(collateralBalance.toString())}
                  className="px-2 py-0.5 rounded bg-[#181d24] text-[#0ecb81] text-[10px] font-bold uppercase ml-2 hover:bg-[#1f2633]"
                >
                  Max
                </button>
              )}
              <span className="text-[12px] font-bold text-white ml-2">USDC</span>
            </div>
          </div>

          {/* Flat Position Rule Warning for Withdrawals */}
          {mode === "withdraw" && !isPositionFlat && (
            <div className="p-3 rounded bg-[#2a1619] border border-[#f6465d]/30 text-[#f6465d] text-[11px] flex gap-2 items-start">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>Flat Position Rule:</strong> Withdrawals require base position to be 0 (no open positions or pending orders) to ensure exact collateral conservation.
              </span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || numAmount <= 0 || (mode === "withdraw" && (!isPositionFlat || numAmount > collateralBalance))}
            className="w-full py-2.5 rounded bg-[#0ecb81] hover:bg-[#00a372] text-[#0b0e11] font-bold text-[13px] flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Processing Transaction...</span>
              </>
            ) : mode === "deposit" ? (
              <span>Deposit ${numAmount.toFixed(2)} USDC</span>
            ) : (
              <span>Withdraw ${numAmount.toFixed(2)} USDC</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
