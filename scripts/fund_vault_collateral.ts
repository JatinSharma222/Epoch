import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import epochIdl from "../app/src/lib/epoch_idl.json";
import {
  PROGRAM_ID,
  getMarketPda,
  getQuoteMintPda,
  getCollateralVaultPda,
  getVaultAuthorityPda,
  getVaultUserPda,
} from "../app/src/lib/constants";

async function main() {
  const rpcUrl = process.env.EPOCH_RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  const keyPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME || "", ".config/solana/epoch-v1-keys/epoch-authority-keypair.json");
  const secret = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(secret));

  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new anchor.Program(epochIdl as any, provider);

  const [marketPda] = getMarketPda();
  const [quoteMintPda] = getQuoteMintPda();
  const [collateralVaultPda] = getCollateralVaultPda();
  const [vaultAuthorityPda] = getVaultAuthorityPda();
  const [vaultUserPda] = getVaultUserPda();
  const [mintAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_authority")], PROGRAM_ID);
  const [faucetRecordPda] = PublicKey.findProgramAddressSync([Buffer.from("faucet"), payer.publicKey.toBuffer()], PROGRAM_ID);

  const payerAta = getAssociatedTokenAddressSync(quoteMintPda, payer.publicKey);

  console.log(`Funding Backstop Vault on ${rpcUrl}...`);
  console.log(`Payer:             ${payer.publicKey.toBase58()}`);
  console.log(`Vault User PDA:    ${vaultUserPda.toBase58()}`);
  console.log(`Collateral Vault:  ${collateralVaultPda.toBase58()}`);

  // Create ATA if not exists
  const ataInfo = await connection.getAccountInfo(payerAta);
  if (!ataInfo) {
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(payer.publicKey, payerAta, payer.publicKey, quoteMintPda)
    );
    await provider.sendAndConfirm(tx);
    console.log(`Created ATA: ${payerAta.toBase58()}`);
  }

  // Claim from faucet: 10,000 USDC = 10,000,000,000 micro-USDC
  const amount = new anchor.BN(10_000_000_000);
  console.log("Claiming 10,000 USDC from faucet...");
  await program.methods
    .faucet(amount)
    .accounts({
      quoteMint: quoteMintPda,
      mintAuthority: mintAuthorityPda,
      recipientTokenAccount: payerAta,
      faucetRecord: faucetRecordPda,
      recipient: payer.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  // Fund Vault
  console.log("Depositing 10,000 USDC into Backstop Vault...");
  const fundTx = await program.methods
    .fundVault(amount)
    .accounts({
      market: marketPda,
      vaultAuthority: vaultAuthorityPda,
      vaultUser: vaultUserPda,
      funderTokenAccount: payerAta,
      collateralVault: collateralVaultPda,
      funder: payer.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log(`✓ Backstop Vault funded with 10,000 USDC! Tx: ${fundTx}`);
}

main().catch((err) => {
  console.error("Funding vault failed:", err);
  process.exit(1);
});
