import { describe, expect, it } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { clearingPrice, clearingPriceWasm, initEpochRefWasm } from "./clearingEngine";

describe("Clearing price parity and WASM reference engine (MED-03 & B5)", () => {
  it("WASM module initializes and computes matching clearing price", async () => {
    const wasmPath = path.resolve(__dirname, "epoch_ref.wasm");
    const bytes = fs.readFileSync(wasmPath);
    initEpochRefWasm(bytes);

    const oraclePrice = 150_000_500;
    const tick = 40;
    const priceWasm = clearingPriceWasm(oraclePrice, tick, 101, 1, 1000);
    const priceTs = clearingPrice(oraclePrice, tick, 101, 1, 1000);

    expect(priceWasm).toBe(priceTs);
    expect(priceTs).toBe(149_850_000);
  });

  it("handles exact tie-breaking towards oracle price rather than unconditional round up", () => {
    // When remainder is exactly half the price tick (500 micro-USDC)
    const oraclePrice = 150_000_500;
    const tick = 40;
    const price = clearingPrice(oraclePrice, tick, 101, 1, 1000);
    // Old buggy implementation returned 149_851_000 because of unconditional round-up
    expect(price).toBe(149_850_000);
  });
});
