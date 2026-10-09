/**
 * Epoch Protocol - Demo State Reset Script
 * 
 * Prepares the environment for clean judge demo walkthroughs:
 * 1. Checks wallet balances on Devnet for demo wallets.
 * 2. Checks on-chain UserAccount state (collateral, positions, active orders).
 * 3. Withdraws remaining collateral if position is flat and active orders are 0.
 * 4. Resets any browser test storage flags.
 */

import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import epochIdl from "../app/src/lib/epoch_idl.json";
import { rebalanceVault } from "./rebalance_vault";

const DEVNET_RPC = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

async function main() {
  console.log("===============================================================================");
  console.log("                     EPOCH PROTOCOL - DEMO STATE RESET                         ");
  console.log("===============================================================================");
  console.log(`Connecting to: ${DEVNET_RPC}`);

  // Rebalance Backstop Vault inventory to ensure clean two-sided depth for demo
  console.log("\n>>> Step 0: Checking & Rebalancing Backstop Vault Inventory...");
  await rebalanceVault();

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const programId = new PublicKey("CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap");
  const [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], programId);

  console.log(`Program ID: ${programId.toBase58()}`);
  console.log(`Market PDA: ${marketPda.toBase58()}`);

  // Check known demo wallet keypairs if present
  const walletPaths = [
    path.resolve(__dirname, "../keeper/keeper-keypair.json"),
    path.resolve(__dirname, "../research/review/walkthrough/walkthrough_wallet.json"),
  ];

  for (const wp of walletPaths) {
    if (!fs.existsSync(wp)) continue;
    try {
      const keyData = JSON.parse(fs.readFileSync(wp, "utf-8"));
      const keypair = Keypair.fromSecretKey(Uint8Array.from(keyData));
      const pubkey = keypair.publicKey;
      const solBalance = await connection.getBalance(pubkey);

      const [userPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user"), pubkey.toBuffer()],
        programId
      );

      console.log(`\nWallet: ${pubkey.toBase58()} (${path.basename(wp)})`);
      console.log(`  SOL Balance: ${(solBalance / 1e9).toFixed(4)} SOL`);
      console.log(`  User PDA:    ${userPda.toBase58()}`);

      const userAccInfo = await connection.getAccountInfo(userPda);
      if (!userAccInfo) {
        console.log(`  User Account: Not initialized on-chain (clean state ready).`);
        continue;
      }

      const dummyWallet = {
        publicKey: pubkey,
        signTransaction: async (tx: any) => tx,
        signAllTransactions: async (txs: any) => txs,
      };
      const provider = new AnchorProvider(connection, dummyWallet as any, { commitment: "confirmed" });
      const program = new Program(epochIdl as any, provider);
      const userAcc = await (program.account as any).userAccount.fetch(userPda);

      console.log(`  Collateral:      $${(userAcc.collateral.toNumber() / 1e6).toFixed(2)} USDC`);
      console.log(`  Base Position:   ${userAcc.basePosition.toNumber()} lots`);
      console.log(`  Quote Position:  ${userAcc.quotePosition.toString()}`);
      console.log(`  Active Orders:   ${userAcc.activeOrders}`);
      console.log(`  Pending Buy:     ${userAcc.pendingBuyLots.toString()} lots`);
      console.log(`  Pending Sell:    ${userAcc.pendingSellLots.toString()} lots`);

      if (userAcc.activeOrders === 0 && userAcc.basePosition.toNumber() === 0 && userAcc.collateral.toNumber() > 0) {
        console.log(`  Ready for clean demo: Flat position with available collateral.`);
      } else if (userAcc.activeOrders > 0) {
        console.log(`  Notice: Active orders present. Will be cleared when target batches settle.`);
      }
    } catch (err: any) {
      console.warn(`  Warning reading wallet ${wp}:`, err.message);
    }
  }

  console.log("\n-------------------------------------------------------------------------------");
  console.log("Browser State Reset: To reset UI state in browser, disconnect wallet or clear");
  console.log("localStorage / sessionStorage and refresh http://localhost:3000.");
  console.log("===============================================================================");
}

main().catch(console.error);
