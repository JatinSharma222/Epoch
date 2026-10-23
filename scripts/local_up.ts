#!/usr/bin/env bun
/**
 * Epoch Local Environment Lifecycle Script (`bun run local:up`)
 *
 * One-command complete local environment orchestration:
 * 1. Spawns `solana-test-validator` with fresh ledger.
 * 2. Profiles local slot duration dynamically over real slot transitions.
 * 3. Builds SBF program with `authority-oracle` feature flag.
 * 4. Deploys program to localnet with v1 program ID.
 * 5. Funds authority and keeper keypairs.
 * 6. Initializes Market, 8 Ring Batches, and Vault User Account using dynamic slot parameters.
 * 7. Funds Backstop Vault with 10,000 USDC collateral.
 * 8. Launches Multi-Venue Aggregator Keeper in Authority Oracle mode.
 * 9. Launches Next.js frontend on localhost:3000.
 */

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { spawn, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import epochIdl from "../app/src/lib/epoch_idl.json";
import { measureLocalSlotTime } from "./measure_local_slot_time";

const PID_FILE = path.resolve(__dirname, "../.local_pids.json");
const LOG_DIR = path.resolve(__dirname, "../logs");

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function runSync(cmd: string, desc: string) {
  console.log(`[local:up] ${desc}...`);
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch (err: any) {
    console.error(`[local:up] Failed: ${cmd}`);
    throw err;
  }
}

async function waitForRpc(rpcUrl: string, timeoutMs: number = 30_000): Promise<Connection> {
  const connection = new Connection(rpcUrl, "confirmed");
  const start = Date.now();
  console.log(`[local:up] Waiting for local validator at ${rpcUrl}...`);
  while (Date.now() - start < timeoutMs) {
    try {
      const slot = await connection.getSlot("confirmed");
      if (slot > 0) {
        console.log(`[local:up] Validator online! Current slot: ${slot}`);
        return connection;
      }
    } catch {}
    await sleep(500);
  }
  throw new Error(`Timeout waiting for validator at ${rpcUrl}`);
}

async function main() {
  console.log("===============================================================================");
  console.log("             EPOCH PROTOCOL LOCAL ENVIRONMENT ORCHESTRATION                    ");
  console.log("                   (Authority Oracle Mode Local Build)                         ");
  console.log("===============================================================================");

  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  // 1. Clean up any existing instances first
  try {
    execSync("bun run scripts/local_down.ts", { stdio: "ignore" });
  } catch {}
  await sleep(1000);

  // 2. Ensure Keypairs exist (Auto-provision on fresh machines or empty HOME)
  console.log("[local:up] Checking / provisioning keypairs...");
  const keysDir = path.resolve(process.env.HOME || "", ".config/solana/epoch-v1-keys");
  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true });
  }

  function getOrCreateKey(filePath: string, desc: string): Keypair {
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    if (!fs.existsSync(filePath)) {
      const kp = Keypair.generate();
      fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)));
      console.log(`[local:up] Auto-generated fresh ${desc} keypair at ${filePath} (${kp.publicKey.toBase58()})`);
      return kp;
    }
    const secret = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  }

  const genesisPayerPath = path.resolve(process.env.HOME || "", ".config/solana/id.json");
  const genesisPayer = getOrCreateKey(genesisPayerPath, "Genesis Payer");

  const authKeyPath = path.resolve(keysDir, "epoch-authority-keypair.json");
  const authorityKeypair = getOrCreateKey(authKeyPath, "Authority");

  const keeperKeyPath = path.resolve(keysDir, "epoch-keeper-keypair.json");
  const keeperKeypair = getOrCreateKey(keeperKeyPath, "Keeper");

  const oracleAuthKeyPath = path.resolve(keysDir, "epoch-oracle-authority-keypair.json");
  const oracleAuthorityKeypair = getOrCreateKey(oracleAuthKeyPath, "Oracle Authority");

  // Program Keypair resolution:
  // 1. Check process.env.EPOCH_PROGRAM_KEYPAIR_PATH
  // 2. Check keysDir/epoch-program-keypair.json
  // 3. Check git-ignored workspace keys/epoch-program-keypair.json
  // Tracked files (Anchor.toml, declare_id!, IDLs) remain untouched.
  const repoProgramKeyPath = path.resolve(__dirname, "../keys/epoch-program-keypair.json");
  const programKeyPath = process.env.EPOCH_PROGRAM_KEYPAIR_PATH || path.resolve(keysDir, "epoch-program-keypair.json");

  let programKeypair: Keypair;
  if (fs.existsSync(programKeyPath)) {
    const secret = JSON.parse(fs.readFileSync(programKeyPath, "utf-8"));
    programKeypair = Keypair.fromSecretKey(Uint8Array.from(secret));
  } else if (fs.existsSync(repoProgramKeyPath)) {
    const secret = JSON.parse(fs.readFileSync(repoProgramKeyPath, "utf-8"));
    programKeypair = Keypair.fromSecretKey(Uint8Array.from(secret));
    fs.writeFileSync(programKeyPath, JSON.stringify(secret));
    console.log(`[local:up] Sourced canonical program keypair from keys/ (${programKeypair.publicKey.toBase58()})`);
  } else {
    programKeypair = getOrCreateKey(programKeyPath, "Program");
  }

  const programIdStr = programKeypair.publicKey.toBase58();
  console.log(`[local:up] Using Program ID: ${programIdStr} (Tracked files untouched)`);

  // 3. Spawn solana-test-validator in background
  console.log("[local:up] Spawning solana-test-validator in background...");
  const validatorLog = fs.openSync(path.join(LOG_DIR, "validator.log"), "w");
  const validatorProc = spawn("solana-test-validator", ["--reset", "--quiet"], {
    detached: true,
    stdio: ["ignore", validatorLog, validatorLog],
  });
  validatorProc.unref();
  const validatorPid = validatorProc.pid!;
  console.log(`[local:up] solana-test-validator spawned (PID: ${validatorPid})`);

  // 4. Wait for RPC health
  const connection = await waitForRpc("http://127.0.0.1:8899");

  // 5. Dynamically profile local slot duration
  console.log("\n>>> Step 1: Profiling dynamic local slot time...");
  const slotParams = await measureLocalSlotTime(connection, 15);

  // 6. Build SBF program with authority-oracle feature
  console.log("\n>>> Step 2: Compiling SBF program with authority-oracle feature...");
  runSync(
    "cargo build-sbf --manifest-path programs/epoch/Cargo.toml --features authority-oracle",
    "Building epoch.so (authority-oracle)"
  );

  // Ensure genesis payer has sufficient SOL for deployment and funding
  const genBal = await connection.getBalance(genesisPayer.publicKey);
  if (genBal < 200 * LAMPORTS_PER_SOL) {
    console.log(`[local:up] Requesting airdrop of 500 SOL to Genesis Payer (${genesisPayer.publicKey.toBase58()})...`);
    const sig = await connection.requestAirdrop(genesisPayer.publicKey, 500 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }

  // 7. Deploy program to localnet
  console.log("\n>>> Step 3: Deploying epoch.so to localnet...");
  runSync(
    `solana program deploy --keypair ${genesisPayerPath} --program-id ${programKeyPath} target/deploy/epoch.so --url http://127.0.0.1:8899`,
    "Deploying program"
  );

  // 8. Load local genesis payer and fund authority and keeper
  console.log("\n>>> Step 4: Funding authority and keeper keypairs...");
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: genesisPayer.publicKey,
      toPubkey: authorityKeypair.publicKey,
      lamports: 50 * LAMPORTS_PER_SOL,
    }),
    SystemProgram.transfer({
      fromPubkey: genesisPayer.publicKey,
      toPubkey: keeperKeypair.publicKey,
      lamports: 50 * LAMPORTS_PER_SOL,
    }),
    SystemProgram.transfer({
      fromPubkey: genesisPayer.publicKey,
      toPubkey: oracleAuthorityKeypair.publicKey,
      lamports: 50 * LAMPORTS_PER_SOL,
    })
  );
  await sendAndConfirmTransaction(connection, fundTx, [genesisPayer], { commitment: "confirmed" });
  console.log(`  ✓ Funded Authority        (${authorityKeypair.publicKey.toBase58()}): 50 SOL`);
  console.log(`  ✓ Funded Keeper           (${keeperKeypair.publicKey.toBase58()}): 50 SOL`);
  console.log(`  ✓ Funded Oracle Authority (${oracleAuthorityKeypair.publicKey.toBase58()}): 50 SOL`);

  // 8. Initialize Market with dynamic parameters
  console.log("\n>>> Step 5: Initializing Market, Ring Batches, and Vault User...");
  const authWallet = new anchor.Wallet(authorityKeypair);
  const provider = new anchor.AnchorProvider(connection, authWallet, { commitment: "confirmed" });
  const freshIdl = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../app/src/lib/epoch_idl.json"), "utf-8"));
  freshIdl.address = programKeypair.publicKey.toBase58();
  const program = new anchor.Program(freshIdl as any, provider);

  const [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], program.programId);
  const [quoteMintPda] = PublicKey.findProgramAddressSync([Buffer.from("quote_mint")], program.programId);
  const [collateralVaultPda] = PublicKey.findProgramAddressSync([Buffer.from("collateral_vault")], program.programId);
  const [vaultAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("vault")], program.programId);
  const [vaultUserPda] = PublicKey.findProgramAddressSync([Buffer.from("user"), vaultAuthorityPda.toBuffer()], program.programId);
  const [mintAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_authority")], program.programId);

  const marketArgs = {
    baseLot: new anchor.BN(1000),
    priceTick: new anchor.BN(1000),
    minOrderLots: new anchor.BN(10),
    minOrderNotional: new anchor.BN(1_000_000), // $1.00 min order
    fundingPeriodSlots: slotParams.fundingPeriodSlots,
    batchSlots: slotParams.batchSlots,
    lookahead: 3,
    kTicks: 101,
    tickBps: 1,
    imrBps: 1000, // 10%
    mmrBps: 500,  // 5%
    feeBps: 5,    // 5 bps
    liqPenaltyBps: 100, // 1%
    maxOracleAgeSecs: slotParams.maxOracleAgeSecs,
    maxConfBps: 20,
    maxClearDelaySlots: slotParams.clearWindowSlots,
    maxOrdersPerBatch: 128,
    fundingCapBps: 50,
  };

  const dummyOracleFeed = new Array(32).fill(0);
  await program.methods
    .initializeMarket(marketArgs, dummyOracleFeed, oracleAuthorityKeypair.publicKey)
    .accounts({
      market: marketPda,
      mintAuthority: mintAuthorityPda,
      quoteMint: quoteMintPda,
      collateralVault: collateralVaultPda,
      admin: authorityKeypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();
  console.log(`  ✓ Market PDA initialized: ${marketPda.toBase58()}`);
  console.log(`  ✓ Dedicated Oracle Authority set: ${oracleAuthorityKeypair.publicKey.toBase58()}`);

  for (let r = 0; r < 8; r++) {
    const [batchPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("batch"), Buffer.from([r])],
      program.programId
    );
    await program.methods
      .initializeBatch(r, new anchor.BN(r))
      .accounts({
        market: marketPda,
        batch: batchPda,
        admin: authorityKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }
  console.log(`  ✓ Initialized 8 Ring Batches.`);

  await program.methods
    .initializeVaultUser()
    .accounts({
      market: marketPda,
      vaultAuthority: vaultAuthorityPda,
      vaultUser: vaultUserPda,
      payer: authorityKeypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`  ✓ Initialized Backstop Vault User: ${vaultUserPda.toBase58()}`);

  // Configure Backstop Vault Depth: 3.5 SOL (3,500 lots across rungs [1000, 1000, 1500])
  await program.methods
    .updateVaultParams({
      quoteOffsetBps: [12, 18, 25],
      quoteLots: [new anchor.BN(1000), new anchor.BN(1000), new anchor.BN(1500)],
      maxInventoryLots: new anchor.BN(15000),
      skewBps: 5,
      maxConfBps: 20,
      isActive: 1,
    })
    .accounts({
      market: marketPda,
      admin: authorityKeypair.publicKey,
    })
    .rpc();
  console.log(`  ✓ Configured Backstop Vault Depth: 3.5 SOL (3,500 lots across [1000, 1000, 1500] rungs)`);

  // 9. Fund Backstop Vault Collateral ($10,000 USDC)
  console.log("\n>>> Step 6: Funding Backstop Vault with $10,000 USDC Collateral...");
  const authAta = getAssociatedTokenAddressSync(quoteMintPda, authorityKeypair.publicKey);
  const ataTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      authorityKeypair.publicKey,
      authAta,
      authorityKeypair.publicKey,
      quoteMintPda
    )
  );
  await provider.sendAndConfirm(ataTx);

  const [faucetRecordPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("faucet"), authorityKeypair.publicKey.toBuffer()],
    program.programId
  );
  const fundAmount = new anchor.BN(10_000_000_000); // 10,000 USDC
  await program.methods
    .faucet(fundAmount)
    .accounts({
      quoteMint: quoteMintPda,
      mintAuthority: mintAuthorityPda,
      recipientTokenAccount: authAta,
      faucetRecord: faucetRecordPda,
      recipient: authorityKeypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .fundVault(fundAmount)
    .accounts({
      market: marketPda,
      vaultAuthority: vaultAuthorityPda,
      vaultUser: vaultUserPda,
      funderTokenAccount: authAta,
      collateralVault: collateralVaultPda,
      funder: authorityKeypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log(`  ✓ Backstop Vault funded with 10,000 USDC!`);

  // 10. Launch Multi-Venue Aggregator Keeper in Authority Mode
  console.log("\n>>> Step 7: Launching Multi-Venue Aggregator Keeper...");
  const keeperLog = fs.openSync(path.join(LOG_DIR, "keeper.log"), "w");
  const keeperEnv = {
    ...process.env,
    EPOCH_RPC_URL: "http://127.0.0.1:8899",
    EPOCH_ORACLE_MODE: "authority",
    EPOCH_PROGRAM_ID: programIdStr,
    EPOCH_KEEPER_KEYPAIR_PATH: oracleAuthKeyPath,
  };
  const keeperProc = spawn("bun", ["run", "keeper/src/index.ts", "--authority", "--local"], {
    detached: true,
    env: keeperEnv,
    stdio: ["ignore", keeperLog, keeperLog],
  });
  keeperProc.unref();
  const keeperPid = keeperProc.pid!;
  console.log(`  ✓ Aggregator Keeper running (PID: ${keeperPid}) [LOGS: logs/keeper.log]`);

  // 11. Launch Frontend App
  console.log("\n>>> Step 8: Launching Next.js UI on http://localhost:3000...");
  const appLog = fs.openSync(path.join(LOG_DIR, "app.log"), "w");
  const appEnv = {
    ...process.env,
    PORT: "3000",
    NEXT_PUBLIC_RPC_URL: "http://127.0.0.1:8899",
    NEXT_PUBLIC_ORACLE_MODE: "authority",
  };
  const appProc = spawn("bun", ["run", "dev"], {
    cwd: path.resolve(__dirname, "../app"),
    detached: true,
    env: appEnv,
    stdio: ["ignore", appLog, appLog],
  });
  appProc.unref();
  const appPid = appProc.pid!;
  console.log(`  ✓ Next.js Frontend running (PID: ${appPid}) [LOGS: logs/app.log]`);

  // 12. Save tracked PIDs
  const pidData = {
    validatorPid,
    keeperPid,
    appPid,
    startedAt: new Date().toISOString(),
    slotTimeMs: slotParams.measuredSlotTimeMs,
    batchSlots: slotParams.batchSlots,
    clearWindowSlots: slotParams.clearWindowSlots,
  };
  fs.writeFileSync(PID_FILE, JSON.stringify(pidData, null, 2));

  console.log("\n===============================================================================");
  console.log("            EPOCH LOCAL ENVIRONMENT IS READY AND ACTIVE!                       ");
  console.log("===============================================================================");
  console.log(`RPC Endpoint:        http://127.0.0.1:8899`);
  console.log(`Frontend UI:         http://localhost:3000`);
  console.log(`Measured Slot Time:  ${slotParams.measuredSlotTimeMs} ms/slot [MEASURED]`);
  console.log(`Batch Slots:         ${slotParams.batchSlots} slots (~${Math.round(slotParams.batchSlots * slotParams.measuredSlotTimeMs)} ms)`);
  console.log(`Clear Window:        ${slotParams.clearWindowSlots} slots (~${Math.round(slotParams.clearWindowSlots * slotParams.measuredSlotTimeMs)} ms)`);
  console.log(`Oracle Mode:         Trusted Multi-Venue Median (Coinbase, Kraken, Bybit, Backpack, Hyperliquid, Binance)`);
  console.log(`Market PDA:          ${marketPda.toBase58()}`);
  console.log(`Collateral Vault:    ${collateralVaultPda.toBase58()}`);
  console.log("===============================================================================");
  console.log("To stop the environment cleanly, run: bun run local:down\n");
}

main().catch((err) => {
  console.error("\n[local:up] Fatal orchestration error:", err);
  process.exit(1);
});
