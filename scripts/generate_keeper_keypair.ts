#!/usr/bin/env bun
/**
 * Epoch Keeper Keypair Generator
 * 
 * Generates a fresh Solana Keypair for the keeper service using @solana/web3.js.
 * Requires zero Solana CLI installations.
 * 
 * Usage:
 *   bun run scripts/generate_keeper_keypair.ts [output_path]
 */

import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const targetPath = process.argv[2] || path.join(__dirname, "../keeper/keeper-keypair.json");

// Ensure directory exists
const dir = path.dirname(targetPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

// Generate new keypair
const kp = Keypair.generate();
const secretArray = Array.from(kp.secretKey);

// Write with strict 0600 permissions
fs.writeFileSync(targetPath, JSON.stringify(secretArray), { mode: 0o600 });

console.log("=================================================");
console.log("  Epoch Keeper Keypair Generated Successfully    ");
console.log("=================================================");
console.log(`Public Key:  ${kp.publicKey.toBase58()}`);
console.log(`Saved To:    ${targetPath}`);
console.log(`Permissions: 0600 (owner read/write only)`);
console.log("-------------------------------------------------");
console.log("Next Step: Fund this address via transfer from a funded wallet:");
console.log(`  bun run scripts/fund_keeper.ts ${kp.publicKey.toBase58()} 2.0`);
console.log("=================================================");
