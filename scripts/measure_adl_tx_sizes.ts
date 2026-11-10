import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

interface AdlTxSizeMeasurement {
  counterparties_k: number;
  format: "Legacy (without ALTs)";
  signature_count: number;
  unique_account_count: number;
  wire_bytes: number;
  mtu_limit_bytes: number;
  fits_mtu: boolean;
  serialized_status: "SUCCESS" | "EXCEEDS_MTU_REJECTED";
  serialization_error?: string | null;
  breakdown: {
    signatures_bytes: number;
    message_header_bytes: number;
    account_keys_bytes: number;
    recent_blockhash_bytes: number;
    instructions_bytes: number;
  };
}

export function measureAdlTxSize(k: number): AdlTxSizeMeasurement {
  const liquidator = Keypair.generate();
  const programId = new PublicKey("ER8SSfvp7roW6asG429Uv3mHY1aEd1jxGBdigLu27284");

  const fixedAccounts = {
    market: Keypair.generate().publicKey,
    vaultAuthority: Keypair.generate().publicKey,
    vaultUser: Keypair.generate().publicKey,
    user: Keypair.generate().publicKey,
    liquidatee: Keypair.generate().publicKey,
    priceUpdate: Keypair.generate().publicKey,
  };

  const tx = new Transaction();
  tx.add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })
  );

  const counterparties = Array.from({ length: k }, () => ({
    pubkey: Keypair.generate().publicKey,
    isWritable: true,
    isSigner: false,
  }));

  // Anchor Discriminator for liquidate: [223, 179, 226, 125, 48, 46, 39, 74]
  tx.add(
    new TransactionInstruction({
      programId,
      data: Buffer.from([223, 179, 226, 125, 48, 46, 39, 74]),
      keys: [
        { pubkey: fixedAccounts.market, isWritable: true, isSigner: false },
        { pubkey: fixedAccounts.vaultAuthority, isWritable: false, isSigner: false },
        { pubkey: fixedAccounts.vaultUser, isWritable: true, isSigner: false },
        { pubkey: fixedAccounts.user, isWritable: true, isSigner: false },
        { pubkey: fixedAccounts.liquidatee, isWritable: false, isSigner: false },
        { pubkey: fixedAccounts.priceUpdate, isWritable: false, isSigner: false },
        { pubkey: liquidator.publicKey, isWritable: false, isSigner: true },
        ...counterparties,
      ],
    })
  );

  tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
  tx.feePayer = liquidator.publicKey;
  tx.sign(liquidator);

  const serializedMsg = tx.serializeMessage();
  const signatureCount = tx.signatures.length;
  const wireBytes = 1 + 64 * signatureCount + serializedMsg.length;

  let serializedStatus: "SUCCESS" | "EXCEEDS_MTU_REJECTED" = "SUCCESS";
  let serializationError: string | null = null;

  try {
    const raw = tx.serialize();
    if (raw.length > 1232) {
      serializedStatus = "EXCEEDS_MTU_REJECTED";
      serializationError = `Transaction too large: ${raw.length} > 1232`;
    }
  } catch (err: any) {
    serializedStatus = "EXCEEDS_MTU_REJECTED";
    serializationError = err.message || String(err);
  }

  const uniqueAccountCount = 9 + k;

  return {
    counterparties_k: k,
    format: "Legacy (without ALTs)",
    signature_count: signatureCount,
    unique_account_count: uniqueAccountCount,
    wire_bytes: wireBytes,
    mtu_limit_bytes: 1232,
    fits_mtu: wireBytes <= 1232,
    serialized_status: serializedStatus,
    serialization_error: serializationError,
    breakdown: {
      signatures_bytes: 1 + 64 * signatureCount,
      message_header_bytes: 3,
      account_keys_bytes: 1 + 32 * uniqueAccountCount,
      recent_blockhash_bytes: 32,
      instructions_bytes: serializedMsg.length - (3 + 1 + 32 * uniqueAccountCount + 32),
    },
  };
}

async function main() {
  const kValues = [0, 10, 16, 20, 23, 24, 32];
  const measurements = kValues.map(measureAdlTxSize);

  const report = {
    title: "ADL Multi-Counterparty Transaction Size & MTU Analysis",
    timestamp: new Date().toISOString(),
    mtu_limit_bytes: 1232,
    chunk_limit_k: 16,
    hard_limit_k: 24,
    measurements,
    summary: {
      formula: "wire_bytes = 428 + 33 * K",
      safe_chunk_size: 16,
      safe_chunk_bytes: measurements.find((m) => m.counterparties_k === 16)?.wire_bytes,
      hard_limit_max_k: 24,
      hard_limit_max_bytes: measurements.find((m) => m.counterparties_k === 24)?.wire_bytes,
      k_32_wire_bytes: measurements.find((m) => m.counterparties_k === 32)?.wire_bytes,
      verdict: "K=16 chunking safely guarantees transaction size (956 bytes) well below the 1232 MTU boundary.",
    },
  };

  const outputPath = path.resolve(__dirname, "../evidence/adl_tx_sizes.json");
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`[measure_adl_tx_sizes] Output written to ${outputPath}`);
  console.table(
    measurements.map((m) => ({
      K: m.counterparties_k,
      Accounts: m.unique_account_count,
      WireBytes: m.wire_bytes,
      FitsMTU: m.fits_mtu,
      Status: m.serialized_status,
    }))
  );
}

if (import.meta.main || require.main === module) {
  main().catch(console.error);
}
