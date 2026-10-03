"use client";

import React, { useState } from "react";
import { Coins, X, Loader2, CheckCircle2 } from "lucide-react";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 font-mono text-[12px]">
      <div className="w-full max-w-md bg-[#111418] border bp-border rounded-lg shadow-2xl p-5 relative select-none">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#848e9c] hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-full bg-[#181d24] border bp-border flex items-center justify-center text-[#eab308]">
            <Coins className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-sans font-bold text-[15px] text-white">Devnet Faucet</h3>
            <p className="text-[11px] text-[#848e9c]">Mint mock USDC collateral for test trading</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[11px] text-[#848e9c] mb-1.5">
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
                      ? "bg-[#181d24] border-[#0ecb81] text-[#0ecb81] font-bold"
                      : "bg-[#12161c] bp-border text-[#848e9c] hover:text-white"
                  }`}
                >
                  ${amt.toLocaleString()} USDC
                </button>
              ))}
            </div>
          </div>

          <div className="p-3 rounded bg-[#12161c] border bp-border text-[11px] text-[#848e9c] space-y-1">
            <div className="flex justify-between">
              <span>Token:</span>
              <span className="text-white">Mock USDC (6 Decimals)</span>
            </div>
            <div className="flex justify-between">
              <span>Destination:</span>
              <span className="text-white">Your Associated Token Account</span>
            </div>
            <div className="flex justify-between">
              <span>Max per request:</span>
              <span className="text-[#0ecb81]">$10,000 USDC</span>
            </div>
          </div>

          <button
            onClick={handleClaim}
            disabled={loading || success}
            className="w-full py-2.5 rounded bg-[#0ecb81] hover:bg-[#00a372] text-[#0b0e11] font-bold text-[13px] flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Minting Mock USDC...</span>
              </>
            ) : success ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-[#0b0e11]" />
                <span>Airdropped Successfully!</span>
              </>
            ) : (
              <span>Claim ${amount.toLocaleString()} Mock USDC</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
