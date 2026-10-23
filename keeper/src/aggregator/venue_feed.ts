/**
 * Epoch Protocol — Individual Venue WebSocket Feed Manager
 *
 * Handles persistent WebSocket connection, automatic exponential backoff reconnection,
 * heartbeat/pings, and parsing real-time L1 book-ticker prices.
 */

import { VenuePrice, VenueHealth, VenueState } from "./types";

export interface FeedConfig {
  id: string;
  name: string;
  pair: string;
  wsUrl: string;
  subPayload?: any;
  pingIntervalMs?: number;
  pingPayload?: any;
  parse: (raw: any, recvMs: number) => { bid: number; ask: number; exchTimeMs?: number } | null;
}

export class VenueFeed {
  public readonly config: FeedConfig;
  private ws: any = null;
  private isRunning: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;

  // Single latest price stored in memory (0 memory growth)
  private latestPrice: VenuePrice | null = null;

  // Health tracking
  private messageCount: number = 0;
  private errorCount: number = 0;
  private reconnectCount: number = 0;
  private lastMessageMs: number = 0;
  private state: VenueState = "DISCONNECTED";

  constructor(config: FeedConfig) {
    this.config = config;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.connect();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.state = "DISCONNECTED";
  }

  public getLatestPrice(): VenuePrice | null {
    return this.latestPrice;
  }

  /**
   * Venue is ACTIVE if WebSocket connection is open (CONNECTED),
   * heartbeat/message was received within maxHeartbeatAgeMs (default 10s),
   * and a non-zero valid mid price is recorded.
   */
  public isActive(maxHeartbeatAgeMs: number = 10_000): boolean {
    if (this.state !== "CONNECTED") return false;
    const now = Date.now();
    const age = now - this.lastMessageMs;
    return age <= maxHeartbeatAgeMs && this.latestPrice !== null && this.latestPrice.mid > 0;
  }

  /**
   * Returns the last valid mid price if the venue connection is healthy and active.
   */
  public getEffectivePrice(maxHeartbeatAgeMs: number = 10_000): VenuePrice | null {
    if (!this.isActive(maxHeartbeatAgeMs)) {
      return null;
    }
    return this.latestPrice;
  }

  public getHealth(): VenueHealth {
    const now = Date.now();
    let computedState = this.state;
    if (this.state === "CONNECTED") {
      const age = now - this.lastMessageMs;
      if (age > 10_000) {
        computedState = "STALE";
      } else if (age > 4_000) {
        computedState = "DEGRADED";
      }
    }

    return {
      venueId: this.config.id,
      name: this.config.name,
      state: computedState,
      lastMessageMs: this.lastMessageMs,
      messageCount: this.messageCount,
      errorCount: this.errorCount,
      reconnectCount: this.reconnectCount,
      lastPrice: this.latestPrice?.mid,
    };
  }

  private connect(): void {
    if (!this.isRunning) return;

    try {
      this.ws = new WebSocket(this.config.wsUrl);

      this.ws.onopen = () => {
        this.state = "CONNECTED";
        this.reconnectAttempts = 0;

        if (this.config.subPayload) {
          try {
            this.ws.send(JSON.stringify(this.config.subPayload));
          } catch {}
        }

        // Start heartbeat if configured
        if (this.config.pingIntervalMs && this.config.pingPayload) {
          if (this.pingTimer) clearInterval(this.pingTimer);
          this.pingTimer = setInterval(() => {
            if (this.ws && this.state === "CONNECTED") {
              try {
                this.ws.send(JSON.stringify(this.config.pingPayload));
              } catch {}
            }
          }, this.config.pingIntervalMs);
        }
      };

      this.ws.onmessage = (event: any) => {
        const now = Date.now();
        this.lastMessageMs = now;
        this.messageCount++;

        try {
          const raw = JSON.parse(event.data);
          const parsed = this.config.parse(raw, now);
          if (parsed && parsed.bid > 0 && parsed.ask > 0) {
            const mid = (parsed.bid + parsed.ask) / 2;
            const spreadBps = ((parsed.ask - parsed.bid) / mid) * 10000;

            // Overwrite single slot (O(1) memory)
            this.latestPrice = {
              venueId: this.config.id,
              name: this.config.name,
              pair: this.config.pair,
              bid: parsed.bid,
              ask: parsed.ask,
              mid,
              spreadBps,
              exchangeTimeMs: parsed.exchTimeMs,
              arrivalTimeMs: now,
            };
          }
        } catch {}
      };

      this.ws.onerror = () => {
        this.errorCount++;
      };

      this.ws.onclose = () => {
        this.state = "DISCONNECTED";
        if (this.pingTimer) {
          clearInterval(this.pingTimer);
          this.pingTimer = null;
        }
        if (this.isRunning) {
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      this.errorCount++;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.isRunning || this.reconnectTimer) return;

    this.reconnectCount++;
    this.reconnectAttempts++;

    // Exponential backoff: 500ms, 1000ms, 2000ms, 4000ms... up to 10s max, with jitter
    const baseDelay = Math.min(10000, 500 * Math.pow(1.8, this.reconnectAttempts - 1));
    const jitter = Math.random() * 300;
    const delay = Math.round(baseDelay + jitter);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
