#!/usr/bin/env bun
/**
 * Fund Keeper via Direct SOL Transfer (No Airdrop)
 * 
 * Transfers SOL from the admin/deployer keypair to the keeper address.
 * Bypasses flaky public devnet airdrop rate limits.
 * 
 * Usage:
 *   bun run scripts/fund_keeper.ts <keeper_pubkey> [amount_sol]
 */

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const recipientStr = process.argv[2];
  const amountSol = parseFloat(process.argv[3] || "1.0");

  if (!recipientStr) {
    console.error("Usage: bun run scripts/fund_keeper.ts <recipient_pubkey> [amount_sol]");
    process.exit(1);
  }

  const recipient = new PublicKey(recipientStr);
  const rpcUrl = process.env.EPOCH_RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  const adminKeyPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME || "", ".config/solana/id.json");
  if (!fs.existsSync(adminKeyPath)) {
    throw new Error(`Admin keypair not found at: ${adminKeyPath}`);
  }

  const adminSecret = JSON.parse(fs.readFileSync(adminKeyPath, "utf-8"));
  const admin = Keypair.fromSecretKey(Uint8Array.from(adminSecret));

  console.log(`Payer (Admin):   ${admin.publicKey.toBase58()}`);
  console.log(`Recipient:       ${recipient.toBase58()}`);
  console.log(`Amount:          ${amountSol} SOL`);
  console.log(`RPC:             ${rpcUrl}`);

  const payerBalance = await connection.getBalance(admin.publicKey);
  console.log(`Payer Balance:   ${payerBalance / LAMPORTS_PER_SOL} SOL`);

  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);
  if (payerBalance < lamports + 100_000) {
    throw new Error(`Insufficient funds: payer has ${payerBalance / LAMPORTS_PER_SOL} SOL, requested ${amountSol} SOL`);
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: admin.publicKey,
      toPubkey: recipient,
      lamports,
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });
  console.log("✓ Transfer confirmed!");
  console.log(`Tx Signature:    ${sig}`);
  console.log(`Explorer Link:   https://explorer.solana.com/tx/${sig}?cluster=devnet`);

  const newBal = await connection.getBalance(recipient);
  console.log(`Recipient New Balance: ${newBal / LAMPORTS_PER_SOL} SOL`);
}

main().catch((err) => {
  console.error("Funding error:", err);
  process.exit(1);
});
