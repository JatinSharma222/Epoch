import { Connection, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { OraclePriceData } from "./types";

export class PythOracleService {
  private connection: Connection;
  private feedId: string;
  private priceFeedAccount: PublicKey | null = null;

  // ─── Hermes & API Key Config ──────────────────────────────────────────────
  private apiKey: string | null = null;
  private hermesUrl: string;

  // ─── In-Memory Cache ──────────────────────────────────────────────────────
  private cachedBinaryData: string[] | null = null;
  private cachedBinaryTimestampMs: number = 0;
  private cachedPrice: OraclePriceData | null = null;

  // ─── Streaming State ──────────────────────────────────────────────────────
  private streamAbortController: AbortController | null = null;
  private isStreaming: boolean = false;

  // ─── Rate Limiter for Keyless Access (<= 10 reqs / 10s -> min 1100ms) ─────
  public static readonly KEYLESS_MIN_INTERVAL_MS = 1100;
  private lastKeylessFetchMs: number = 0;

  constructor(
    connection: Connection,
    feedId: string = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"
  ) {
    this.connection = connection;
    this.feedId = feedId;

    // Load API Key from environment (never hardcoded)
    this.apiKey = process.env.HERMES_API_KEY || process.env.PYTH_API_KEY || null;

    // Hermes endpoint selection:
    // If API key supplied, default to the upgraded Pyth endpoint; otherwise fall back to public.
    if (process.env.HERMES_URL) {
      this.hermesUrl = process.env.HERMES_URL;
    } else if (this.apiKey) {
      this.hermesUrl = "https://pyth.dourolabs.app/hermes";
    } else {
      this.hermesUrl = "https://hermes.pyth.network";
    }
  }

  /**
   * Returns current Hermes configuration (redacting any key).
   */
  public getConfigSummary(): { endpoint: string; hasKey: boolean; streaming: boolean } {
    return {
      endpoint: this.hermesUrl,
      hasKey: !!this.apiKey,
      streaming: this.isStreaming,
    };
  }

  /**
   * Resolves Pyth price feed account address using Pyth Solana receiver SDK.
   */
  public async getPriceFeedAccount(): Promise<PublicKey> {
    if (this.priceFeedAccount) return this.priceFeedAccount;
    try {
      const { PythSolanaReceiver } = await import(
        "@pythnetwork/pyth-solana-receiver"
      );
      const receiver = new PythSolanaReceiver({
        connection: this.connection,
        wallet: {} as any,
      });
      this.priceFeedAccount = receiver.getPriceFeedAccountAddress(
        0,
        this.feedId
      );
      return this.priceFeedAccount;
    } catch {
      // Devnet sponsored shard 0 feed account fallback
      this.priceFeedAccount = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
      return this.priceFeedAccount;
    }
  }

  // ─── Hermes Streaming (SSE) ───────────────────────────────────────────────

  /**
   * Starts background Hermes Server-Sent Events (SSE) streaming.
   * Keeps the latest price update binary and parsed price continuously fresh in memory.
   */
  public startPriceStream(): void {
    if (this.isStreaming) return;
    this.isStreaming = true;
    this.streamAbortController = new AbortController();

    this.runStreamLoop(this.streamAbortController.signal).catch(() => {});
  }

  /**
   * Stops the SSE stream.
   */
  public stopPriceStream(): void {
    this.isStreaming = false;
    if (this.streamAbortController) {
      this.streamAbortController.abort();
      this.streamAbortController = null;
    }
  }

  private async runStreamLoop(signal: AbortSignal): Promise<void> {
    const cleanFeedId = this.feedId.startsWith("0x") ? this.feedId.slice(2) : this.feedId;
    const streamUrl = `${this.hermesUrl}/v2/updates/price/stream?ids[]=${cleanFeedId}&encoding=hex&parsed=true`;

    while (!signal.aborted && this.isStreaming) {
      try {
        const headers: Record<string, string> = {
          Accept: "text/event-stream",
        };
        if (this.apiKey) {
          headers["Authorization"] = `Bearer ${this.apiKey}`;
        }

        const res = await fetch(streamUrl, {
          headers,
          signal,
        });

        if (!res.ok || !res.body) {
          // If unauthorized or server error, wait 5s before reconnecting
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!signal.aborted && this.isStreaming) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const messages = buffer.split("\n\n");
          buffer = messages.pop() || "";

          for (const msg of messages) {
            const dataLine = msg.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            try {
              const parsed = JSON.parse(dataLine.slice(6).trim());
              this.handleStreamPayload(parsed);
            } catch {
              // Ignore unparseable frames (e.g. ping/comments)
            }
          }
        }
      } catch (err: any) {
        if (signal.aborted) return;
        // Backoff before reconnecting to prevent thrashing
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  private handleStreamPayload(payload: any): void {
    if (payload.binary && payload.binary.data && payload.binary.data.length > 0) {
      this.cachedBinaryData = payload.binary.data;
      this.cachedBinaryTimestampMs = Date.now();
    }
    if (payload.parsed && payload.parsed.length > 0) {
      const p = payload.parsed[0].price;
      if (p) {
        const rawPrice = Number(p.price);
        const expo = Number(p.expo);
        const conf = Number(p.conf);
        const publishTime = Number(p.publish_time);
        const scaleFactor = Math.pow(10, expo + 6);
        const microUsdcPrice = Math.round(rawPrice * scaleFactor);
        const microUsdcConf = Math.round(conf * scaleFactor);

        this.cachedPrice = {
          price: new anchor.BN(microUsdcPrice),
          conf: new anchor.BN(microUsdcConf),
          postedSlot: new anchor.BN(0),
          publishTime: new anchor.BN(publishTime),
          isFallback: false,
        };
      }
    }
  }

  // ─── Rate Limiter for Keyless REST Fallback ────────────────────────────────

  private async enforceRateLimit(): Promise<void> {
    if (this.apiKey) return; // Authenticated endpoints are not subject to public tier limit
    const now = Date.now();
    const elapsed = now - this.lastKeylessFetchMs;
    if (elapsed < PythOracleService.KEYLESS_MIN_INTERVAL_MS) {
      const waitMs = PythOracleService.KEYLESS_MIN_INTERVAL_MS - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    this.lastKeylessFetchMs = Date.now();
  }

  /**
   * Fetches the latest binary update from Hermes REST endpoint.
   * Strictly obeys the 10 requests / 10s rate limit when keyless.
   */
  public async fetchLatestBinaryUpdate(): Promise<string[] | null> {
    // 1. If in-memory stream cache is fresh (< 3s old), return immediately
    const now = Date.now();
    if (this.cachedBinaryData && now - this.cachedBinaryTimestampMs < 3000) {
      return this.cachedBinaryData;
    }

    // 2. Otherwise fetch from REST with rate limit enforcement
    await this.enforceRateLimit();
    try {
      const cleanFeedId = this.feedId.startsWith("0x") ? this.feedId.slice(2) : this.feedId;
      const url = `${this.hermesUrl}/v2/updates/price/latest?ids[]=${cleanFeedId}&encoding=hex&parsed=true`;
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }

      const res = await fetch(url, { headers });
      if (res.ok) {
        const body: any = await res.json();
        if (body.binary && body.binary.data && body.binary.data.length > 0) {
          this.cachedBinaryData = body.binary.data;
          this.cachedBinaryTimestampMs = Date.now();
          if (body.parsed && body.parsed.length > 0) {
            this.handleStreamPayload(body);
          }
          return this.cachedBinaryData;
        }
      }
    } catch {
      // Fallback
    }

    // Return cached even if slightly older rather than failing
    return this.cachedBinaryData;
  }

  /**
   * Builds instructions to post/update the Pyth price feed account.
   * If in-memory cache from SSE stream is fresh (< 10s old), uses it immediately (0ms network delay).
   */
  public async postPriceUpdateInstructions(
    wallet: any
  ): Promise<anchor.web3.TransactionInstruction[]> {
    try {
      let binaryData = this.cachedBinaryData;
      const now = Date.now();

      // If cache is empty or older than 8s, trigger fetch (respecting rate limits)
      if (!binaryData || now - this.cachedBinaryTimestampMs > 8000) {
        binaryData = await this.fetchLatestBinaryUpdate();
      }

      if (binaryData && binaryData.length > 0) {
        const { PythSolanaReceiver } = await import(
          "@pythnetwork/pyth-solana-receiver"
        );
        const receiver = new PythSolanaReceiver({
          connection: this.connection,
          wallet,
        });
        const { postInstructions } = await receiver.buildUpdatePriceFeedInstructions(
          binaryData,
          0
        );
        return postInstructions.map((ix: any) => ix.instruction);
      }
    } catch {
      // Fallback if Hermes unreachable or offline
    }
    return [];
  }

  /**
   * Fetches latest price from Pyth on-chain receiver.
   * If not available (e.g. localnet or unposted feed), falls back to cached stream price or defaultPrice.
   */
  public async getLatestPrice(
    defaultPrice: number = 150_000_000
  ): Promise<OraclePriceData> {
    const currentSlot = await this.connection.getSlot();
    try {
      const { PythSolanaReceiver } = await import(
        "@pythnetwork/pyth-solana-receiver"
      );
      const receiver = new PythSolanaReceiver({
        connection: this.connection,
        wallet: {} as any,
      });
      const priceFeedAccount = receiver.getPriceFeedAccountAddress(
        0,
        this.feedId
      );
      const accInfo = await this.connection.getAccountInfo(priceFeedAccount);
      if (accInfo && accInfo.data.length > 0) {
        const priceUpdate = await receiver.fetchPriceUpdateAccount(
          priceFeedAccount
        );
        const rawPrice = Number(priceUpdate.priceMessage.price);
        const exponent = priceUpdate.priceMessage.exponent;
        const rawConf = Number(priceUpdate.priceMessage.conf);
        const postedSlot = Number(priceUpdate.postedSlot);
        const publishTime = Number(priceUpdate.priceMessage.publishTime);

        // Convert rawPrice (with exponent, typically -8) to micro-USDC (6 decimals)
        const scaleFactor = Math.pow(10, exponent + 6);
        const microUsdcPrice = Math.round(rawPrice * scaleFactor);
        const microUsdcConf = Math.round(rawConf * scaleFactor);

        return {
          price: new anchor.BN(microUsdcPrice),
          conf: new anchor.BN(microUsdcConf),
          postedSlot: new anchor.BN(postedSlot),
          publishTime: new anchor.BN(publishTime),
          isFallback: false,
        };
      }
    } catch {
      // Fallback below
    }

    // Fallback 1: in-memory cached streaming price if available
    if (this.cachedPrice) {
      return {
        ...this.cachedPrice,
        postedSlot: new anchor.BN(currentSlot),
      };
    }

    // Fallback 2: Use default price, 0 conf, current slot, current timestamp
    return {
      price: new anchor.BN(defaultPrice),
      conf: new anchor.BN(0),
      postedSlot: new anchor.BN(currentSlot),
      publishTime: new anchor.BN(Math.floor(Date.now() / 1000)),
      isFallback: true,
    };
  }
}
