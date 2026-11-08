import { PublicKey } from "@solana/web3.js";

export interface ProgramEvent<T = any> {
  name: string;
  data: T;
  signature: string;
  slot: number;
  blockTime: number;
  ixIndex: number;
  eventIndex: number;
}

export interface FundingAccruedData {
  market: string;
  batchId: number;
  fundingIndex: string;
  oraclePrice: string;
  clearingPrice: string;
  timestamp: number;
}

export interface MarketParamsUpdatedData {
  market: string;
  admin: string;
  feeBps: number;
  liqPenaltyBps: number;
  fundingCapBps: number;
  lookahead: number;
  timestamp: number;
}

export interface VaultParamsUpdatedData {
  market: string;
  admin: string;
  isActive: number;
  skewBps: number;
  maxInventoryLots: string;
  timestamp: number;
}

export interface IndexerCursor {
  lastSignature: string | null;
  lastSlot: number;
}

export interface IDbClient {
  query(sql: string, params?: any[]): Promise<any>;
  transaction<T>(fn: (client: IDbClient) => Promise<T>): Promise<T>;
}
