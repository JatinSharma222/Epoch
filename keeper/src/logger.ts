import * as fs from "fs";
import * as path from "path";
import { TxLogEntry } from "./types";

export class KeeperLogger {
  private logFilePath: string;

  constructor(logFilePath?: string) {
    this.logFilePath =
      logFilePath || path.resolve(process.cwd(), "logs/tx_log.jsonl");
    const dir = path.dirname(this.logFilePath);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        // Ignored if cannot create
      }
    }
  }

  public logTx(entry: TxLogEntry): void {
    const formatted = JSON.stringify(entry);

    // 1. Console structured output
    const statusIcon = entry.success ? "✓" : "✗";
    console.log(
      `[keeper] ${statusIcon} ${entry.kind.toUpperCase()} batch=${entry.batch_id ?? "?"} ` +
        `slot=${entry.submit_slot}->${entry.landed_slot ?? "?"} ` +
        `cu=${entry.cu_consumed ?? "?"} [MEASURED] ` +
        `sig=${entry.signature.slice(0, 16)}...` +
        (entry.error ? ` error=${entry.error}` : "")
    );

    // 2. Append to JSONL file
    try {
      fs.appendFileSync(this.logFilePath, formatted + "\n", "utf-8");
    } catch (err) {
      console.error(`[keeper] Failed to write to JSONL log:`, err);
    }
  }

  public logHealth(entry: {
    timestamp: string;
    slot: number;
    keeperBalanceSol: number;
    status: "HEALTHY" | "DEGRADED" | "CRITICAL";
    nextBatchToClear?: number;
    lastBatchClearedAgeSec?: number;
    details?: string;
  }): void {
    const healthPath = path.resolve(path.dirname(this.logFilePath), "health.log");
    try {
      fs.appendFileSync(healthPath, JSON.stringify(entry) + "\n", "utf-8");
    } catch (err) {
      console.warn(`[keeper] Failed to write health log:`, err);
    }
  }

  public info(msg: string, ...args: any[]): void {
    console.log(`[keeper:info] ${msg}`, ...args);
  }

  public warn(msg: string, ...args: any[]): void {
    console.warn(`[keeper:warn] ${msg}`, ...args);
  }

  public error(msg: string, ...args: any[]): void {
    console.error(`[keeper:error] ${msg}`, ...args);
  }
}
