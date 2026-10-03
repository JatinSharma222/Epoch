import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || "CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap"
);

export const K_TICKS = 101;
export const CENTER_TICK = 50;
export const RING_SIZE = 8;
export const PRICE_TICK = 1000;
export const F_SCALE = 1_000_000_000;

export function getMarketPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("market")], PROGRAM_ID);
}

export function getBatchPda(ringIndex: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("batch"), Buffer.from([ringIndex])],
    PROGRAM_ID
  );
}

export function getUserPda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user"), owner.toBuffer()],
    PROGRAM_ID
  );
}

export function getVaultAuthorityPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID);
}

export function getVaultUserPda(): [PublicKey, number] {
  const [vaultAuth] = getVaultAuthorityPda();
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user"), vaultAuth.toBuffer()],
    PROGRAM_ID
  );
}

export function getQuoteMintPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("quote_mint")], PROGRAM_ID);
}

export function getCollateralVaultPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("collateral_vault")],
    PROGRAM_ID
  );
}
