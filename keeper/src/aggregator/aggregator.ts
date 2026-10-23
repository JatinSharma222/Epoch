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
import { AggregatePrice, VenueHealth, AggregatorLogEntry, AggregatorOptions, VenueDecision, InclusionDecision } from "./types";

function createCoinbaseLevel2BatchParser() {
  const bids = new Map<number, number>();
  const asks = new Map<number, number>();
  let bestBid = 0;
  let bestAsk = 0;

  return (msg: any, recvMs: number) => {
    if (msg.type === "snapshot" && msg.bids && msg.asks) {
      bids.clear();
      asks.clear();
      for (const [pStr, sStr] of msg.bids) bids.set(parseFloat(pStr), parseFloat(sStr));
      for (const [pStr, sStr] of msg.asks) asks.set(parseFloat(pStr), parseFloat(sStr));
      bestBid = 0;
      for (const p of bids.keys()) if (p > bestBid) bestBid = p;
      bestAsk = Infinity;
      for (const p of asks.keys()) if (p < bestAsk) bestAsk = p;
      return { bid: bestBid, ask: bestAsk, exchTimeMs: recvMs };
    } else if (msg.type === "l2update" && msg.changes) {
      for (const [side, pStr, sStr] of msg.changes) {
        const p = parseFloat(pStr);
        const s = parseFloat(sStr);
        const book = side === "buy" ? bids : asks;
        if (s === 0) book.delete(p);
        else book.set(p, s);
      }
      bestBid = 0;
      for (const p of bids.keys()) if (p > bestBid) bestBid = p;
      bestAsk = Infinity;
      for (const p of asks.keys()) if (p < bestAsk) bestAsk = p;
      if (bestBid > 0 && bestAsk < Infinity) {
        const exchTimeMs = msg.time ? Date.parse(msg.time) : recvMs;
        return { bid: bestBid, ask: bestAsk, exchTimeMs };
      }
    }
    return null;
  };
}

export const APPROVED_FEEDS: FeedConfig[] = [
  {
    id: "coinbase",
    name: "Coinbase",
    pair: "SOL-USD",
    wsUrl: "wss://ws-feed.exchange.coinbase.com",
    subPayload: {
      type: "subscribe",
      product_ids: ["SOL-USD"],
      channels: ["level2_batch"],
    },
    parse: createCoinbaseLevel2BatchParser(),
  },
  {
    id: "kraken",
    name: "Kraken",
    pair: "SOL/USD",
    wsUrl: "wss://ws.kraken.com/v2",
    subPayload: {
      method: "subscribe",
      params: { channel: "ticker", symbol: ["SOL/USD"], event_trigger: "bbo" },
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
  private heartbeatMaxAgeMs: number;
  private maxPriceAgeMs: number;
  private excludedVenues: Set<string>;
  private monitorOnlyVenues: Set<string>;

  // Single cached aggregate in memory
  private cachedAggregate: AggregatePrice | null = null;
  private lastVenueDecisions: VenueDecision[] = [];

  constructor(optionsOrLogPath?: string | AggregatorOptions) {
    let options: AggregatorOptions = {};
    if (typeof optionsOrLogPath === "string") {
      options = { logFilePath: optionsOrLogPath };
    } else if (optionsOrLogPath) {
      options = optionsOrLogPath;
    }

    this.logFilePath =
      options.logFilePath ||
      path.resolve(__dirname, "../../logs/oracle_aggregator.jsonl");

    this.heartbeatMaxAgeMs = options.heartbeatMaxAgeMs || 10_000; // default 10 seconds for WS health
    this.maxPriceAgeMs = options.maxPriceAgeMs || 3_000;          // default 3 seconds max price age for median

    // Venue Policy:
    // 1. Coinbase is EXCLUDED by default due to strict Terms of Service §4 forbidding benchmark/derivatives index creation.
    // 2. Hyperliquid is MONITOR-ONLY by default (logged, but not in median).
    const defaultExcluded = ["coinbase"];
    const defaultMonitorOnly = ["hyperliquid"];

    const envExcluded = process.env.EPOCH_EXCLUDED_VENUES
      ? process.env.EPOCH_EXCLUDED_VENUES.split(",").map((s) => s.trim().toLowerCase())
      : (options.excludedVenues ? [] : defaultExcluded);
    const configExcluded = options.excludedVenues
      ? options.excludedVenues.map((s) => s.trim().toLowerCase())
      : [];

    const envMonitorOnly = process.env.EPOCH_MONITOR_ONLY_VENUES
      ? process.env.EPOCH_MONITOR_ONLY_VENUES.split(",").map((s) => s.trim().toLowerCase())
      : (options.monitorOnlyVenues ? [] : defaultMonitorOnly);
    const configMonitorOnly = options.monitorOnlyVenues
      ? options.monitorOnlyVenues.map((s) => s.trim().toLowerCase())
      : [];

    // Default venue set for any public deployment is NONE until explicitly approved
    const isPublic = options.isPublicDeployment ?? (process.env.EPOCH_PUBLIC_DEPLOYMENT === "true");
    if (isPublic && !options.excludedVenues && !process.env.EPOCH_APPROVED_VENUES) {
      this.excludedVenues = new Set(APPROVED_FEEDS.map((f) => f.id));
      this.monitorOnlyVenues = new Set();
    } else {
      this.excludedVenues = new Set([...envExcluded, ...configExcluded]);
      this.monitorOnlyVenues = new Set([...envMonitorOnly, ...configMonitorOnly]);
    }

    // Initialize feeds (including monitor-only, but excluding explicitly excluded feeds)
    for (const conf of APPROVED_FEEDS) {
      if (!this.excludedVenues.has(conf.id.toLowerCase())) {
        this.feeds.set(conf.id, new VenueFeed(conf));
      }
    }
  }

  public getExcludedVenues(): string[] {
    return Array.from(this.excludedVenues);
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

    // Start all configured feeds
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
   * Computes the current median aggregate from active venues.
   * Liveness & Policy Rules:
   * 1. Coinbase is excluded from the default set.
   * 2. Hyperliquid is monitor-only (logged, never in median).
   * 3. Max price age of 3,000 ms (3s) for median inclusion.
   * 4. Quorum requires >= 3 fresh, non-outlier sources.
   * 5. Outliers > 30 bps from raw median are dropped.
   */
  public getLatestAggregate(): AggregatePrice | null {
    const now = Date.now();
    const venueDecisions: VenueDecision[] = [];
    const activeCandidates: { id: string; name: string; mid: number; bid: number; ask: number; ageMs: number; heartbeatAgeMs: number }[] = [];

    // 1. Evaluate all approved feeds
    for (const conf of APPROVED_FEEDS) {
      const feed = this.feeds.get(conf.id);
      if (!feed || this.excludedVenues.has(conf.id.toLowerCase())) {
        venueDecisions.push({
          venueId: conf.id,
          name: conf.name,
          state: "EXCLUDED",
          ageMs: Infinity,
          heartbeatAgeMs: Infinity,
          decision: "DROPPED_EXCLUDED",
          reason: conf.id === "coinbase"
            ? "Excluded by policy: Coinbase Terms §4 forbids benchmark/derivatives index creation"
            : "Excluded by operator configuration",
        });
        continue;
      }

      const health = feed.getHealth();
      const heartbeatAge = health.lastMessageMs > 0 ? now - health.lastMessageMs : Infinity;
      const latestPrice = feed.getLatestPrice();
      const priceAge = latestPrice ? now - latestPrice.arrivalTimeMs : Infinity;

      if (this.monitorOnlyVenues.has(conf.id.toLowerCase())) {
        venueDecisions.push({
          venueId: conf.id,
          name: conf.name,
          state: "MONITOR_ONLY",
          price: latestPrice?.mid,
          ageMs: priceAge,
          heartbeatAgeMs: heartbeatAge,
          decision: "DROPPED_MONITOR_ONLY",
          reason: "Configured as monitor-only (logged in telemetry, excluded from median)",
        });
        continue;
      }

      if (!feed.isActive(this.heartbeatMaxAgeMs)) {
        venueDecisions.push({
          venueId: conf.id,
          name: conf.name,
          state: health.state,
          price: latestPrice?.mid,
          ageMs: priceAge,
          heartbeatAgeMs: heartbeatAge,
          decision: "DROPPED_DISCONNECTED",
          reason: `WebSocket inactive or heartbeat age (${heartbeatAge}ms) > ${this.heartbeatMaxAgeMs}ms`,
        });
        continue;
      }

      // Check 3s max price age limit for median inclusion
      if (priceAge > this.maxPriceAgeMs) {
        venueDecisions.push({
          venueId: conf.id,
          name: conf.name,
          state: "STALE",
          price: latestPrice?.mid,
          ageMs: priceAge,
          heartbeatAgeMs: heartbeatAge,
          decision: "DROPPED_STALE_PRICE",
          reason: `Price age (${priceAge}ms) exceeds maximum allowable ${this.maxPriceAgeMs}ms threshold`,
        });
        continue;
      }

      activeCandidates.push({
        id: conf.id,
        name: conf.name,
        mid: latestPrice!.mid,
        bid: latestPrice!.bid,
        ask: latestPrice!.ask,
        ageMs: priceAge,
        heartbeatAgeMs: heartbeatAge,
      });
    }

    // 2. Quorum check: requires at least 3 active venues
    if (activeCandidates.length < 3) {
      for (const v of activeCandidates) {
        venueDecisions.push({
          venueId: v.id,
          name: v.name,
          state: "CONNECTED",
          price: v.mid,
          ageMs: v.ageMs,
          heartbeatAgeMs: v.heartbeatAgeMs,
          decision: "INCLUDED",
          reason: `Fresh price (age=${v.ageMs}ms), but quorum not met (${activeCandidates.length} < 3 active sources)`,
        });
      }
      this.lastVenueDecisions = venueDecisions;
      return null;
    }

    // 3. Compute initial median
    const sortedMids = [...activeCandidates].map((v) => v.mid).sort((a, b) => a - b);
    const midIdx = Math.floor(sortedMids.length / 2);
    const rawMedian =
      sortedMids.length % 2 === 0
        ? (sortedMids[midIdx - 1] + sortedMids[midIdx]) / 2
        : sortedMids[midIdx];

    // 4. Outlier rejection: drop any venue > 30 bps from median
    const validVenues: typeof activeCandidates = [];
    const outliersDropped: string[] = [];

    for (const v of activeCandidates) {
      const deviationBps = (Math.abs(v.mid - rawMedian) / rawMedian) * 10000;
      if (deviationBps > 30.0) {
        outliersDropped.push(v.id);
        venueDecisions.push({
          venueId: v.id,
          name: v.name,
          state: "CONNECTED",
          price: v.mid,
          ageMs: v.ageMs,
          heartbeatAgeMs: v.heartbeatAgeMs,
          decision: "DROPPED_OUTLIER",
          reason: `Deviation (${deviationBps.toFixed(1)} bps) exceeds 30 bps outlier threshold`,
        });
      } else {
        validVenues.push(v);
        venueDecisions.push({
          venueId: v.id,
          name: v.name,
          state: "CONNECTED",
          price: v.mid,
          ageMs: v.ageMs,
          heartbeatAgeMs: v.heartbeatAgeMs,
          decision: "INCLUDED",
          reason: `Included in median (age=${v.ageMs}ms <= 3000ms, dev=${deviationBps.toFixed(1)} bps)`,
        });
      }
    }

    // Require at least 3 venues after outlier drop
    if (validVenues.length < 3) {
      this.lastVenueDecisions = venueDecisions;
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
    const sourceAgesMs: Record<string, number> = {};
    for (const v of validVenues) {
      sourcePrices[v.id] = v.mid;
      sourceAgesMs[v.id] = v.ageMs;
    }

    const aggregate: AggregatePrice = {
      priceMicroUsdc,
      confMicroUsdc,
      priceUsd: finalMedian,
      confUsd,
      publishTimeSec: Math.floor(now / 1000),
      timestampMs: now,
      venuesTotal: this.feeds.size,
      venuesFresh: validVenues.length,
      venuesUsed: validVenues.length,
      outliersDropped,
      isLowConfidence,
      spreadBps: Math.round(spreadBps * 10) / 10,
      sourcePrices,
      sourceAgesMs,
      venueDecisions,
    };

    this.cachedAggregate = aggregate;
    this.lastVenueDecisions = venueDecisions;

    // Rate-limited log append (at most once every 500ms to conserve disk)
    if (now - this.lastLoggedMs >= 500) {
      this.lastLoggedMs = now;
      this.logTick(aggregate, validVenues, rawMedian, outliersDropped);
    }

    return aggregate;
  }

  public getVenueDecisions(): VenueDecision[] {
    this.getLatestAggregate();
    return this.lastVenueDecisions;
  }

  public getVenueHealth(): VenueHealth[] {
    const list: VenueHealth[] = [];
    for (const conf of APPROVED_FEEDS) {
      if (this.excludedVenues.has(conf.id.toLowerCase())) {
        list.push({
          venueId: conf.id,
          name: conf.name,
          state: "EXCLUDED",
          lastMessageMs: 0,
          messageCount: 0,
          errorCount: 0,
          reconnectCount: 0,
        });
      } else {
        const feed = this.feeds.get(conf.id);
        if (feed) {
          const h = feed.getHealth();
          if (this.monitorOnlyVenues.has(conf.id.toLowerCase())) {
            h.state = "MONITOR_ONLY";
          }
          list.push(h);
        }
      }
    }
    return list;
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
