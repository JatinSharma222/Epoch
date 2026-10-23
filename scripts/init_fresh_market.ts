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
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || process.env.EPOCH_RPC_URL || "https://api.devnet.solana.com";
  console.log(`\n=============================================================================`);
  console.log(`        INITIALIZING FRESH EPOCH V1 MARKET & RING SLOTS ON DEVNET            `);
  console.log(`=============================================================================`);
  console.log(`RPC Endpoint:   ${rpcUrl}`);
  console.log(`Program ID:     ${PROGRAM_ID.toBase58()}`);

  const connection = new Connection(rpcUrl, "confirmed");

  // Load authority keypair
  const keypairPath =
    process.env.ANCHOR_WALLET ||
    path.join(process.env.HOME || "", ".config/solana/epoch-v1-keys/epoch-authority-keypair.json");

  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Authority keypair not found at ${keypairPath}`);
  }

  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const authority = Keypair.fromSecretKey(Uint8Array.from(secret));
  console.log(`Authority:      ${authority.publicKey.toBase58()}`);

  const oracleKeyPath = path.join(
    process.env.HOME || "",
    ".config/solana/epoch-v1-keys/epoch-oracle-authority-keypair.json"
  );
  let oracleAuthorityPubkey = authority.publicKey;
  if (fs.existsSync(oracleKeyPath)) {
    const oSecret = JSON.parse(fs.readFileSync(oracleKeyPath, "utf-8"));
    const oKeypair = Keypair.fromSecretKey(Uint8Array.from(oSecret));
    oracleAuthorityPubkey = oKeypair.publicKey;
  }
  console.log(`Oracle Auth:    ${oracleAuthorityPubkey.toBase58()}`);

  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = new anchor.Program(epochIdl as any, provider);

  const [marketPda] = getMarketPda();
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

  // 1. Initialize Market
  console.log("\n>>> Step 1: Initializing Market PDA & Mint & Vault...");
  const marketInfo = await connection.getAccountInfo(marketPda);
  if (!marketInfo) {
    const marketArgs = {
      baseLot: new anchor.BN(1000),
      priceTick: new anchor.BN(1000),
      minOrderLots: new anchor.BN(10),
      minOrderNotional: new anchor.BN(1_000_000), // $1.00 min order
      fundingPeriodSlots: 72000, // 8h at ~400ms nominal
      batchSlots: 2,
      lookahead: 3,
      kTicks: 101,
      tickBps: 1,
      imrBps: 1000, // 10%
      mmrBps: 500,  // 5%
      feeBps: 5,    // 5 bps
      liqPenaltyBps: 100, // 1%
      maxOracleAgeSecs: 10,
      maxConfBps: 20,
      maxClearDelaySlots: 20,
      maxOrdersPerBatch: 128,
      fundingCapBps: 50,
    };

    // Pyth SOL/USD feed ID: 0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d
    const pythFeedId = Array.from(
      Buffer.from("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", "hex")
    );

    const initTx = await program.methods
      .initializeMarket(marketArgs, pythFeedId, oracleAuthorityPubkey)
      .accounts({
        market: marketPda,
        mintAuthority: mintAuthorityPda,
        quoteMint: quoteMintPda,
        collateralVault: collateralVaultPda,
        admin: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log(`  [PASS] Market initialized successfully! Tx: ${initTx}`);
  } else {
    console.log(`  [SKIP] Market PDA already initialized.`);
  }

  // 2. Initialize 8 Ring Batches
  console.log("\n>>> Step 2: Initializing 8 Ring Batch Accounts...");
  for (let i = 0; i < 8; i++) {
    const [batchPda] = getBatchPda(i);
    const batchInfo = await connection.getAccountInfo(batchPda);
    if (!batchInfo) {
      const tx = await program.methods
        .initializeBatch(i, new anchor.BN(i))
        .accounts({
          market: marketPda,
          batch: batchPda,
          admin: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log(`  [PASS] Ring Batch ${i} initialized. Tx: ${tx}`);
    } else {
      console.log(`  [SKIP] Ring Batch ${i} already initialized.`);
    }
  }

  // 3. Initialize Backstop Vault User Account
  console.log("\n>>> Step 3: Initializing Backstop Vault User Account...");
  const vaultUserInfo = await connection.getAccountInfo(vaultUserPda);
  if (!vaultUserInfo) {
    const tx = await program.methods
      .initializeVaultUser()
      .accounts({
        market: marketPda,
        vaultAuthority: vaultAuthorityPda,
        vaultUser: vaultUserPda,
        admin: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  [PASS] Vault User initialized. Tx: ${tx}`);
  } else {
    console.log(`  [SKIP] Vault User already initialized.`);
  }

  console.log(`\n=============================================================================`);
  console.log(`             EPOCH V1 PROTOCOL INITIALIZATION COMPLETE!                      `);
  console.log(`=============================================================================\n`);
}

main().catch((err) => {
  console.error("Initialization failed:", err);
  process.exit(1);
});
