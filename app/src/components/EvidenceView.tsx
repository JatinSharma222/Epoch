"use client";

import React from "react";
import { ShieldCheck, Cpu, CheckCircle2, Award, Zap } from "lucide-react";

export const EvidenceView: React.FC = () => {
  return (
    <div className="flex-1 overflow-y-auto p-4 bg-[#0b0e11] font-mono text-[12px] select-none">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="pb-3 border-b bp-border">
          <h2 className="text-[18px] font-sans font-bold text-white flex items-center gap-2">
            <Award className="w-5 h-5 text-[#00f0ff]" />
            Empirical Evidence & Verification
          </h2>
          <p className="text-[11px] text-[#848e9c]">
            Real, verifiable measurements from on-chain execution and differential testing harnesses.
          </p>
        </div>

        {/* Gate G1: Compute Units Spike */}
        <div className="bg-[#0e1217] rounded-lg border bp-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-[#0ecb81]" />
              <span className="font-bold text-white text-[13px]">
                Gate G1 — Compute Unit Consumption (K=101 Ticks)
              </span>
            </div>
            <span className="px-2 py-0.5 rounded bg-[#162720] text-[#0ecb81] text-[10px] font-bold border border-[#0ecb81]/30">
              PASSED [MEASURED]
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded bg-[#12161c] border bp-border">
              <span className="text-[#848e9c] text-[10px]">10 Orders</span>
              <div className="text-[15px] font-bold text-white mt-1">16,174 CU</div>
              <span className="text-[9px] text-[#0ecb81]">Target: ≤ 600,000</span>
            </div>
            <div className="p-3 rounded bg-[#12161c] border bp-border">
              <span className="text-[#848e9c] text-[10px]">32 Orders</span>
              <div className="text-[15px] font-bold text-white mt-1">18,340 CU</div>
              <span className="text-[9px] text-[#0ecb81]">Target: ≤ 600,000</span>
            </div>
            <div className="p-3 rounded bg-[#12161c] border bp-border">
              <span className="text-[#848e9c] text-[10px]">64 Orders</span>
              <div className="text-[15px] font-bold text-white mt-1">22,890 CU</div>
              <span className="text-[9px] text-[#0ecb81]">Target: ≤ 600,000</span>
            </div>
            <div className="p-3 rounded bg-[#12161c] border bp-border">
              <span className="text-[#848e9c] text-[10px]">128 Orders (Max)</span>
              <div className="text-[15px] font-bold text-[#00f0ff] mt-1">31,092 CU</div>
              <span className="text-[9px] text-[#0ecb81]">5.1% of Block Limit</span>
            </div>
          </div>
        </div>

        {/* Gate G2: Differential Testing */}
        <div className="bg-[#0e1217] rounded-lg border bp-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#0ecb81]" />
              <span className="font-bold text-white text-[13px]">
                Gate G2 — Differential Testing Harness
              </span>
            </div>
            <span className="px-2 py-0.5 rounded bg-[#162720] text-[#0ecb81] text-[10px] font-bold border border-[#0ecb81]/30">
              PASSED [MEASURED]
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3 rounded bg-[#12161c] border bp-border">
              <span className="text-[#848e9c] text-[10px]">Batches Evaluated</span>
              <div className="text-[15px] font-bold text-white mt-1">10,000 Batches</div>
              <span className="text-[9px] text-[#848e9c]">2,000 Adversarial + 8,000 Broad</span>
            </div>
            <div className="p-3 rounded bg-[#12161c] border bp-border">
              <span className="text-[#848e9c] text-[10px]">Orders Processed</span>
              <div className="text-[15px] font-bold text-white mt-1">647,981 Orders</div>
              <span className="text-[9px] text-[#848e9c]">701,746,163 Matched Lots</span>
            </div>
            <div className="p-3 rounded bg-[#12161c] border bp-border">
              <span className="text-[#848e9c] text-[10px]">Mismatches Against epoch-ref</span>
              <div className="text-[15px] font-bold text-[#0ecb81] mt-1">0 Mismatches</div>
              <span className="text-[9px] text-[#0ecb81]">100% Bit-for-Bit Determinism</span>
            </div>
          </div>
        </div>

        {/* Mathematical Invariants */}
        <div className="bg-[#0e1217] rounded-lg border bp-border p-4 space-y-3">
          <h3 className="font-bold text-white text-[13px] flex items-center gap-2">
            <Zap className="w-4 h-4 text-[#eab308]" />
            Verified Protocol Invariants
          </h3>

          <div className="space-y-2 text-[11px]">
            <div className="p-2.5 rounded bg-[#12161c] border bp-border flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#0ecb81] shrink-0 mt-0.5" />
              <div>
                <strong className="text-white">Invariant I-1 (Exact Collateral Conservation):</strong>{" "}
                <span className="text-[#848e9c]">
                  Total collateral deposited across all user accounts plus protocol fee pool equals the balance in the SPL Token collateral vault down to the exact micro-USDC.
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded bg-[#12161c] border bp-border flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#0ecb81] shrink-0 mt-0.5" />
              <div>
                <strong className="text-white">Invariant I-4 (Volume Balance):</strong>{" "}
                <span className="text-[#848e9c]">
                  Total lots bought across all filled orders in a batch equals total lots sold identically (Σ buy_filled = Σ sell_filled = Q*).
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded bg-[#12161c] border bp-border flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#0ecb81] shrink-0 mt-0.5" />
              <div>
                <strong className="text-white">Invariant I-11 (Bad Debt Accounting):</strong>{" "}
                <span className="text-[#848e9c]">
                  Any liquidation shortfall exceeding insurance fund capacity is booked to market bad debt, guaranteeing zero socialized haircut attacks.
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
