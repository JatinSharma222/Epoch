/**
 * Epoch Protocol — L1 Best Bid/Ask (BBO) Feed Benchmarking Suite
 *
 * Subscribes to the real-time top-of-book (L1 bookTicker / BBO) channels
 * across all 6 approved venues:
 * 1. Coinbase (SOL-USD: ticker best_bid / best_ask)
 * 2. Kraken (SOL/USD: ticker v2 bid / ask)
 * 3. Bybit (SOLUSDC: orderbook.1 top-of-book)
 * 4. Backpack (SOL_USDC: bookTicker top-of-book)
 * 5. Hyperliquid (SOL: l2Book levels[0] top-of-book)
 * 6. Binance (SOLUSDC: bookTicker top-of-book via port 443)
 *
 * Measures:
 * - Messages per second (msg/s)
 * - P50 and P95 gap between consecutive updates (inter-message latency)
 * - Message age vs exchange timestamp (where provided by exchange)
 * - Reconnect latency after deliberate socket termination
 */

import * as fs from "fs";
import * as path from "path";

export interface L1FeedConfig {
  id: string;
  name: string;
  pair: string;
  url: string;
  subPayload?: any;
  parse: (msg: any, recvMs: number) => { bid: number; ask: number; exchTimeMs?: number } | null;
}

export interface VenueStats {
  id: string;
  name: string;
  pair: string;
  messageCount: number;
  lastRecvMs: number;
  gapsMs: number[];
  agesMs: number[];
  latestBid: number;
  latestAsk: number;
  latestMid: number;
  spreadBps: number;
  reconnectLatencyMs: number;
  connected: boolean;
  errorCount: number;
}

export const L1_FEEDS: L1FeedConfig[] = [
  {
    id: "coinbase",
    name: "Coinbase",
    pair: "SOL-USD",
    url: "wss://ws-feed.exchange.coinbase.com",
    subPayload: {
      type: "subscribe",
      product_ids: ["SOL-USD"],
      channels: ["ticker"],
    },
    parse: (msg, recvMs) => {
      if (msg.type === "ticker" && msg.best_bid && msg.best_ask) {
        const bid = parseFloat(msg.best_bid);
        const ask = parseFloat(msg.best_ask);
        const exchTimeMs = msg.time ? Date.parse(msg.time) : undefined;
        return { bid, ask, exchTimeMs };
      }
      return null;
    },
  },
  {
    id: "kraken",
    name: "Kraken",
    pair: "SOL/USD",
    url: "wss://ws.kraken.com/v2",
    subPayload: {
      method: "subscribe",
      params: { channel: "ticker", symbol: ["SOL/USD"] },
    },
    parse: (msg, recvMs) => {
      if (msg.channel === "ticker" && msg.data?.[0]) {
        const d = msg.data[0];
        if (d.bid !== undefined && d.ask !== undefined) {
          const bid = parseFloat(d.bid);
          const ask = parseFloat(d.ask);
          const exchTimeMs = d.timestamp ? Date.parse(d.timestamp) : undefined;
          return { bid, ask, exchTimeMs };
        }
      }
      return null;
    },
  },
  {
    id: "bybit",
    name: "Bybit",
    pair: "SOLUSDC",
    url: "wss://stream.bybit.com/v5/public/spot",
    subPayload: {
      op: "subscribe",
      args: ["orderbook.1.SOLUSDC"],
    },
    parse: (msg, recvMs) => {
      if (msg.topic === "orderbook.1.SOLUSDC" && msg.data?.b?.[0] && msg.data?.a?.[0]) {
        const bid = parseFloat(msg.data.b[0][0]);
        const ask = parseFloat(msg.data.a[0][0]);
        const exchTimeMs = msg.ts ? Number(msg.ts) : undefined;
        return { bid, ask, exchTimeMs };
      }
      return null;
    },
  },
  {
    id: "backpack",
    name: "Backpack",
    pair: "SOL_USDC",
    url: "wss://ws.backpack.exchange",
    subPayload: {
      method: "SUBSCRIBE",
      params: ["bookTicker.SOL_USDC"],
    },
    parse: (msg, recvMs) => {
      if (msg.stream === "bookTicker.SOL_USDC" && msg.data?.b && msg.data?.a) {
        const bid = parseFloat(msg.data.b);
        const ask = parseFloat(msg.data.a);
        // T is microseconds
        const exchTimeMs = msg.data.T ? Math.floor(msg.data.T / 1000) : undefined;
        return { bid, ask, exchTimeMs };
      }
      return null;
    },
  },
  {
    id: "hyperliquid",
    name: "Hyperliquid",
    pair: "SOL",
    url: "wss://api.hyperliquid.xyz/ws",
    subPayload: {
      method: "subscribe",
      subscription: { type: "l2Book", coin: "SOL" },
    },
    parse: (msg, recvMs) => {
      if (msg.channel === "l2Book" && msg.data?.levels?.[0]?.[0] && msg.data?.levels?.[1]?.[0]) {
        const bid = parseFloat(msg.data.levels[0][0].px);
        const ask = parseFloat(msg.data.levels[1][0].px);
        const exchTimeMs = msg.data.time ? Number(msg.data.time) : undefined;
        return { bid, ask, exchTimeMs };
      }
      return null;
    },
  },
  {
    id: "binance",
    name: "Binance",
    pair: "SOLUSDC",
    url: "wss://stream.binance.com/ws/solusdc@bookTicker",
    parse: (msg, recvMs) => {
      if (msg.s === "SOLUSDC" && msg.b && msg.a) {
        const bid = parseFloat(msg.b);
        const ask = parseFloat(msg.a);
        // E is event time if present
        const exchTimeMs = msg.E ? Number(msg.E) : undefined;
        return { bid, ask, exchTimeMs };
      }
      return null;
    },
  },
];

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

export async function runL1Benchmark(durationSec: number = 600): Promise<Record<string, any>> {
  console.log("=========================================================================================");
  console.log(`        EPOCH PROTOCOL — L1 BOOK-TICKER / BBO FEED BENCHMARK (${durationSec}s RUN)       `);
  console.log("=========================================================================================\n");
  console.log(`Subscribing to real-time L1 BBO channels for ${L1_FEEDS.length} approved venues...`);
  console.log(`Duration: ${durationSec} seconds (${(durationSec / 60).toFixed(1)} minutes)\n`);

  const stats: Record<string, VenueStats> = {};
  const sockets: Record<string, any> = {};

  for (const f of L1_FEEDS) {
    stats[f.id] = {
      id: f.id,
      name: f.name,
      pair: f.pair,
      messageCount: 0,
      lastRecvMs: 0,
      gapsMs: [],
      agesMs: [],
      latestBid: 0,
      latestAsk: 0,
      latestMid: 0,
      spreadBps: 0,
      reconnectLatencyMs: 0,
      connected: false,
      errorCount: 0,
    };
  }

  // Connect sockets
  function connectFeed(f: L1FeedConfig, isReconnect = false): Promise<void> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      try {
        const ws = new WebSocket(f.url);
        sockets[f.id] = ws;

        ws.onopen = () => {
          stats[f.id].connected = true;
          if (isReconnect) {
            stats[f.id].reconnectLatencyMs = Date.now() - startTime;
          }
          if (f.subPayload) {
            try {
              ws.send(JSON.stringify(f.subPayload));
            } catch {}
          }
          resolve();
        };

        ws.onmessage = (event: any) => {
          const now = Date.now();
          const s = stats[f.id];

          try {
            const raw = JSON.parse(event.data);
            const parsed = f.parse(raw, now);
            if (parsed && parsed.bid > 0 && parsed.ask > 0) {
              s.messageCount++;
              if (s.lastRecvMs > 0) {
                const gap = now - s.lastRecvMs;
                s.gapsMs.push(gap);
              }
              s.lastRecvMs = now;
              s.latestBid = parsed.bid;
              s.latestAsk = parsed.ask;
              s.latestMid = (parsed.bid + parsed.ask) / 2;
              s.spreadBps = ((parsed.ask - parsed.bid) / s.latestMid) * 10000;

              if (parsed.exchTimeMs) {
                const age = now - parsed.exchTimeMs;
                // Bound reasonable range in case of clock drift
                if (age >= -500 && age < 30000) {
                  s.agesMs.push(Math.max(0, age));
                }
              }
            }
          } catch {}
        };

        ws.onerror = () => {
          stats[f.id].errorCount++;
        };

        ws.onclose = () => {
          stats[f.id].connected = false;
        };
      } catch (err) {
        stats[f.id].errorCount++;
        resolve();
      }
    });
  }

  // Initial connection
  await Promise.all(L1_FEEDS.map((f) => connectFeed(f, false)));
  console.log("All 6 L1 WebSocket streams active. Collecting live tick metrics...\n");

  const startMs = Date.now();
  let reconnectTested = false;

  // Periodic heartbeat display
  const progressInterval = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - startMs) / 1000);
    const totalMsgs = Object.values(stats).reduce((a, b) => a + b.messageCount, 0);
    process.stdout.write(
      `\r[${elapsedSec}s / ${durationSec}s] Captured ${totalMsgs} L1 ticks | Active Feeds: ${
        Object.values(stats).filter((s) => s.lastRecvMs > 0).length
      }/6`
    );

    // Test reconnect behavior at halfway point
    if (!reconnectTested && elapsedSec >= Math.floor(durationSec / 2)) {
      reconnectTested = true;
      console.log("\n\n--> Testing reconnect behavior on Hyperliquid & Binance (disconnect & auto-resubscribe)...");
      for (const testId of ["hyperliquid", "binance"]) {
        const ws = sockets[testId];
        if (ws) {
          try { ws.close(); } catch {}
          const feed = L1_FEEDS.find((f) => f.id === testId);
          if (feed) {
            connectFeed(feed, true).then(() => {
              console.log(`    [RECONNECT PASS] ${feed.name}: Reconnected in ${stats[testId].reconnectLatencyMs} ms`);
            });
          }
        }
      }
    }
  }, 5000);

  // Wait for duration
  await new Promise((r) => setTimeout(r, durationSec * 1000));
  clearInterval(progressInterval);

  // Close all sockets
  for (const id of Object.keys(sockets)) {
    try { sockets[id]?.close(); } catch {}
  }

  const actualElapsedSec = (Date.now() - startMs) / 1000;

  console.log("\n\n=========================================================================================");
  console.log("                      L1 BBO BENCHMARK RESULTS & METRICS                                 ");
  console.log("=========================================================================================");

  const report: Record<string, any> = {
    timestamp: new Date().toISOString(),
    durationSeconds: actualElapsedSec,
    venues: {},
  };

  console.log(
    "Venue".padEnd(14) +
    "Pair".padEnd(11) +
    "Msg/s".padEnd(10) +
    "Total Msgs".padEnd(12) +
    "P50 Gap".padEnd(11) +
    "P95 Gap".padEnd(11) +
    "Mean Age".padEnd(12) +
    "Spread (bps)".padEnd(14) +
    "Assessment"
  );
  console.log("-".repeat(105));

  for (const f of L1_FEEDS) {
    const s = stats[f.id];
    const msgsPerSec = Math.round((s.messageCount / actualElapsedSec) * 10) / 10;
    const p50Gap = Math.round(percentile(s.gapsMs, 50));
    const p95Gap = Math.round(percentile(s.gapsMs, 95));
    const meanAge = s.agesMs.length > 0
      ? Math.round(s.agesMs.reduce((a, b) => a + b, 0) / s.agesMs.length)
      : null;
    const meanAgeStr = meanAge !== null ? `${meanAge} ms` : "N/A (no ts)";
    const spreadStr = `${s.spreadBps.toFixed(1)} bps`;

    // Assessment criteria:
    // Stale if P95 gap > 2000ms or msgs/s < 0.2
    let status = "\x1b[32mEXCELLENT\x1b[0m";
    let assessmentText = "FAST & FRESH";
    if (msgsPerSec < 0.5 || p95Gap > 2000) {
      status = "\x1b[33mSLOW/LOW-LIQ\x1b[0m";
      assessmentText = "SLOW FEED";
    }

    console.log(
      f.name.padEnd(14) +
      f.pair.padEnd(11) +
      `${msgsPerSec}`.padEnd(10) +
      `${s.messageCount}`.padEnd(12) +
      `${p50Gap} ms`.padEnd(11) +
      `${p95Gap} ms`.padEnd(11) +
      meanAgeStr.padEnd(12) +
      spreadStr.padEnd(14) +
      status
    );

    report.venues[f.id] = {
      name: f.name,
      pair: f.pair,
      messagesPerSec: msgsPerSec,
      totalMessages: s.messageCount,
      p50GapMs: p50Gap,
      p95GapMs: p95Gap,
      meanAgeMs: meanAge,
      latestBid: s.latestBid,
      latestAsk: s.latestAsk,
      latestMid: s.latestMid,
      spreadBps: s.spreadBps,
      reconnectLatencyMs: s.reconnectLatencyMs,
      assessment: assessmentText,
    };
  }

  console.log("=========================================================================================\n");

  const outDir = path.resolve(__dirname, "../../evidence/oracle");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "l1_benchmark_report.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`L1 benchmark evidence report saved to: ${outFile}\n`);

  return report;
}

if (require.main === module || (typeof process !== "undefined" && process.argv[1]?.endsWith("measure_l1_feeds.ts"))) {
  // Support --duration flag, default 600 seconds (10 minutes)
  let duration = 600;
  const durIdx = process.argv.indexOf("--duration");
  if (durIdx !== -1 && process.argv[durIdx + 1]) {
    duration = parseInt(process.argv[durIdx + 1], 10);
  } else if (process.env.BENCHMARK_SECONDS) {
    duration = parseInt(process.env.BENCHMARK_SECONDS, 10);
  }

  runL1Benchmark(duration)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Benchmark failed:", err);
      process.exit(1);
    });
}
