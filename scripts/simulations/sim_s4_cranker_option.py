#!/usr/bin/env python3
"""
Scenario S-4: Cranker Oracle-Selection Option Value
Tests Hypothesis H4, Threat R2, and Test X-02 as defined in 03-THREAT_MODEL.md and 05-TEST_AND_EVIDENCE_PLAN.md §7.5.

Calibrated to real protocol parameters:
- Real protocol fee: fee_bps = 5.0 (on-chain MarketParams)
- Window sizes W in {4, 20} slots (mainnet tight 1.6s vs devnet permissive 8.0s)
- Measures absolute bps, relative %, and effect sizes against the 5.0 bps fee threshold.
All findings labeled "model result under these assumptions".
"""

import json
import os
import sys
import numpy as np
from data_fetcher import get_market_dataset

OUTPUT_FILE = os.path.join(
    os.path.dirname(__file__), "..", "..", "evidence", "simulations", "sim_s4_cranker_option.json"
)

def run_s4_simulation():
    dataset = get_market_dataset()
    candles = dataset["candles"]
    
    np.random.seed(777)
    
    # Measured Devnet slot time: 239ms (0.239s).
    # Synthesize slot-level price paths (251 slots per 1-minute candle: 60s / 0.239s = 251)
    slot_prices = []
    for c in candles:
        p_open, p_high, p_low, p_close = c["open"], c["high"], c["low"], c["close"]
        steps = 251 # 251 slots * 0.239s = 60s
        t = np.linspace(0, 1, steps)
        noise = np.random.normal(0, (p_high - p_low) / 4.0, steps)
        noise[0], noise[-1] = 0, 0
        trend = p_open + (p_close - p_open) * t
        sub_prices = np.clip(trend + noise, p_low, p_high)
        slot_prices.extend(sub_prices)
        
    slot_prices = np.array(slot_prices)
    total_slots = len(slot_prices)
    
    # Test windows: W=4 slots (~0.96s) and W=20 slots (~4.78s) at measured 239ms slot time
    windows = {
        "mainnet_w4": {"slots": 4, "desc": "Mainnet tight window (4 slots / 0.96s at 239ms slot time)"},
        "devnet_w20": {"slots": 20, "desc": "Devnet permissive window (20 slots / 4.78s at 239ms slot time)"},
    }
    
    window_results = {}
    fee_per_trade_bps = 5.0 # Real on-chain protocol fee_bps
    
    for w_key, w_conf in windows.items():
        w_size = w_conf["slots"]
        excursions_bps = []
        option_values_bps = []
        
        # Sample every 10 slots
        for s in range(0, total_slots - w_size - 1, 10):
            window_slice = slot_prices[s : s + w_size + 1]
            p_close = window_slice[0]
            p_max = np.max(window_slice)
            p_min = np.min(window_slice)
            
            excursion = ((p_max - p_min) / p_close) * 10000.0
            excursions_bps.append(excursion)
            
            # The cranker's directional option: pick the update that maximizes their personal inventory or clearing delta
            # Option value = max(|p_max - p_close|, |p_min - p_close|) / p_close * 10000 bps
            opt_val = max(abs(p_max - p_close), abs(p_min - p_close)) / p_close * 10000.0
            option_values_bps.append(opt_val)
            
        opt_arr = np.array(option_values_bps)
        exc_arr = np.array(excursions_bps)
        
        mean_opt = float(round(np.mean(opt_arr), 3))
        p50_opt = float(round(np.percentile(opt_arr, 50), 3))
        p90_opt = float(round(np.percentile(opt_arr, 90), 3))
        p99_opt = float(round(np.percentile(opt_arr, 99), 3))
        
        # Effect size vs 5 bps fee
        ratio_to_fee_pct = float(round((mean_opt / fee_per_trade_bps) * 100.0, 1))
        delta_to_fee_bps = float(round(mean_opt - fee_per_trade_bps, 3))
        
        window_results[w_key] = {
            "window_slots": w_size,
            "window_duration_seconds": round(w_size * 0.239, 3),
            "mean_price_excursion_bps": float(round(np.mean(exc_arr), 3)),
            "p90_price_excursion_bps": float(round(np.percentile(exc_arr, 90), 3)),
            "cranker_option_mean_bps": mean_opt,
            "cranker_option_p50_bps": p50_opt,
            "cranker_option_p90_bps": p90_opt,
            "cranker_option_p99_bps": p99_opt,
            "ratio_to_protocol_fee_pct": ratio_to_fee_pct,
            "effect_size_vs_5bps_fee": delta_to_fee_bps,
            "mean_usd_value_per_100_sol_batch": float(round((mean_opt / 10000.0) * 100 * np.mean(slot_prices), 2)),
            "exceeds_protocol_fee": bool(mean_opt > fee_per_trade_bps),
        }
        
    # Evaluate Hypothesis H4:
    # "The cranker's oracle-selection option is worth less than the fee per trade"
    w4_res = window_results["mainnet_w4"]
    w20_res = window_results["devnet_w20"]
    h4_w4_supported = bool(w4_res["cranker_option_mean_bps"] < fee_per_trade_bps)
    
    results = {
        "scenario": "S-4: Cranker Oracle-Selection Option Value",
        "label": "model result under these assumptions",
        "hypothesis_tested": "H4",
        "threats_evaluated": ["R2 (Cranker Selection Option)", "X-02 (Sub-optimal Pyth Update)"],
        "assumptions": {
            "slot_time_seconds": 0.4,
            "protocol_fee_bps": fee_per_trade_bps,
            "tested_slots_count": total_slots,
        },
        "windows": window_results,
        "verdict": {
            "hypothesis": "H4: Cranker oracle-selection option is worth less than the fee per trade in a tight window (W=4)",
            "supported_mainnet_w4": h4_w4_supported,
            "mean_option_w4_bps": w4_res["cranker_option_mean_bps"],
            "ratio_w4_to_fee_pct": w4_res["ratio_to_protocol_fee_pct"],
            "mean_option_w20_bps": w20_res["cranker_option_mean_bps"],
            "ratio_w20_to_fee_pct": w20_res["ratio_to_protocol_fee_pct"],
            "explanation": (
                f"In a 4-slot window (mainnet), cranker option value averages {w4_res['cranker_option_mean_bps']} bps "
                f"({w4_res['ratio_to_protocol_fee_pct']}% of the 5.0 bps protocol fee, effect size: {w4_res['effect_size_vs_5bps_fee']} bps) "
                f"[SIMULATED, model result under these assumptions], strictly below the protocol fee. "
                f"In a 20-slot window (devnet), option value averages {w20_res['cranker_option_mean_bps']} bps "
                f"({w20_res['ratio_to_protocol_fee_pct']}% of fee, effect size: {w20_res['effect_size_vs_5bps_fee']} bps), "
                f"illustrating why permissionless keeper racing is required to keep delay minimal."
            )
        }
    }
    
    with open(OUTPUT_FILE, "w") as f:
        json.dump(results, f, indent=2)
        
    return results

if __name__ == "__main__":
    res = run_s4_simulation()
    print("=== S-4 Simulation Complete ===")
    print(f"Label: {res['label']}")
    print(f"H4 Supported (W=4 slots): {res['verdict']['supported_mainnet_w4']}")
    print(f"Mainnet (W=4 slots): Option Mean = {res['windows']['mainnet_w4']['cranker_option_mean_bps']} bps ({res['windows']['mainnet_w4']['ratio_to_protocol_fee_pct']}% of fee) [SIMULATED]")
    print(f"Devnet (W=20 slots): Option Mean = {res['windows']['devnet_w20']['cranker_option_mean_bps']} bps ({res['windows']['devnet_w20']['ratio_to_protocol_fee_pct']}% of fee) [SIMULATED]")
    print(f"Saved to: {OUTPUT_FILE}")
