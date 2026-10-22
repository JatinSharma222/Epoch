/**
 * Multi-Venue Oracle Aggregator Types
 */

export type VenueState = "CONNECTED" | "DEGRADED" | "STALE" | "DISCONNECTED";

export interface VenuePrice {
  venueId: string;
  name: string;
  pair: string;
  bid: number;
  ask: number;
  mid: number;
  spreadBps: number;
  exchangeTimeMs?: number;
  arrivalTimeMs: number;
}

export interface VenueHealth {
  venueId: string;
  name: string;
  state: VenueState;
  lastMessageMs: number;
  messageCount: number;
  errorCount: number;
  reconnectCount: number;
  lastPrice?: number;
}

export interface AggregatePrice {
  priceMicroUsdc: number;        // integer, 6 decimals (e.g. 105420000 for $105.42)
  confMicroUsdc: number;         // integer, 6 decimals
  priceUsd: number;              // floating point (e.g. 105.42)
  confUsd: number;               // floating point (e.g. 0.05)
  publishTimeSec: number;        // unix timestamp seconds
  timestampMs: number;           // local arrival timestamp
  venuesTotal: number;           // total configured venues (6)
  venuesFresh: number;           // venues with update < 2000ms old
  venuesUsed: number;            // venues included after 30 bps outlier rejection
  outliersDropped: string[];     // IDs of venues rejected (> 30 bps deviation)
  isLowConfidence: boolean;      // flagged if sources disagree or outliers present
  spreadBps: number;             // max_mid - min_mid in bps
  sourcePrices: Record<string, number>; // venueId -> mid price
}

export interface AggregatorLogEntry {
  iso: string;
  timestampMs: number;
  aggregate: {
    priceUsd: number;
    confUsd: number;
    venuesFresh: number;
    venuesUsed: number;
    isLowConfidence: boolean;
    spreadBps: number;
    outliersDropped: string[];
  };
  venues: Record<
    string,
    {
      mid: number;
      bid: number;
      ask: number;
      ageMs: number;
      deviationBps: number;
      dropped: boolean;
    }
  >;
}
