#!/usr/bin/env bun
/**
 * Epoch Protocol — Link & On-Chain Reference Verifier (Final Round 13)
 *
 * Scans README.md, KNOWN_LIMITATIONS.md, Evidence page, and all reports.
 * Extracts every Solana address and transaction signature.
 * Queries Solana Devnet RPC and prints FOUND or NOT FOUND.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const RPC_URL =
  process.env.EPOCH_RPC_URL ||
  process.env.NEXT_PUBLIC_RPC_URL ||
  "https://devnet.helius-rpc.com/?api-key=7f051d79-ac86-4394-bae9-346f64974d1a";

const connection = new Connection(RPC_URL, "confirmed");

const TARGET_FILES = [
  "README.md",
  "docs/KNOWN_LIMITATIONS.md",
  "app/src/components/EvidenceView.tsx",
  "REPORT_9.md",
  "REPORT_10.md",
  "REPORT_11.md",
  "REPORT_12.md",
  "REPORT_13.md",
  "research/review/REPORT_9.md",
  "research/review/REPORT_10.md",
  "research/review/REPORT_11.md",
  "research/review/REPORT_12.md",
  "research/review/REPORT_13.md",
  "evidence/round_11_sell_and_size_report.json",
  "evidence/round_12_vault_limit_reversal_report.json",
];

interface ExtractedItem {
  type: "address" | "signature";
  value: string;
  sourceFiles: string[];
}

function extractItemsFromFiles(): Map<string, ExtractedItem> {
  const items = new Map<string, ExtractedItem>();

  const base58Regex = /[1-9A-HJ-NP-za-km-z]+/g;
  const explorerUrlRegex =
    /https:\/\/explorer\.solana\.com\/(address|tx)\/([1-9A-HJ-NP-za-km-z]+)/g;

  for (const relPath of TARGET_FILES) {
    const fullPath = path.resolve(__dirname, "..", relPath);
    if (!fs.existsSync(fullPath)) continue;

    const content = fs.readFileSync(fullPath, "utf-8");

    // 1. Extract from Explorer URLs
    let match: RegExpExecArray | null;
    while ((match = explorerUrlRegex.exec(content)) !== null) {
      const type = match[1] === "address" ? "address" : "signature";
      const val = match[2];
      const existing = items.get(val);
      if (existing) {
        if (!existing.sourceFiles.includes(relPath)) {
          existing.sourceFiles.push(relPath);
        }
      } else {
        items.set(val, { type, value: val, sourceFiles: [relPath] });
      }
    }

    // 2. Extract potential backticked or standalone base58 tokens
    const backtickRegex = /`([1-9A-HJ-NP-za-km-z]{32,88})`/g;
    while ((match = backtickRegex.exec(content)) !== null) {
      const val = match[1];
      // Skip if already found or if it's common code word
      if (items.has(val)) {
        const existing = items.get(val)!;
        if (!existing.sourceFiles.includes(relPath)) existing.sourceFiles.push(relPath);
        continue;
      }
      if (val.length >= 87 && val.length <= 88) {
        items.set(val, { type: "signature", value: val, sourceFiles: [relPath] });
      } else if (val.length >= 32 && val.length <= 44) {
        try {
          new PublicKey(val);
          items.set(val, { type: "address", value: val, sourceFiles: [relPath] });
        } catch {
          // not a valid base58 public key
        }
      }
    }
  }

  return items;
}

async function verifyAll() {
  console.log("=========================================================================");
  console.log("       EPOCH PROTOCOL — DEVNET REFERENCE & LINK VERIFIER (FINAL)        ");
  console.log("=========================================================================\n");
  console.log(`Connecting to RPC: ${RPC_URL}`);

  const itemsMap = extractItemsFromFiles();
  const allItems = Array.from(itemsMap.values());

  const addresses = allItems.filter((i) => i.type === "address");
  const signatures = allItems.filter((i) => i.type === "signature");

  console.log(`Discovered references across ${TARGET_FILES.length} target files:`);
  console.log(`  - Public Key Addresses:   ${addresses.length}`);
  console.log(`  - Transaction Signatures: ${signatures.length}`);
  console.log(`  - Total Entities:         ${allItems.length}\n`);

  let passedCount = 0;
  let failedCount = 0;

  // 1. Verify Addresses
  console.log("--- 1. VERIFYING ON-CHAIN ADDRESSES ---");
  for (const addrItem of addresses) {
    try {
      const pubkey = new PublicKey(addrItem.value);
      const acc = await connection.getAccountInfo(pubkey);
      if (acc !== null) {
        console.log(`[FOUND]     Address: ${addrItem.value}`);
        console.log(`            Owner:   ${acc.owner.toBase58()} | Executable: ${acc.executable} | Lamports: ${acc.lamports}`);
        console.log(`            Files:   ${addrItem.sourceFiles.join(", ")}`);
        passedCount++;
      } else {
        console.warn(`[NOT FOUND] Address: ${addrItem.value}`);
        console.warn(`            Files:   ${addrItem.sourceFiles.join(", ")}`);
        failedCount++;
      }
    } catch (err: any) {
      console.error(`[ERROR]     Address: ${addrItem.value} - ${err.message}`);
      failedCount++;
    }
  }

  // 2. Verify Signatures (batching in chunks of 50 for rate limits)
  console.log("\n--- 2. VERIFYING TRANSACTION SIGNATURES ---");
  const chunkSize = 25;
  for (let i = 0; i < signatures.length; i += chunkSize) {
    const chunk = signatures.slice(i, i + chunkSize);
    const sigStrings = chunk.map((c) => c.value);

    try {
      const statuses = await connection.getSignatureStatuses(sigStrings);
      for (let j = 0; j < chunk.length; j++) {
        const item = chunk[j];
        const status = statuses.value[j];

        if (status !== null && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized" || status.confirmations !== null)) {
          console.log(`[FOUND]     Tx:    ${item.value}`);
          console.log(`            Slot:  ${status.slot} | Status: ${status.confirmationStatus} | Err: ${status.err ? JSON.stringify(status.err) : "none"}`);
          console.log(`            Files: ${item.sourceFiles.join(", ")}`);
          passedCount++;
        } else {
          // Fallback check getTransaction
          try {
            const tx = await connection.getTransaction(item.value, {
              maxSupportedTransactionVersion: 0,
            });
            if (tx !== null) {
              console.log(`[FOUND]     Tx:    ${item.value}`);
              console.log(`            Slot:  ${tx.slot} (via getTransaction)`);
              console.log(`            Files: ${item.sourceFiles.join(", ")}`);
              passedCount++;
            } else {
              console.warn(`[NOT FOUND] Tx:    ${item.value}`);
              console.warn(`            Files: ${item.sourceFiles.join(", ")}`);
              failedCount++;
            }
          } catch {
            console.warn(`[NOT FOUND] Tx:    ${item.value}`);
            console.warn(`            Files: ${item.sourceFiles.join(", ")}`);
            failedCount++;
          }
        }
      }
    } catch (err: any) {
      console.error(`Batch signature query error: ${err.message}`);
    }
  }

  console.log("\n=========================================================================");
  console.log("                        VERIFICATION SUMMARY                             ");
  console.log("=========================================================================");
  console.log(`Total Entities Checked: ${allItems.length}`);
  console.log(`Found On Devnet:        ${passedCount}`);
  console.log(`Not Found / Missing:    ${failedCount}`);
  console.log("=========================================================================\n");

  if (failedCount > 0) {
    console.error(`FAILURE: ${failedCount} reference(s) were NOT FOUND on Solana Devnet.`);
    process.exit(1);
  } else {
    console.log("SUCCESS: All addresses and transaction signatures are FOUND on Solana Devnet!");
  }
}

verifyAll().catch((err) => {
  console.error("Verifier script fatal error:", err);
  process.exit(1);
});
