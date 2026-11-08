import { IDbClient, IndexerCursor, ProgramEvent, FundingAccruedData, MarketParamsUpdatedData, VaultParamsUpdatedData } from "./types";

export class EventProcessor {
  private db: IDbClient;

  constructor(db: IDbClient) {
    this.db = db;
  }

  /**
   * Loads the current indexer cursor from Postgres.
   */
  public async getCursor(): Promise<IndexerCursor> {
    const res = await this.db.query("SELECT last_signature, last_slot FROM indexer_cursor WHERE id = 1");
    if (res.rows && res.rows.length > 0) {
      return {
        lastSignature: res.rows[0].last_signature,
        lastSlot: Number(res.rows[0].last_slot || 0),
      };
    }
    return { lastSignature: null, lastSlot: 0 };
  }

  /**
   * Sorts events strictly by (slot ASC, ixIndex ASC, eventIndex ASC).
   */
  public sortEvents(events: ProgramEvent[]): ProgramEvent[] {
    return [...events].sort((a, b) => {
      if (a.slot !== b.slot) return a.slot - b.slot;
      if (a.ixIndex !== b.ixIndex) return a.ixIndex - b.ixIndex;
      return a.eventIndex - b.eventIndex;
    });
  }

  /**
   * Ingests a batch of events idempotently inside a single database transaction.
   * Updates raw event log, derived tables, and advances the indexer cursor atomically.
   */
  public async processEvents(events: ProgramEvent[]): Promise<{
    processed: number;
    skippedDuplicates: number;
    lastCursor: IndexerCursor;
  }> {
    if (events.length === 0) {
      const cursor = await this.getCursor();
      return { processed: 0, skippedDuplicates: 0, lastCursor: cursor };
    }

    const sorted = this.sortEvents(events);

    return await this.db.transaction(async (tx) => {
      let processed = 0;
      let skippedDuplicates = 0;
      let maxSlot = 0;
      let latestSig: string | null = null;

      for (const event of sorted) {
        // 1. Idempotent insert into events_raw
        const rawRes = await tx.query(
          `INSERT INTO events_raw (signature, ix_index, event_index, slot, block_time, name, data)
           VALUES ($1, $2, $3, $4, to_timestamp($5), $6, $7)
           ON CONFLICT (signature, ix_index, event_index) DO NOTHING
           RETURNING signature`,
          [
            event.signature,
            event.ixIndex,
            event.eventIndex,
            event.slot,
            event.blockTime,
            event.name,
            JSON.stringify(event.data),
          ]
        );

        if (!rawRes.rows || rawRes.rows.length === 0) {
          // Duplicate event, skip domain processing to guarantee idempotency
          skippedDuplicates++;
          continue;
        }

        processed++;
        if (event.slot >= maxSlot) {
          maxSlot = event.slot;
          latestSig = event.signature;
        }

        // 2. Dispatch domain-specific tables
        switch (event.name) {
          case "FundingAccrued": {
            const data = event.data as FundingAccruedData;
            await tx.query(
              `INSERT INTO funding (batch_id, funding_index, rate_bps)
               VALUES ($1, $2, $3)
               ON CONFLICT (batch_id) DO UPDATE
               SET funding_index = EXCLUDED.funding_index, rate_bps = EXCLUDED.rate_bps`,
              [data.batchId, data.fundingIndex, 0]
            );
            break;
          }

          case "MarketParamsUpdated": {
            const data = event.data as MarketParamsUpdatedData;
            await tx.query(
              `INSERT INTO market_params_history (market, admin, fee_bps, liq_penalty_bps, funding_cap_bps, lookahead, slot, signature, timestamp)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9))`,
              [
                data.market,
                data.admin,
                data.feeBps,
                data.liqPenaltyBps,
                data.fundingCapBps,
                data.lookahead,
                event.slot,
                event.signature,
                data.timestamp,
              ]
            );
            break;
          }

          case "VaultParamsUpdated": {
            const data = event.data as VaultParamsUpdatedData;
            await tx.query(
              `INSERT INTO vault_params_history (market, admin, is_active, skew_bps, max_inventory_lots, slot, signature, timestamp)
               VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8))`,
              [
                data.market,
                data.admin,
                data.isActive,
                data.skewBps,
                data.maxInventoryLots,
                event.slot,
                event.signature,
                data.timestamp,
              ]
            );
            break;
          }

          default:
            // Other events are safely captured in events_raw
            break;
        }
      }

      // 3. Atomically update cursor
      let finalCursor: IndexerCursor;
      if (maxSlot > 0 && latestSig) {
        await tx.query(
          `INSERT INTO indexer_cursor (id, last_signature, last_slot)
           VALUES (1, $1, $2)
           ON CONFLICT (id) DO UPDATE
           SET last_signature = EXCLUDED.last_signature, last_slot = GREATEST(indexer_cursor.last_slot, EXCLUDED.last_slot)`,
          [latestSig, maxSlot]
        );
        finalCursor = { lastSignature: latestSig, lastSlot: maxSlot };
      } else {
        const c = await this.getCursor();
        finalCursor = c;
      }

      return { processed, skippedDuplicates, lastCursor: finalCursor };
    });
  }
}
