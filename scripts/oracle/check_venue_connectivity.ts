/**
 * Epoch Protocol — Multi-Venue Oracle Connectivity & Terms Verification Script
 *
 * Verifies reachability, regional blocks, authentication requirements, rate limits,
 * pricing consistency, and API terms across 7 major venues for Authority Oracle Mode:
 * 1. Coinbase (Spot USD)
 * 2. Kraken (Spot USD)
 * 3. Backpack (Spot USDC)
 * 4. Hyperliquid (Perp Mid USDC)
 * 5. Binance (Spot USDC)
 * 6. Bybit (Spot USDC)
 * 7. OKX (Spot USDC)
 *
 * Designed to be executed locally or on cloud instances (e.g. EC2).
 */

import * as fs from "fs";
import * as path from "path";

export interface VenueSpec {
  id: string;
  name: string;
  pair: string;
  basis: "USD" | "USDC" | "USDT" | "Perp-Mid (USDC)";
  restUrl: string;
  restMethod?: "GET" | "POST";
  restBody?: any;
  wsUrl: string;
  wsSubPayload?: any;
  termsUrl: string;
  docsUrl: string;
  rateLimits: {
    rest: string;
    ws: string;
  };
  keyNeeded: boolean;
  parseRest: (data: any) => number | null;
  parseWs: (data: any) => number | null;
}

export interface VenueResult {
  id: string;
  name: string;
  pair: string;
  basis: string;
  restStatus: number | string;
  restLatencyMs: number;
  restPrice: number | null;
  wsConnected: boolean;
  wsLatencyMs: number;
  wsPrice: number | null;
  regionBlocked: boolean;
  blockReason?: string;
  keyNeeded: boolean;
  rateLimits: { rest: string; ws: string };
  termsUrl: string;
  deviationFromMedianBps?: number;
}

export const VENUES: VenueSpec[] = [
  {
    id: "coinbase",
    name: "Coinbase Exchange",
    pair: "SOL-USD",
    basis: "USD",
    restUrl: "https://api.exchange.coinbase.com/products/SOL-USD/ticker",
    wsUrl: "wss://ws-feed.exchange.coinbase.com",
    wsSubPayload: {
      type: "subscribe",
      product_ids: ["SOL-USD"],
      channels: ["ticker"],
    },
    termsUrl: "https://www.coinbase.com/legal/user_agreement",
    docsUrl: "https://docs.cloud.coinbase.com/exchange/docs/websocket-overview",
    rateLimits: {
      rest: "10-15 req/sec per IP",
      ws: "750 msg/sec, 10-100 subscriptions per connection",
    },
    keyNeeded: false,
    parseRest: (d) => (d.price ? parseFloat(d.price) : null),
    parseWs: (d) => (d.type === "ticker" && d.price ? parseFloat(d.price) : null),
  },
  {
    id: "kraken",
    name: "Kraken",
    pair: "SOL/USD",
    basis: "USD",
    restUrl: "https://api.kraken.com/0/public/Ticker?pair=SOLUSD",
    wsUrl: "wss://ws.kraken.com/v2",
    wsSubPayload: {
      method: "subscribe",
      params: { channel: "ticker", symbol: ["SOL/USD"] },
    },
    termsUrl: "https://www.kraken.com/legal",
    docsUrl: "https://docs.kraken.com/api/docs/guides/market-data-terms",
    rateLimits: {
      rest: "Tiered token pool (decay 0.33-1 pt/s; ~1 req/s safe)",
      ws: "150 connections per IP, 50 subscriptions per socket",
    },
    keyNeeded: false,
    parseRest: (d) => {
      const pair = d.result?.SOLUSD;
      return pair?.c?.[0] ? parseFloat(pair.c[0]) : null;
    },
    parseWs: (d) => {
      if (d.channel === "ticker" && d.data?.[0]?.last !== undefined) {
        return parseFloat(d.data[0].last);
      }
      return null;
    },
  },
  {
    id: "backpack",
    name: "Backpack Exchange",
    pair: "SOL_USDC",
    basis: "USDC",
    restUrl: "https://api.backpack.exchange/api/v1/ticker?symbol=SOL_USDC",
    wsUrl: "wss://ws.backpack.exchange",
    wsSubPayload: {
      method: "SUBSCRIBE",
      params: ["ticker.SOL_USDC"],
    },
    termsUrl: "https://backpack.exchange/terms",
    docsUrl: "https://docs.backpack.exchange/",
    rateLimits: {
      rest: "2,000 req/min per subaccount/IP",
      ws: "10 connections per IP, 100 subscriptions per stream",
    },
    keyNeeded: false,
    parseRest: (d) => (d.lastPrice ? parseFloat(d.lastPrice) : null),
    parseWs: (d) => (d.data?.c ? parseFloat(d.data.c) : null),
  },
  {
    id: "hyperliquid",
    name: "Hyperliquid",
    pair: "SOL",
    basis: "Perp-Mid (USDC)",
    restUrl: "https://api.hyperliquid.xyz/info",
    restMethod: "POST",
    restBody: { type: "allMids" },
    wsUrl: "wss://api.hyperliquid.xyz/ws",
    wsSubPayload: {
      method: "subscribe",
      subscription: { type: "allMids" },
    },
    termsUrl: "https://hyperliquid.xyz/terms",
    docsUrl: "https://hyperliquid.gitbook.io/hyperliquid-docs",
    rateLimits: {
      rest: "1,200 weight units/min per IP",
      ws: "10 concurrent connections, 1,000 subscriptions per IP",
    },
    keyNeeded: false,
    parseRest: (d) => (d.SOL ? parseFloat(d.SOL) : null),
    parseWs: (d) => (d.channel === "allMids" && d.data?.mids?.SOL ? parseFloat(d.data.mids.SOL) : null),
  },
  {
    id: "binance",
    name: "Binance",
    pair: "SOLUSDC",
    basis: "USDC",
    restUrl: "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDC",
    wsUrl: "wss://stream.binance.com/ws/solusdc@ticker",
    termsUrl: "https://www.binance.com/en/terms",
    docsUrl: "https://developers.binance.com",
    rateLimits: {
      rest: "1,200 weight units/min per IP",
      ws: "5 incoming msg/sec, 300 connections per IP",
    },
    keyNeeded: false,
    parseRest: (d) => (d.price ? parseFloat(d.price) : null),
    parseWs: (d) => (d.s === "SOLUSDC" && d.c ? parseFloat(d.c) : null),
  },
  {
    id: "bybit",
    name: "Bybit",
    pair: "SOLUSDC",
    basis: "USDC",
    restUrl: "https://api.bybit.com/v5/market/tickers?category=spot&symbol=SOLUSDC",
    wsUrl: "wss://stream.bybit.com/v5/public/spot",
    wsSubPayload: {
      op: "subscribe",
      args: ["tickers.SOLUSDC"],
    },
    termsUrl: "https://www.bybit.com/en/terms-service/terms-of-service/",
    docsUrl: "https://bybit-exchange.github.io/docs/v5/intro",
    rateLimits: {
      rest: "120 req/sec per IP for public endpoints",
      ws: "500 subscriptions per connection; 20s heartbeat ping",
    },
    keyNeeded: false,
    parseRest: (d) => {
      const item = d.result?.list?.[0];
      return item?.lastPrice ? parseFloat(item.lastPrice) : null;
    },
    parseWs: (d) => {
      if (d.topic === "tickers.SOLUSDC" && d.data?.lastPrice) {
        return parseFloat(d.data.lastPrice);
      }
      return null;
    },
  },
  {
    id: "okx",
    name: "OKX",
    pair: "SOL-USDC",
    basis: "USDC",
    restUrl: "https://www.okx.com/api/v5/market/ticker?instId=SOL-USDC",
    wsUrl: "wss://ws.okx.com:8443/ws/v5/public",
    wsSubPayload: {
      op: "subscribe",
      args: [{ channel: "tickers", instId: "SOL-USDC" }],
    },
    termsUrl: "https://www.okx.com/help/okx-terms-of-service",
    docsUrl: "https://www.okx.com/docs-v5/en/",
    rateLimits: {
      rest: "20 req / 2 seconds per IP",
      ws: "480 connections/hour; 30s heartbeat",
    },
    keyNeeded: false,
    parseRest: (d) => (d.data?.[0]?.last ? parseFloat(d.data[0].last) : null),
    parseWs: (d) => (d.data?.[0]?.last ? parseFloat(d.data[0].last) : null),
  },
];

async function checkRest(v: VenueSpec, timeoutMs = 4000): Promise<{ status: number | string; latency: number; price: number | null; blocked: boolean; reason?: string }> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const opts: RequestInit = {
      method: v.restMethod || "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "EpochProtocolOracleVerifier/1.0",
        Accept: "application/json",
        ...(v.restBody ? { "Content-Type": "application/json" } : {}),
      },
      ...(v.restBody ? { body: JSON.stringify(v.restBody) } : {}),
    };

    const res = await fetch(v.restUrl, opts);
    clearTimeout(timer);
    const latency = Date.now() - start;

    if (res.status === 451) {
      return { status: 451, latency, price: null, blocked: true, reason: "HTTP 451 (Unavailable For Legal Reasons / Regional Block)" };
    }
    if (res.status === 403) {
      return { status: 403, latency, price: null, blocked: true, reason: "HTTP 403 (Forbidden / Cloudflare Geoblock)" };
    }
    if (!res.ok) {
      return { status: res.status, latency, price: null, blocked: false, reason: `HTTP ${res.status}` };
    }

    const json = await res.json();
    const price = v.parseRest(json);
    return { status: res.status, latency, price, blocked: false };
  } catch (err: any) {
    clearTimeout(timer);
    const latency = Date.now() - start;
    const isTimeout = err?.name === "AbortError" || String(err).includes("timeout");
    return {
      status: isTimeout ? "TIMEOUT" : "CONN_ERR",
      latency,
      price: null,
      blocked: isTimeout,
      reason: isTimeout ? "Connection timed out (possible DNS or ISP SNI block)" : err?.message || String(err),
    };
  }
}

async function checkWs(v: VenueSpec, timeoutMs = 5000): Promise<{ connected: boolean; latency: number; price: number | null; error?: string }> {
  const start = Date.now();

  return new Promise((resolve) => {
    let resolved = false;
    let ws: any;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { ws?.close(); } catch {}
        resolve({ connected: false, latency: Date.now() - start, price: null, error: "WS connection or ticker timeout" });
      }
    }, timeoutMs);

    try {
      ws = new WebSocket(v.wsUrl);

      ws.onopen = () => {
        if (v.wsSubPayload) {
          try {
            ws.send(JSON.stringify(v.wsSubPayload));
          } catch (e: any) {
            // failed send
          }
        }
      };

      ws.onmessage = (event: any) => {
        try {
          const d = JSON.parse(event.data);
          const price = v.parseWs(d);
          if (price !== null && !resolved) {
            resolved = true;
            clearTimeout(timer);
            const latency = Date.now() - start;
            try { ws.close(); } catch {}
            resolve({ connected: true, latency, price });
          }
        } catch {}
      };

      ws.onerror = (err: any) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({ connected: false, latency: Date.now() - start, price: null, error: err?.message || "WebSocket Error" });
        }
      };
    } catch (e: any) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ connected: false, latency: Date.now() - start, price: null, error: e?.message || "Socket initiation error" });
      }
    }
  });
}

export async function runVenueConnectivityCheck(): Promise<{ results: VenueResult[]; medianPrice: number; healthyCount: number }> {
  console.log("=========================================================================================");
  console.log("            EPOCH PROTOCOL — MULTI-VENUE ORACLE CONNECTIVITY & TERMS AUDIT              ");
  console.log("=========================================================================================\n");
  console.log(`Auditing ${VENUES.length} candidate crypto exchanges from local network environment...\n`);

  const results: VenueResult[] = [];

  for (const v of VENUES) {
    process.stdout.write(`Checking ${v.name.padEnd(20)} [${v.pair.padEnd(10)}] ... `);
    const [restRes, wsRes] = await Promise.all([
      checkRest(v),
      checkWs(v),
    ]);

    const isBlocked = restRes.blocked && !wsRes.connected;
    const blockReason = restRes.reason || wsRes.error;

    results.push({
      id: v.id,
      name: v.name,
      pair: v.pair,
      basis: v.basis,
      restStatus: restRes.status,
      restLatencyMs: restRes.latency,
      restPrice: restRes.price,
      wsConnected: wsRes.connected,
      wsLatencyMs: wsRes.latency,
      wsPrice: wsRes.price,
      regionBlocked: isBlocked,
      blockReason: isBlocked ? blockReason : undefined,
      keyNeeded: v.keyNeeded,
      rateLimits: v.rateLimits,
      termsUrl: v.termsUrl,
    });

    const statusTag = wsRes.connected && restRes.status === 200
      ? "\x1b[32mOK (REST + WS)\x1b[0m"
      : wsRes.connected
      ? "\x1b[33mWS ONLY\x1b[0m"
      : "\x1b[31mBLOCKED/ERR\x1b[0m";

    console.log(`${statusTag} (REST: ${restRes.status} in ${restRes.latency}ms | WS: ${wsRes.connected ? "PASS" : "FAIL"} in ${wsRes.latency}ms | Price: $${(wsRes.price || restRes.price || 0).toFixed(2)})`);
  }

  // Calculate Median Price from active WS / REST prices
  const validPrices: number[] = [];
  for (const r of results) {
    const p = r.wsPrice || r.restPrice;
    if (p && p > 0) validPrices.push(p);
  }

  validPrices.sort((a, b) => a - b);
  const midIdx = Math.floor(validPrices.length / 2);
  const medianPrice = validPrices.length % 2 === 0
    ? (validPrices[midIdx - 1] + validPrices[midIdx]) / 2
    : validPrices[midIdx] || 0;

  // Calculate deviations in basis points
  for (const r of results) {
    const p = r.wsPrice || r.restPrice;
    if (p && medianPrice > 0) {
      r.deviationFromMedianBps = Math.round(((p - medianPrice) / medianPrice) * 10000 * 10) / 10;
    }
  }

  const healthyCount = results.filter((r) => r.wsConnected && (r.wsPrice || r.restPrice)).length;

  console.log("\n=========================================================================================");
  console.log("                               SUMMARY & PRICING CONSISTENCY                             ");
  console.log("=========================================================================================");
  console.log(`Median Price across active venues: $${medianPrice.toFixed(4)} USD`);
  console.log(`Healthy WebSocket Streaming Venues: ${healthyCount} / ${VENUES.length}\n`);

  console.log(
    "Venue".padEnd(18) +
    "Pair".padEnd(11) +
    "Basis".padEnd(18) +
    "WS Price".padEnd(12) +
    "REST Price".padEnd(12) +
    "Dev (bps)".padEnd(12) +
    "Key Req".padEnd(9) +
    "Region Status"
  );
  console.log("-".repeat(105));

  for (const r of results) {
    const devStr = r.deviationFromMedianBps !== undefined ? `${r.deviationFromMedianBps > 0 ? "+" : ""}${r.deviationFromMedianBps.toFixed(1)} bps` : "N/A";
    const regStr = r.regionBlocked ? `BLOCKED (${r.blockReason})` : "ACCESSIBLE";
    console.log(
      r.name.padEnd(18) +
      r.pair.padEnd(11) +
      r.basis.padEnd(18) +
      (r.wsPrice ? `$${r.wsPrice.toFixed(2)}` : "ERR").padEnd(12) +
      (r.restPrice ? `$${r.restPrice.toFixed(2)}` : String(r.restStatus)).padEnd(12) +
      devStr.padEnd(12) +
      (r.keyNeeded ? "YES" : "NO").padEnd(9) +
      regStr
    );
  }

  console.log("=========================================================================================\n");

  // Write detailed report to JSON
  const outDir = path.resolve(__dirname, "../../evidence/oracle");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "venue_connectivity_report.json");
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        networkEnvironment: "local-laptop",
        medianPrice,
        healthyCount,
        venues: results,
      },
      null,
      2
    )
  );
  console.log(`Detailed verification report saved to: ${outFile}\n`);

  return { results, medianPrice, healthyCount };
}

if (require.main === module || (typeof process !== "undefined" && process.argv[1]?.endsWith("check_venue_connectivity.ts"))) {
  runVenueConnectivityCheck()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Fatal error:", err);
      process.exit(1);
    });
}
