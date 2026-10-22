/**
 * Epoch Protocol — Trusted Multi-Venue Median Oracle Aggregator
 *
 * Combines real-time L1 BBO ticks from 6 approved crypto exchanges:
 * - Coinbase (SOL-USD)
 * - Kraken (SOL/USD)
 * - Bybit (SOLUSDC)
 * - Backpack (SOL_USDC)
 * - Hyperliquid (SOL Perp-Mid)
 * - Binance (SOLUSDC)
 *
 * Rules:
 * 1. Freshness: Drop sources older than 2,000 ms.
 * 2. Outlier Rejection: Drop sources deviating > 30 bps from median.
 * 3. Quorum: Requires at least 3 fresh, non-outlier sources.
 * 4. Confidence: Derived from cross-venue spread; flagged low if spread > 10 bps or outliers present.
 * 5. Memory: O(1) storage per venue, zero unbounded array growth.
 * 6. Audit Trail: Appends tick and aggregate records to JSONL log.
 */

import * as fs from "fs";
import * as path from "path";
import { VenueFeed, FeedConfig } from "./venue_feed";
import { AggregatePrice, VenueHealth, AggregatorLogEntry } from "./types";

export const APPROVED_FEEDS: FeedConfig[] = [
  {
    id: "coinbase",
    name: "Coinbase",
    pair: "SOL-USD",
    wsUrl: "wss://ws-feed.exchange.coinbase.com",
    subPayload: {
      type: "subscribe",
      product_ids: ["SOL-USD"],
      channels: ["ticker"],
    },
    parse: (msg) => {
      if (msg.type === "ticker" && msg.best_bid && msg.best_ask) {
        return {
          bid: parseFloat(msg.best_bid),
          ask: parseFloat(msg.best_ask),
          exchTimeMs: msg.time ? Date.parse(msg.time) : undefined,
        };
      }
      return null;
    },
  },
  {
    id: "kraken",
    name: "Kraken",
    pair: "SOL/USD",
    wsUrl: "wss://ws.kraken.com/v2",
    subPayload: {
      method: "subscribe",
      params: { channel: "ticker", symbol: ["SOL/USD"] },
    },
    parse: (msg) => {
      if (msg.channel === "ticker" && msg.data?.[0]) {
        const d = msg.data[0];
        if (d.bid !== undefined && d.ask !== undefined) {
          return {
            bid: parseFloat(d.bid),
            ask: parseFloat(d.ask),
            exchTimeMs: d.timestamp ? Date.parse(d.timestamp) : undefined,
          };
        }
      }
      return null;
    },
  },
  {
    id: "bybit",
    name: "Bybit",
    pair: "SOLUSDC",
    wsUrl: "wss://stream.bybit.com/v5/public/spot",
    subPayload: {
      op: "subscribe",
      args: ["orderbook.1.SOLUSDC"],
    },
    pingIntervalMs: 20000,
    pingPayload: { op: "ping" },
    parse: (msg) => {
      if (msg.topic === "orderbook.1.SOLUSDC" && msg.data?.b?.[0] && msg.data?.a?.[0]) {
        return {
          bid: parseFloat(msg.data.b[0][0]),
          ask: parseFloat(msg.data.a[0][0]),
          exchTimeMs: msg.ts ? Number(msg.ts) : undefined,
        };
      }
      return null;
    },
  },
  {
    id: "backpack",
    name: "Backpack",
    pair: "SOL_USDC",
    wsUrl: "wss://ws.backpack.exchange",
    subPayload: {
      method: "SUBSCRIBE",
      params: ["bookTicker.SOL_USDC"],
    },
    parse: (msg) => {
      if (msg.stream === "bookTicker.SOL_USDC" && msg.data?.b && msg.data?.a) {
        return {
          bid: parseFloat(msg.data.b),
          ask: parseFloat(msg.data.a),
          exchTimeMs: msg.data.T ? Math.floor(msg.data.T / 1000) : undefined,
        };
      }
      return null;
    },
  },
  {
    id: "hyperliquid",
    name: "Hyperliquid",
    pair: "SOL",
    wsUrl: "wss://api.hyperliquid.xyz/ws",
    subPayload: {
      method: "subscribe",
      subscription: { type: "l2Book", coin: "SOL" },
    },
    parse: (msg) => {
      if (msg.channel === "l2Book" && msg.data?.levels?.[0]?.[0] && msg.data?.levels?.[1]?.[0]) {
        return {
          bid: parseFloat(msg.data.levels[0][0].px),
          ask: parseFloat(msg.data.levels[1][0].px),
          exchTimeMs: msg.data.time ? Number(msg.data.time) : undefined,
        };
      }
      return null;
    },
  },
  {
    id: "binance",
    name: "Binance",
    pair: "SOLUSDC",
    wsUrl: "wss://stream.binance.com/ws/solusdc@bookTicker",
    parse: (msg) => {
      if (msg.s === "SOLUSDC" && msg.b && msg.a) {
        return {
          bid: parseFloat(msg.b),
          ask: parseFloat(msg.a),
          exchTimeMs: msg.E ? Number(msg.E) : undefined,
        };
      }
      return null;
    },
  },
];

export class MultiVenueAggregator {
  private feeds: Map<string, VenueFeed> = new Map();
  private logFilePath: string;
  private logWriteStream: fs.WriteStream | null = null;
  private lastLoggedMs: number = 0;
  private isRunning: boolean = false;

  // Single cached aggregate in memory
  private cachedAggregate: AggregatePrice | null = null;

  constructor(logFilePath?: string) {
    this.logFilePath =
      logFilePath ||
      path.resolve(__dirname, "../../logs/oracle_aggregator.jsonl");

    // Initialize feeds
    for (const conf of APPROVED_FEEDS) {
      this.feeds.set(conf.id, new VenueFeed(conf));
    }
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Ensure log directory exists
    const dir = path.dirname(this.logFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.logWriteStream = fs.createWriteStream(this.logFilePath, { flags: "a" });

    // Start all feeds
    for (const feed of this.feeds.values()) {
      feed.start();
    }
  }

  public stop(): void {
    this.isRunning = false;
    for (const feed of this.feeds.values()) {
      feed.stop();
    }
    if (this.logWriteStream) {
      this.logWriteStream.end();
      this.logWriteStream = null;
    }
  }

  public getAggregate(): AggregatePrice | null {
    return this.getLatestAggregate();
  }

  /**
   * Computes the current median aggregate from fresh venues.
   * Returns null if fewer than 3 venues are fresh or if quorum fails.
   */
  public getLatestAggregate(): AggregatePrice | null {
    const now = Date.now();
    const freshVenues: { id: string; mid: number; bid: number; ask: number; ageMs: number }[] = [];

    // 1. Collect fresh venue prices (at most 2000 ms old)
    for (const [id, feed] of this.feeds.entries()) {
      const price = feed.getLatestPrice();
      if (price) {
        const age = now - price.arrivalTimeMs;
        if (age <= 2000 && price.mid > 0) {
          freshVenues.push({
            id,
            mid: price.mid,
            bid: price.bid,
            ask: price.ask,
            ageMs: age,
          });
        }
      }
    }

    // 2. Quorum check: requires at least 3 fresh venues
    if (freshVenues.length < 3) {
      return null;
    }

    // 3. Compute initial median
    const sortedMids = [...freshVenues].map((v) => v.mid).sort((a, b) => a - b);
    const midIdx = Math.floor(sortedMids.length / 2);
    const rawMedian =
      sortedMids.length % 2 === 0
        ? (sortedMids[midIdx - 1] + sortedMids[midIdx]) / 2
        : sortedMids[midIdx];

    // 4. Outlier rejection: drop any venue > 30 bps from median
    const validVenues: typeof freshVenues = [];
    const outliersDropped: string[] = [];

    for (const v of freshVenues) {
      const deviationBps = (Math.abs(v.mid - rawMedian) / rawMedian) * 10000;
      if (deviationBps > 30.0) {
        outliersDropped.push(v.id);
      } else {
        validVenues.push(v);
      }
    }

    // Require at least 3 venues after outlier drop
    if (validVenues.length < 3) {
      return null;
    }

    // 5. Final median of non-outlier sources
    const finalSortedMids = validVenues.map((v) => v.mid).sort((a, b) => a - b);
    const finalMidIdx = Math.floor(finalSortedMids.length / 2);
    const finalMedian =
      finalSortedMids.length % 2 === 0
        ? (finalSortedMids[finalMidIdx - 1] + finalSortedMids[finalMidIdx]) / 2
        : finalSortedMids[finalMidIdx];

    // 6. Confidence derived from spread
    const minMid = finalSortedMids[0];
    const maxMid = finalSortedMids[finalSortedMids.length - 1];
    const spreadBps = ((maxMid - minMid) / finalMedian) * 10000;

    // Base confidence = half-spread in USD, with minimum 0.01 USD
    let confUsd = Math.max(0.01, (maxMid - minMid) / 2);
    let isLowConfidence = false;

    // If sources disagree (> 10 bps spread) or outliers were dropped, flag low confidence
    if (spreadBps > 10.0 || outliersDropped.length > 0) {
      isLowConfidence = true;
      // Expand confidence window when sources disagree
      confUsd = Math.max(confUsd, (finalMedian * 15) / 10000);
    }

    // Scale to micro-USDC (6 decimals, integer)
    const priceMicroUsdc = Math.round(finalMedian * 1_000_000);
    const confMicroUsdc = Math.round(confUsd * 1_000_000);

    const sourcePrices: Record<string, number> = {};
    for (const v of validVenues) {
      sourcePrices[v.id] = v.mid;
    }

    const aggregate: AggregatePrice = {
      priceMicroUsdc,
      confMicroUsdc,
      priceUsd: finalMedian,
      confUsd,
      publishTimeSec: Math.floor(now / 1000),
      timestampMs: now,
      venuesTotal: this.feeds.size,
      venuesFresh: freshVenues.length,
      venuesUsed: validVenues.length,
      outliersDropped,
      isLowConfidence,
      spreadBps: Math.round(spreadBps * 10) / 10,
      sourcePrices,
    };

    this.cachedAggregate = aggregate;

    // Rate-limited log append (at most once every 500ms to conserve disk)
    if (now - this.lastLoggedMs >= 500) {
      this.lastLoggedMs = now;
      this.logTick(aggregate, freshVenues, rawMedian, outliersDropped);
    }

    return aggregate;
  }

  public getVenueHealth(): VenueHealth[] {
    return Array.from(this.feeds.values()).map((f) => f.getHealth());
  }

  private logTick(
    agg: AggregatePrice,
    fresh: { id: string; mid: number; bid: number; ask: number; ageMs: number }[],
    rawMedian: number,
    outliers: string[]
  ): void {
    if (!this.logWriteStream) return;

    const venuesMap: AggregatorLogEntry["venues"] = {};
    for (const v of fresh) {
      const devBps = Math.round(((v.mid - rawMedian) / rawMedian) * 10000 * 10) / 10;
      venuesMap[v.id] = {
        mid: v.mid,
        bid: v.bid,
        ask: v.ask,
        ageMs: v.ageMs,
        deviationBps: devBps,
        dropped: outliers.includes(v.id),
      };
    }

    const entry: AggregatorLogEntry = {
      iso: new Date().toISOString(),
      timestampMs: agg.timestampMs,
      aggregate: {
        priceUsd: agg.priceUsd,
        confUsd: agg.confUsd,
        venuesFresh: agg.venuesFresh,
        venuesUsed: agg.venuesUsed,
        isLowConfidence: agg.isLowConfidence,
        spreadBps: agg.spreadBps,
        outliersDropped: agg.outliersDropped,
      },
      venues: venuesMap,
    };

    try {
      this.logWriteStream.write(JSON.stringify(entry) + "\n");
    } catch {}
  }
}
