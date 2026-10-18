import { describe, expect, it } from "bun:test";
import { deriveWsUrl } from "./keeper";

describe("Keeper WebSocket URL derivation (LOW-02)", () => {
  it("derives ws://localhost:8900 from http://localhost:8899 for localnet pubsub", () => {
    const rpc = "http://localhost:8899";
    const ws = deriveWsUrl(rpc);
    expect(ws).toBe("ws://localhost:8900");
  });

  it("derives ws://127.0.0.1:8900 from http://127.0.0.1:8899 for localnet pubsub", () => {
    const rpc = "http://127.0.0.1:8899";
    const ws = deriveWsUrl(rpc);
    expect(ws).toBe("ws://127.0.0.1:8900");
  });

  it("derives wss:// from https:// on remote networks without altering non-8899 ports", () => {
    const rpc = "https://api.devnet.solana.com";
    const ws = deriveWsUrl(rpc);
    expect(ws).toBe("wss://api.devnet.solana.com");
  });

  it("preserves explicit wsUrl when provided", () => {
    const rpc = "http://localhost:8899";
    const explicit = "wss://custom.solana.rpc.com";
    const ws = deriveWsUrl(rpc, explicit);
    expect(ws).toBe("wss://custom.solana.rpc.com");
  });
});
