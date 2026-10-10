#!/usr/bin/env bun
/**
 * Test Order Error Handling & Friendly UI Parsing (Round 14 Item 6)
 *
 * Tests that placing an order for a closed/past batch produces:
 * 1. An on-chain rejection with error 6008/6010.
 * 2. parseOrderError produces: "Missed the batch, nothing was filled, retry"
 * 3. Never produces "Unknown action 'undefined'"
 * 4. Synthetic 6007 returns "Ring buffer busy: previous batch still clearing, please retry"
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import idl from "../keeper/src/epoch_idl.json";
import { parseOrderError } from "../app/src/lib/errors";

async function main() {
  console.log("=== Testing UI Order Error Handling ===");

  const rpcUrl =
    process.env.EPOCH_RPC_URL ||
    "https://devnet.helius-rpc.com/?api-key=7f051d79-ac86-4394-bae9-346f64974d1a";
  const connection = new Connection(rpcUrl, "confirmed");

  const adminKeyPath =
    process.env.ANCHOR_WALLET ||
    path.join(process.env.HOME || "", ".config/solana/id.json");
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(adminKeyPath, "utf-8")))
  );

  const programId = new PublicKey(
    process.env.EPOCH_PROGRAM_ID ||
      "CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap"
  );
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  const program = new anchor.Program(idl as any, provider);

  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market")],
    programId
  );
  const [userPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user"), walletKeypair.publicKey.toBuffer()],
    programId
  );

  const market = await (program.account as any).market.fetch(marketPda);
  const currentSlot = await connection.getSlot("processed");
  const startSlot = market.startSlot.toNumber();
  const batchSlots = market.params.batchSlots;
  const currentBatch = Math.floor((currentSlot - startSlot) / batchSlots);

  // Target a batch that has definitely already closed (5 batches in past)
  const pastBatch = currentBatch - 5;
  const ringIndex = pastBatch % 8;
  const [batchPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("batch"), Buffer.from([ringIndex])],
    programId
  );

  console.log(`Current slot:  ${currentSlot}`);
  console.log(`Current batch: ${currentBatch}`);
  console.log(`Past batch:    ${pastBatch} (CLOSED)`);

  let caughtError: any = null;
  try {
    await (program.methods as any)
      .placeOrder({
        targetBatch: new anchor.BN(pastBatch),
        ringIndex,
        slotId: 0,
        side: 0, // BUY
        tick: 50,
        lots: new anchor.BN(10),
        flags: 0,
      })
      .accounts({
        market: marketPda,
        batch: batchPda,
        user: userPda,
        owner: walletKeypair.publicKey,
      })
      .rpc();
  } catch (err) {
    caughtError = err;
  }

  if (!caughtError) {
    throw new Error("FAIL: Order on closed batch should have failed but succeeded!");
  }

  console.log("\n[1] Raw Error Caught:");
  console.log("    Type:", caughtError.constructor.name);
  console.log("    Message:", caughtError.message);

  const friendlyMessage = parseOrderError(caughtError);
  console.log("\n[2] Friendly UI Message Parsed:");
  console.log(`    "${friendlyMessage}"`);

  // Assertions
  if (friendlyMessage.includes("Unknown action")) {
    throw new Error(`FAIL: Friendly message contains 'Unknown action'! Message: "${friendlyMessage}"`);
  }

  if (friendlyMessage !== "Missed the batch, nothing was filled, retry") {
    throw new Error(
      `FAIL: Expected 'Missed the batch, nothing was filled, retry', got: "${friendlyMessage}"`
    );
  }
  console.log("✓ PASS: Closed batch correctly mapped to 'Missed the batch, nothing was filled, retry'");

  // Test synthetic 6007
  const synthetic6007 = new Error("AnchorError thrown in programs/epoch. Error Code: RingSlotBusy. Error Number: 6007.");
  const msg6007 = parseOrderError(synthetic6007);
  console.log(`\n[3] Synthetic 6007 parsed: "${msg6007}"`);
  if (!msg6007.includes("Ring buffer busy")) {
    throw new Error(`FAIL: Expected ring buffer busy message, got: "${msg6007}"`);
  }
  console.log("✓ PASS: 6007 mapped to friendly Ring buffer busy message");

  // Test synthetic "Unknown action 'undefined'" raw error
  const syntheticUndef = new Error("Unknown action 'undefined'");
  const msgUndef = parseOrderError(syntheticUndef);
  console.log(`\n[4] Synthetic undefined action parsed: "${msgUndef}"`);
  if (msgUndef.includes("Unknown action") || msgUndef.includes("undefined")) {
    throw new Error(`FAIL: Friendly message leaked raw undefined artifact: "${msgUndef}"`);
  }
  console.log("✓ PASS: Raw 'Unknown action undefined' sanitized to friendly retry message");

  console.log("\n==============================================");
  console.log("✓ ALL UI ERROR PARSING TESTS PASSED [MEASURED]");
  console.log("==============================================");
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
