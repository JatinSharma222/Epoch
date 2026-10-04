#!/usr/bin/env bun
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import epochIdl from "../app/src/lib/epoch_idl.json";
import { getMarketPda } from "../app/src/lib/constants";

async function main() {
  const rpcUrl = process.env.EPOCH_RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  const keypairPath =
    process.env.ANCHOR_WALLET ||
    path.join(process.env.HOME || "", ".config/solana/id.json");
  const adminSecret = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const admin = Keypair.fromSecretKey(Uint8Array.from(adminSecret));

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(admin), {
    commitment: "confirmed",
  });
  const program = new anchor.Program(epochIdl as any, provider);
  const [marketPda] = getMarketPda();

  console.log("Updating Backstop Vault sizing on Devnet...");
  const txSig = await program.methods
    .updateVaultParams({
      quoteOffsetBps: [12, 18, 25],
      quoteLots: [new anchor.BN(500), new anchor.BN(1000), new anchor.BN(2000)], // Sized to 3.5 SOL (3,500 lots) total
      maxInventoryLots: new anchor.BN(10000),
      skewBps: 10,
      maxConfBps: 20,
      isActive: 1,
    })
    .accounts({
      market: marketPda,
      admin: admin.publicKey,
    })
    .rpc();

  console.log("✓ Vault params updated successfully!");
  console.log(`Transaction Signature: ${txSig}`);
  console.log(`Solana Explorer: https://explorer.solana.com/tx/${txSig}?cluster=devnet`);

  const market = await (program.account as any).market.fetch(marketPda);
  console.log("New Vault Quote Lots:", market.vaultParams.quoteLots.map((l: any) => l.toNumber()));
  console.log("New Vault Quote Offsets:", market.vaultParams.quoteOffsetBps);
}

main().catch((err) => {
  console.error("Error updating vault params:", err);
  process.exit(1);
});
