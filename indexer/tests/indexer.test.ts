import { describe, it, expect, beforeEach } from "bun:test";
import { EventProcessor } from "../src/processor";
import { IDbClient, ProgramEvent } from "../src/types";

class MockDbClient implements IDbClient {
  public rawEvents: Map<string, any> = new Map();
  public funding: Map<number, any> = new Map();
  public marketParams: any[] = [];
  public vaultParams: any[] = [];
  public cursor: { lastSignature: string | null; lastSlot: number } = {
    lastSignature: null,
    lastSlot: 0,
  };

  async query(sql: string, params: any[] = []): Promise<any> {
    const trimmed = sql.trim();

    if (trimmed.startsWith("SELECT last_signature, last_slot")) {
      return {
        rows: [{ last_signature: this.cursor.lastSignature, last_slot: this.cursor.lastSlot }],
      };
    }

    if (trimmed.startsWith("INSERT INTO events_raw")) {
      const [signature, ixIndex, eventIndex, slot, blockTime, name, data] = params;
      const key = `${signature}:${ixIndex}:${eventIndex}`;
      if (this.rawEvents.has(key)) {
        // ON CONFLICT DO NOTHING
        return { rows: [] };
      }
      this.rawEvents.set(key, { signature, ixIndex, eventIndex, slot, blockTime, name, data });
      return { rows: [{ signature }] };
    }

    if (trimmed.startsWith("INSERT INTO funding")) {
      const [batchId, fundingIndex, rateBps] = params;
      this.funding.set(batchId, { batchId, fundingIndex, rateBps });
      return { rows: [{ batch_id: batchId }] };
    }

    if (trimmed.startsWith("INSERT INTO market_params_history")) {
      this.marketParams.push(params);
      return { rows: [{ id: this.marketParams.length }] };
    }

    if (trimmed.startsWith("INSERT INTO vault_params_history")) {
      this.vaultParams.push(params);
      return { rows: [{ id: this.vaultParams.length }] };
    }

    if (trimmed.startsWith("INSERT INTO indexer_cursor")) {
      const [sig, slot] = params;
      this.cursor = { lastSignature: sig, lastSlot: Math.max(this.cursor.lastSlot, slot) };
      return { rows: [{ id: 1 }] };
    }

    return { rows: [] };
  }

  async transaction<T>(fn: (client: IDbClient) => Promise<T>): Promise<T> {
    return await fn(this);
  }
}

describe("Epoch Event Indexer Service", () => {
  let db: MockDbClient;
  let processor: EventProcessor;

  beforeEach(() => {
    db = new MockDbClient();
    processor = new EventProcessor(db);
  });

  it("1. Idempotently processes duplicate events without double-writes", async () => {
    const event: ProgramEvent = {
      name: "FundingAccrued",
      data: {
        market: "EpochMarket111111111111111111111111111111111",
        batchId: 42,
        fundingIndex: "10000000000000",
        oraclePrice: "150000000",
        clearingPrice: "150010000",
        timestamp: 1700000000,
      },
      signature: "sig_abc_1",
      slot: 100,
      blockTime: 1700000000,
      ixIndex: 0,
      eventIndex: 0,
    };

    // First ingestion
    const res1 = await processor.processEvents([event]);
    expect(res1.processed).toBe(1);
    expect(res1.skippedDuplicates).toBe(0);
    expect(db.funding.size).toBe(1);

    // Duplicate ingestion (same signature, ixIndex, eventIndex)
    const res2 = await processor.processEvents([event]);
    expect(res2.processed).toBe(0);
    expect(res2.skippedDuplicates).toBe(1);
    expect(db.funding.size).toBe(1);
  });

  it("2. Deterministically sorts out-of-order events by slot and index", () => {
    const events: ProgramEvent[] = [
      { name: "E3", data: {}, signature: "s3", slot: 200, blockTime: 0, ixIndex: 0, eventIndex: 0 },
      { name: "E1", data: {}, signature: "s1", slot: 100, blockTime: 0, ixIndex: 1, eventIndex: 1 },
      { name: "E0", data: {}, signature: "s0", slot: 100, blockTime: 0, ixIndex: 0, eventIndex: 0 },
      { name: "E2", data: {}, signature: "s2", slot: 150, blockTime: 0, ixIndex: 0, eventIndex: 0 },
    ];

    const sorted = processor.sortEvents(events);
    expect(sorted.map((e) => e.name)).toEqual(["E0", "E1", "E2", "E3"]);
  });

  it("3. Advances cursor monotonically and resumes on crash recovery", async () => {
    const events: ProgramEvent[] = [
      { name: "E1", data: {}, signature: "sig_1", slot: 105, blockTime: 0, ixIndex: 0, eventIndex: 0 },
      { name: "E2", data: {}, signature: "sig_2", slot: 110, blockTime: 0, ixIndex: 0, eventIndex: 0 },
    ];

    const res = await processor.processEvents(events);
    expect(res.lastCursor.lastSlot).toBe(110);
    expect(res.lastCursor.lastSignature).toBe("sig_2");

    // Verify recovery cursor from DB
    const cursor = await processor.getCursor();
    expect(cursor.lastSlot).toBe(110);
    expect(cursor.lastSignature).toBe("sig_2");
  });

  it("4. Correctly dispatches Phase 1 parameter update events", async () => {
    const marketParamEvent: ProgramEvent = {
      name: "MarketParamsUpdated",
      data: {
        market: "Market111",
        admin: "Admin111",
        feeBps: 25,
        liqPenaltyBps: 200,
        fundingCapBps: 100,
        lookahead: 3,
        timestamp: 1700000000,
      },
      signature: "sig_param_1",
      slot: 120,
      blockTime: 1700000000,
      ixIndex: 0,
      eventIndex: 0,
    };

    const vaultParamEvent: ProgramEvent = {
      name: "VaultParamsUpdated",
      data: {
        market: "Market111",
        admin: "Admin111",
        isActive: 1,
        skewBps: 10,
        maxInventoryLots: "1000",
        timestamp: 1700000005,
      },
      signature: "sig_param_2",
      slot: 121,
      blockTime: 1700000005,
      ixIndex: 0,
      eventIndex: 0,
    };

    const res = await processor.processEvents([marketParamEvent, vaultParamEvent]);
    expect(res.processed).toBe(2);
    expect(db.marketParams.length).toBe(1);
    expect(db.vaultParams.length).toBe(1);
    expect(db.marketParams[0][2]).toBe(25); // feeBps
    expect(db.vaultParams[0][3]).toBe(10);  // skewBps
  });

  it("5. Replay backfill is safe and idempotent across full history", async () => {
    const batchEvents: ProgramEvent[] = [
      { name: "FundingAccrued", data: { batchId: 1, fundingIndex: "100", oraclePrice: "100", clearingPrice: "100", timestamp: 0 }, signature: "s1", slot: 10, blockTime: 0, ixIndex: 0, eventIndex: 0 },
      { name: "FundingAccrued", data: { batchId: 2, fundingIndex: "200", oraclePrice: "100", clearingPrice: "100", timestamp: 0 }, signature: "s2", slot: 12, blockTime: 0, ixIndex: 0, eventIndex: 0 },
      { name: "FundingAccrued", data: { batchId: 3, fundingIndex: "300", oraclePrice: "100", clearingPrice: "100", timestamp: 0 }, signature: "s3", slot: 14, blockTime: 0, ixIndex: 0, eventIndex: 0 },
    ];

    // Initial run
    const run1 = await processor.processEvents(batchEvents);
    expect(run1.processed).toBe(3);

    // Replay run (e.g. historical backfill query over same range)
    const run2 = await processor.processEvents(batchEvents);
    expect(run2.processed).toBe(0);
    expect(run2.skippedDuplicates).toBe(3);
    expect(db.funding.size).toBe(3);
  });
});
