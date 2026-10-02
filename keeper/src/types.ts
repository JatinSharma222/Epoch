import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

export interface KeeperConfig {
  rpcUrl: string;
  wsUrl?: string;
  programId: PublicKey;
  keypairPath?: string;
  databaseUrl?: string;
  commitment?: anchor.web3.Commitment;
  logFilePath?: string;
  pollIntervalMs?: number;
  pageSize?: number;
  oracleFeedId?: string;
  network?: "devnet" | "localnet" | "mainnet";
}

export interface OraclePriceData {
  price: anchor.BN;
  conf: anchor.BN;
  postedSlot: anchor.BN;
  publishTime: anchor.BN;
  isFallback?: boolean;
}

export interface TxLogEntry {
  signature: string;
  kind: "clear_batch" | "settle_users" | "place_order" | "vault_quote";
  source: "keeper" | "loadgen" | "landing_test";
  network: string;
  method?: string;
  submit_slot?: number;
  landed_slot?: number;
  cu_consumed?: number;
  success: boolean;
  error?: string | null;
  created_at: string;
  batch_id?: number;
  ring_index?: number;
}

export interface BatchSummary {
  ringIndex: number;
  batchId: number;
  status: number;
  statusName: string;
  numOrders: number;
  settledOrders: number;
  closeSlot: number;
  matchedLots: number;
  clearingPrice: number;
}

export interface VaultStatus {
  vaultAuthority: PublicKey;
  vaultUser: PublicKey;
  inventoryLots: number;
  collateralMicroUsdc: number;
  quotePositionMicroUsdc: string;
  activeOrders: number;
}

