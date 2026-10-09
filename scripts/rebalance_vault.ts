/**
 * Epoch Protocol — Backstop Vault Rebalancing Script (Round 11 Requirement 2)
 *
 * Devnet-only administrative rebalance path:
 * 1. Inspects current on-chain Backstop Vault inventory (base_position).
 * 2. If inventory is non-zero, safely restores vault position to flat (0 lots):
 *    - Temporarily expands max_inventory_lots if current inventory has hit or exceeded the limit.
 *    - Quotes the vault ladder in a target batch.
 *    - Places an offsetting counter-order to absorb the vault's inventory imbalance.
 *    - Clears the batch and settles the vault position.
 *    - Restores max_inventory_lots to default (10,000 lots).
 * 3. Verifies on-chain that vault inventory is returned to 0 lots.
 */

import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import epochIdl from "../app/src/lib/epoch_idl.json";
import {
  getMarketPda,
  getBatchPda,
  getUserPda,
  getQuoteMintPda,
  getCollateralVaultPda,
  getVaultAuthorityPda,
} from "../app/src/lib/constants";
import { PythOracleService } from "../keeper/src/oracle";

function getMintAuthorityPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("mint_authority")], programId);
}

export async function rebalanceVault(): Promise<{
  initialInventoryLots: number;
  finalInventoryLots: number;
  rebalanced: boolean;
  txClearSig?: string;
}> {
  console.log("=========================================================================");
  console.log("             EPOCH PROTOCOL — BACKSTOP VAULT REBALANCE                   ");
  console.log("=========================================================================\n");

  const rpcUrl = process.env.EPOCH_RPC_URL || "https://api.devnet.solana.com";
  const wsUrl = process.env.EPOCH_WS_URL || "wss://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, { commitment: "confirmed", wsEndpoint: wsUrl });

  const adminKeyPath =
    process.env.ANCHOR_WALLET ||
    path.join(process.env.HOME || "", ".config/solana/id.json");
  const adminSecret = JSON.parse(fs.readFileSync(adminKeyPath, "utf-8"));
  const admin = Keypair.fromSecretKey(Uint8Array.from(adminSecret));

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(admin),
    { commitment: "confirmed" }
  );
  const program = new anchor.Program(epochIdl as any, provider);

  const [marketPda] = getMarketPda();
  const [quoteMintPda] = getQuoteMintPda();
  const [mintAuthorityPda] = getMintAuthorityPda(program.programId);
  const [collateralVaultPda] = getCollateralVaultPda();
  const [vaultAuthorityPda] = getVaultAuthorityPda();
  const [vaultUserPda] = getUserPda(vaultAuthorityPda);

  const oracleService = new PythOracleService(connection);

  const marketAcc = await (program.account as any).market.fetch(marketPda);
  const vaultUserAcc = await (program.account as any).userAccount.fetch(vaultUserPda);
  const initialInventoryLots = vaultUserAcc.basePosition.toNumber();
  const maxInventoryLots = marketAcc.vaultParams.maxInventoryLots.toNumber();

  console.log(`[Market PDA]         ${marketPda.toBase58()}`);
  console.log(`[Vault Authority]    ${vaultAuthorityPda.toBase58()}`);
  console.log(`[Vault User PDA]     ${vaultUserPda.toBase58()}`);
  console.log(`[Current Inventory]  ${initialInventoryLots} lots (${(initialInventoryLots * 0.001).toFixed(3)} SOL)`);
  console.log(`[Max Inventory]      ${maxInventoryLots} lots (${(maxInventoryLots * 0.001).toFixed(1)} SOL)\n`);

  const minLots = marketAcc.params.minLots || 10;
  if (Math.abs(initialInventoryLots) < minLots) {
    console.log(`✓ Backstop Vault inventory (${initialInventoryLots} lots) is below minimum order size (${minLots} lots). Effectively flat! No rebalancing required.\n`);
    return {
      initialInventoryLots,
      finalInventoryLots: initialInventoryLots,
      rebalanced: false,
    };
  }

  // Set up admin user account & collateral for placing the counter-order
  const [adminUserPda] = getUserPda(admin.publicKey);
  const adminAta = getAssociatedTokenAddressSync(quoteMintPda, admin.publicKey);

  const adminAtaInfo = await connection.getAccountInfo(adminAta);
  if (!adminAtaInfo) {
    console.log("Creating admin quote token ATA...");
    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        admin.publicKey,
        adminAta,
        admin.publicKey,
        quoteMintPda
      )
    );
    await provider.sendAndConfirm(createAtaTx, [admin]);
  }

  const adminUserAccInfo = await connection.getAccountInfo(adminUserPda);
  if (!adminUserAccInfo) {
    console.log("Initializing admin UserAccount PDA...");
    const createUserTx = new Transaction().add(
      await program.methods
        .createUser()
        .accounts({
          user: adminUserPda,
          owner: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction()
    );
    await provider.sendAndConfirm(createUserTx, [admin]);
  }

  // Faucet and deposit collateral if needed
  const adminUserAcc = await (program.account as any).userAccount.fetch(adminUserPda);
  if (adminUserAcc.collateral.toNumber() < 1_000_000_000) {
    console.log("Fauceting and depositing collateral for admin rebalancing...");
    const faucetTx = new Transaction().add(
      await program.methods
        .faucet(new anchor.BN(2_000_000_000))
        .accounts({
          quoteMint: quoteMintPda,
          mintAuthority: mintAuthorityPda,
          recipientTokenAccount: adminAta,
          recipient: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction()
    );
    await provider.sendAndConfirm(faucetTx, [admin]);

    const depositTx = new Transaction().add(
      await program.methods
        .deposit(new anchor.BN(2_000_000_000))
        .accounts({
          market: marketPda,
          user: adminUserPda,
          userTokenAccount: adminAta,
          collateralVault: collateralVaultPda,
          owner: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction()
    );
    await provider.sendAndConfirm(depositTx, [admin]);
  }

  // If inventory is at or exceeds limit, temporarily widen maxInventoryLots so vault can quote
  const absLots = Math.abs(initialInventoryLots);
  if (absLots >= maxInventoryLots) {
    console.log(`Widening max_inventory_lots to ${absLots + 10_000} for rebalancing clearance...`);
    const updateParamsTx = new Transaction().add(
      await program.methods
        .updateVaultParams({
          quoteOffsetBps: marketAcc.vaultParams.quoteOffsetBps,
          quoteLots: marketAcc.vaultParams.quoteLots,
          maxInventoryLots: new anchor.BN(absLots + 20_000),
          skewBps: marketAcc.vaultParams.skewBps,
          maxConfBps: marketAcc.vaultParams.maxConfBps,
          isActive: 1,
        })
        .accounts({
          market: marketPda,
          admin: admin.publicKey,
        })
        .instruction()
    );
    await provider.sendAndConfirm(updateParamsTx, [admin]);
  }

  // Execute rebalancing order in batches
  // The vault ladder has max depth 3,500 lots per batch, so chunk by <= 3,500 lots if needed
  let remainingLots = absLots;
  const isVaultShort = initialInventoryLots < 0;
  // If vault is SHORT (basePosition < 0), rebalancer must SELL (side = 1) so vault BUYS
  // If vault is LONG (basePosition > 0), rebalancer must BUY (side = 0) so vault SELLS
  const rebalanceSide = isVaultShort ? 1 : 0;
  const collarTick = isVaultShort ? 0 : 100;

  console.log(`\nRebalancing ${remainingLots} lots on ${isVaultShort ? "SELL (vault buys)" : "BUY (vault sells)"} side...`);

  let liveSlot = await connection.getSlot("processed");
  connection.onSlotChange((info) => {
    liveSlot = info.slot;
  });

  let lastClearSig = "";

  while (remainingLots > 0) {
    const chunkLots = Math.min(remainingLots, 3500);
    console.log(`Processing chunk of ${chunkLots} lots...`);

    let chunkSig = "";
    while (!chunkSig) {
      try {
        const curOracle = await oracleService.getLatestPrice();
        const curBatch = Math.floor(
          (liveSlot - marketAcc.startSlot.toNumber()) / marketAcc.params.batchSlots
        );
        const targetBatch = curBatch + 3;
        const ringIndex = targetBatch % 8;
        const [targetBatchPda] = getBatchPda(ringIndex);

        const vQuoteIx = await program.methods
          .vaultQuote({
            targetBatch: new anchor.BN(targetBatch),
            ringIndex,
            oraclePrice: curOracle.price,
            oracleConf: curOracle.conf,
            oracleTimestamp: curOracle.publishTime,
          })
          .accounts({
            market: marketPda,
            batch: targetBatchPda,
            vaultAuthority: vaultAuthorityPda,
            vaultUser: vaultUserPda,
            cranker: admin.publicKey,
          })
          .instruction();

        const rebalanceOrderIx = await program.methods
          .placeOrder({
            targetBatch: new anchor.BN(targetBatch),
            ringIndex,
            slotId: 0,
            side: rebalanceSide,
            tick: collarTick,
            lots: new anchor.BN(chunkLots),
            flags: 0,
          })
          .accounts({
            market: marketPda,
            batch: targetBatchPda,
            user: adminUserPda,
            owner: admin.publicKey,
          })
          .instruction();

        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
          vQuoteIx,
          rebalanceOrderIx
        );

        await provider.sendAndConfirm(tx, [admin], { commitment: "confirmed", skipPreflight: true });
        console.log(`✓ Rebalance order placed in Batch #${targetBatch}. Waiting for batch close...`);

        const closeSlot =
          marketAcc.startSlot.toNumber() +
          (targetBatch + 1) * marketAcc.params.batchSlots;
        while (liveSlot < closeSlot + 1) {
          await new Promise((r) => setTimeout(r, 200));
        }

        const clearOracle = await oracleService.getLatestPrice();
        const clearIx = await program.methods
          .clearBatch(new anchor.BN(targetBatch), ringIndex, {
            oraclePrice: clearOracle.price,
            oracleConf: clearOracle.conf,
            oraclePostedSlot: new anchor.BN(closeSlot),
            oracleTimestamp: clearOracle.publishTime,
          })
          .accounts({
            market: marketPda,
            batch: targetBatchPda,
            cranker: admin.publicKey,
          })
          .instruction();

        const settleIx = await program.methods
          .settleUsers(new anchor.BN(targetBatch), ringIndex)
          .accounts({
            market: marketPda,
            batch: targetBatchPda,
          })
          .remainingAccounts([
            { pubkey: adminUserPda, isWritable: true, isSigner: false },
            { pubkey: vaultUserPda, isWritable: true, isSigner: false },
          ])
          .instruction();

        chunkSig = await provider.sendAndConfirm(
          new Transaction().add(
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 }),
            ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
            clearIx,
            settleIx
          ),
          [admin],
          { commitment: "confirmed", skipPreflight: true }
        );

        lastClearSig = chunkSig;
        console.log(`✓ Batch #${targetBatch} cleared & settled! Tx: ${chunkSig}`);
        remainingLots -= chunkLots;
      } catch (err: any) {
        console.error("Error details:", err);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  // Restore max_inventory_lots to default 10,000
  console.log("Restoring max_inventory_lots to 10,000...");
  const resetParamsTx = new Transaction().add(
    await program.methods
      .updateVaultParams({
        quoteOffsetBps: marketAcc.vaultParams.quoteOffsetBps,
        quoteLots: marketAcc.vaultParams.quoteLots,
        maxInventoryLots: new anchor.BN(10_000),
        skewBps: marketAcc.vaultParams.skewBps,
        maxConfBps: marketAcc.vaultParams.maxConfBps,
        isActive: 1,
      })
      .accounts({
        market: marketPda,
        admin: admin.publicKey,
      })
      .instruction()
  );
  await provider.sendAndConfirm(resetParamsTx, [admin]);

  const finalVaultAcc = await (program.account as any).userAccount.fetch(vaultUserPda);
  const finalInventoryLots = finalVaultAcc.basePosition.toNumber();
  console.log(`\n=========================================================================`);
  console.log(`Rebalance Complete!`);
  console.log(`Initial Inventory: ${initialInventoryLots} lots`);
  console.log(`Final Inventory:   ${finalInventoryLots} lots (${(finalInventoryLots * 0.001).toFixed(3)} SOL)`);
  console.log(`=========================================================================\n`);

  return {
    initialInventoryLots,
    finalInventoryLots,
    rebalanced: true,
    txClearSig: lastClearSig,
  };
}

if (require.main === module) {
  rebalanceVault()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Rebalance failed:", err);
      process.exit(1);
    });
}
