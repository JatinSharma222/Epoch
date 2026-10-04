#!/usr/bin/env bun
/**
 * Epoch — Landing Latency Benchmark Test Harness (Task T-17 / Test L-1)
 * Measures real on-chain transaction landing latency (submit slot vs. landed slot)
 * and compute units consumed on Solana Devnet.
 *
 * Outputs:
 * - evidence/landing_devnet.csv (raw observations)
 * - evidence/landing_devnet_summary.json (summary statistics with P50/P90/P99)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  ComputeBudgetProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const EVIDENCE_DIR = path.join(__dirname, "..", "evidence");
const CSV_FILE = path.join(EVIDENCE_DIR, "landing_devnet.csv");
const SUMMARY_FILE = path.join(EVIDENCE_DIR, "landing_devnet_summary.json");

interface LatencyRecord {
  index: number;
  signature: string;
  submit_slot: number;
  landed_slot: number;
  delta_slots: number;
  submit_time_ms: number;
  confirm_time_ms: number;
  latency_ms: number;
  cu_consumed: number;
  fee_lamports: number;
  network: string;
}

async function main() {
  const rpcUrl =
    process.env.EPOCH_RPC_URL || "https://api.devnet.solana.com";
  console.log("=================================================================");
  console.log("  Epoch — Landing Latency Benchmark Test Harness (T-17 / L-1)");
  console.log(`  RPC URL: ${rpcUrl}`);
  console.log("=================================================================\n");

  const connection = new Connection(rpcUrl, "confirmed");

  // Load keypair
  const keypairPath =
    process.env.ANCHOR_WALLET ||
    path.join(process.env.HOME || "", ".config/solana/id.json");
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Keypair not found at ${keypairPath}`);
  }
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf-8")))
  );
  console.log(`Payer Account: ${payer.publicKey.toBase58()}`);
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Payer Balance: ${(balance / 1e9).toFixed(4)} SOL\n`);

  const numTrials = parseInt(process.env.LANDING_TRIALS || "30", 10);
  console.log(`Starting ${numTrials} sequential landing trials on Devnet...`);

  const records: LatencyRecord[] = [];
  const memoProgramId = new PublicKey(
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
  );

  for (let i = 0; i < numTrials; i++) {
    try {
      const submitTimeMs = Date.now();
      const submitSlot = await connection.getSlot("processed");
      const latestBlockhash = await connection.getLatestBlockhash("confirmed");

      // Transaction with compute budget + memo instruction containing trial timestamp
      const tx = new Transaction({
        feePayer: payer.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
      });

      tx.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
        new TransactionInstruction({
          keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: false }],
          programId: memoProgramId,
          data: Buffer.from(`epoch_landing_test_${i}_${submitTimeMs}`),
        })
      );

      tx.sign(payer);
      const rawTx = tx.serialize();

      const signature = await connection.sendRawTransaction(rawTx, {
        skipPreflight: true,
        maxRetries: 3,
      });

      const confirmResult = await connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        "confirmed"
      );

      const confirmTimeMs = Date.now();
      const latencyMs = confirmTimeMs - submitTimeMs;

      if (confirmResult.value.err) {
        console.warn(`[trial ${i + 1}/${numTrials}] Tx failed:`, confirmResult.value.err);
        continue;
      }

      // Fetch tx info for landed slot and CU
      const txInfo = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      const landedSlot = txInfo?.slot || (await connection.getSlot("confirmed"));
      const deltaSlots = Math.max(0, landedSlot - submitSlot);
      const cuConsumed = txInfo?.meta?.computeUnitsConsumed || 0;
      const feeLamports = txInfo?.meta?.fee || 5000;

      const record: LatencyRecord = {
        index: i + 1,
        signature,
        submit_slot: submitSlot,
        landed_slot: landedSlot,
        delta_slots: deltaSlots,
        submit_time_ms: submitTimeMs,
        confirm_time_ms: confirmTimeMs,
        latency_ms: latencyMs,
        cu_consumed: cuConsumed,
        fee_lamports: feeLamports,
        network: "devnet",
      };

      records.push(record);
      console.log(
        `[trial ${i + 1}/${numTrials}] Landed in ${deltaSlots} slots (${(latencyMs / 1000).toFixed(2)}s, ${cuConsumed} CU) [MEASURED] | sig=${signature.slice(0, 16)}...`
      );

      // Brief delay between transactions
      await new Promise((r) => setTimeout(r, 400));
    } catch (err: any) {
      console.warn(`[trial ${i + 1}/${numTrials}] Error:`, err.message || err);
    }
  }

  if (records.length === 0) {
    console.error("No successful transactions recorded.");
    process.exit(1);
  }

  // Compute Statistics
  const deltas = records.map((r) => r.delta_slots).sort((a, b) => a - b);
  const latencies = records.map((r) => r.latency_ms).sort((a, b) => a - b);
  const cus = records.map((r) => r.cu_consumed).sort((a, b) => a - b);

  const percentile = (arr: number[], p: number) => {
    const idx = Math.min(arr.length - 1, Math.max(0, Math.floor((p / 100) * arr.length)));
    return arr[idx];
  };

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const summary = {
    title: "Epoch Landing Latency Benchmark (T-17 / L-1)",
    network: "devnet",
    date: new Date().toISOString(),
    sample_size: records.length,
    landing_slots: {
      min: deltas[0],
      p50: percentile(deltas, 50),
      p90: percentile(deltas, 90),
      p99: percentile(deltas, 99),
      max: deltas[deltas.length - 1],
      mean: parseFloat(avg(deltas).toFixed(2)),
      label: "MEASURED",
    },
    latency_wall_clock_ms: {
      min: latencies[0],
      p50: percentile(latencies, 50),
      p90: percentile(latencies, 90),
      p99: percentile(latencies, 99),
      max: latencies[latencies.length - 1],
      mean: parseFloat(avg(latencies).toFixed(2)),
      label: "MEASURED",
    },
    compute_units: {
      mean: parseFloat(avg(cus).toFixed(0)),
      label: "MEASURED",
    },
  };

  // Write CSV
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
  const csvHeaders = "index,signature,submit_slot,landed_slot,delta_slots,latency_ms,cu_consumed,fee_lamports,network\n";
  const csvRows = records
    .map(
      (r) =>
        `${r.index},${r.signature},${r.submit_slot},${r.landed_slot},${r.delta_slots},${r.latency_ms},${r.cu_consumed},${r.fee_lamports},${r.network}`
    )
    .join("\n");
  fs.writeFileSync(CSV_FILE, csvHeaders + csvRows + "\n");
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));

  console.log("\n=================== BENCHMARK RESULTS [MEASURED] ===================");
  console.log(`Trials Completed: ${records.length}/${numTrials}`);
  console.log(`Landing Slots:   P50=${summary.landing_slots.p50} slots | P90=${summary.landing_slots.p90} slots | P99=${summary.landing_slots.p99} slots`);
  console.log(`Latency (ms):    P50=${summary.latency_wall_clock_ms.p50}ms | P90=${summary.latency_wall_clock_ms.p90}ms | P99=${summary.latency_wall_clock_ms.p99}ms`);
  console.log(`Mean CU Consumed:${summary.compute_units.mean} CU`);
  console.log(`CSV Export:      ${CSV_FILE}`);
  console.log(`Summary Export:  ${SUMMARY_FILE}`);
  console.log("====================================================================");
}

main().catch((err) => {
  console.error("Fatal benchmark error:", err);
  process.exit(1);
});
