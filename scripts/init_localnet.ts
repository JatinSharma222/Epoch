import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import epochIdl from "../app/src/lib/epoch_idl.json";
import {
  PROGRAM_ID,
  getMarketPda,
  getBatchPda,
  getQuoteMintPda,
  getCollateralVaultPda,
  getVaultAuthorityPda,
  getVaultUserPda,
} from "../app/src/lib/constants";

async function main() {
  const rpcUrl = process.argv.includes("--devnet")
    ? (process.env.EPOCH_RPC_URL || "https://api.devnet.solana.com")
    : "http://127.0.0.1:8899";
  console.log(`\n=== Initializing Epoch Protocol on ${rpcUrl} ===`);

  const connection = new Connection(rpcUrl, "confirmed");

  // Load wallet
  const keypairPath =
    process.env.ANCHOR_WALLET ||
    path.join(process.env.HOME || "", ".config/solana/id.json");

  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Keypair not found at ${keypairPath}`);
  }

  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
  console.log(`Admin Wallet: ${payer.publicKey.toBase58()}`);

  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = new anchor.Program(epochIdl as any, provider);

  const [marketPda, marketBump] = getMarketPda();
  const [quoteMintPda] = getQuoteMintPda();
  const [collateralVaultPda] = getCollateralVaultPda();
  const [vaultAuthorityPda] = getVaultAuthorityPda();
  const [vaultUserPda] = getVaultUserPda();
  const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority")],
    PROGRAM_ID
  );

  console.log(`Market PDA:           ${marketPda.toBase58()}`);
  console.log(`Quote Mint PDA:       ${quoteMintPda.toBase58()}`);
  console.log(`Mint Authority PDA:   ${mintAuthorityPda.toBase58()}`);
  console.log(`Collateral Vault PDA: ${collateralVaultPda.toBase58()}`);
  console.log(`Vault Authority PDA:  ${vaultAuthorityPda.toBase58()}`);
  console.log(`Vault User PDA:       ${vaultUserPda.toBase58()}`);

  // 1. Initialize 8 Ring Batches
  console.log("\n[1/3] Initializing 8 Ring Batches...");
  for (let r = 0; r < 8; r++) {
    const [batchPda] = getBatchPda(r);
    const existing = await connection.getAccountInfo(batchPda);
    if (!existing) {
      console.log(`  Initializing Batch Ring Slot ${r}...`);
      await program.methods
        .initializeBatch(r, new anchor.BN(r))
        .accounts({
          batch: batchPda,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log(`  ✓ Ring Slot ${r} initialized: ${batchPda.toBase58()}`);
    } else {
      console.log(`  ✓ Ring Slot ${r} already exists.`);
    }
  }

  // 2. Initialize Market
  console.log("\n[2/3] Initializing Market...");
  const marketInfo = await connection.getAccountInfo(marketPda);
  if (!marketInfo) {
    const defaultMarketArgs = {
      baseLot: new anchor.BN(1000),
      priceTick: new anchor.BN(1000),
      minOrderLots: new anchor.BN(10),
      minOrderNotional: new anchor.BN(1_000_000), // $1.00
      fundingPeriodSlots: 28800, // 8h
      batchSlots: 2,
      lookahead: 3,
      kTicks: 101,
      tickBps: 1,
      imrBps: 1000,
      mmrBps: 500,
      feeBps: 5,
      liqPenaltyBps: 100,
      maxOracleAgeSecs: 10,
      maxConfBps: 20,
      maxClearDelaySlots: 20,
      maxOrdersPerBatch: 128,
      fundingCapBps: 50,
    };
    const dummyOracleFeedId = new Array(32).fill(7);

    await program.methods
      .initializeMarket(defaultMarketArgs, dummyOracleFeedId)
      .accounts({
        market: marketPda,
        mintAuthority: mintAuthorityPda,
        quoteMint: quoteMintPda,
        collateralVault: collateralVaultPda,
        admin: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    console.log(`  ✓ Market initialized successfully.`);
  } else {
    console.log(`  ✓ Market already initialized.`);
  }

  // 3. Initialize Backstop Vault User
  console.log("\n[3/3] Initializing Backstop Vault User Account...");
  const vaultUserInfo = await connection.getAccountInfo(vaultUserPda);
  if (!vaultUserInfo) {
    await program.methods
      .initializeVaultUser()
      .accounts({
        vaultUser: vaultUserPda,
        vaultAuthority: vaultAuthorityPda,
        admin: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  ✓ Backstop Vault User Account initialized.`);
  } else {
    console.log(`  ✓ Backstop Vault User Account already exists.`);
  }

  console.log("\n=== Epoch Protocol is fully initialized and ready! ===");
}

main().catch((err) => {
  console.error("\nInitialization error:", err);
  process.exit(1);
});
