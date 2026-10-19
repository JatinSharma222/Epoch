import { PublicKey } from "@solana/web3.js";
import epochConfig from "./epoch.config.json";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ||
  process.env.EPOCH_PROGRAM_ID ||
  epochConfig.programId
);

export const KEEPER_PUBKEY = new PublicKey(
  process.env.NEXT_PUBLIC_KEEPER_ADDRESS ||
  process.env.EPOCH_KEEPER_ADDRESS ||
  epochConfig.keeper
);

export const UPGRADE_AUTHORITY = new PublicKey(
  process.env.NEXT_PUBLIC_UPGRADE_AUTHORITY ||
  process.env.EPOCH_UPGRADE_AUTHORITY ||
  epochConfig.upgradeAuthority
);

export const PYTH_FEED_ID =
  process.env.NEXT_PUBLIC_PYTH_FEED_ID ||
  process.env.EPOCH_PYTH_FEED_ID ||
  epochConfig.pythFeed;

export const PYTH_RECEIVER_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PYTH_RECEIVER ||
  process.env.EPOCH_PYTH_RECEIVER ||
  epochConfig.pythReceiver
);

export const K_TICKS = 101;
export const CENTER_TICK = 50;
export const RING_SIZE = 8;
export const PRICE_TICK = 1000;
export const F_SCALE = 1_000_000_000;

export function getMarketPda(): [PublicKey, number] {
  if (process.env.NEXT_PUBLIC_MARKET_ADDRESS || process.env.EPOCH_MARKET_ADDRESS) {
    return [new PublicKey((process.env.NEXT_PUBLIC_MARKET_ADDRESS || process.env.EPOCH_MARKET_ADDRESS)!), 255];
  }
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
  if (process.env.NEXT_PUBLIC_VAULT_AUTHORITY_ADDRESS || process.env.EPOCH_VAULT_AUTHORITY_ADDRESS) {
    return [new PublicKey((process.env.NEXT_PUBLIC_VAULT_AUTHORITY_ADDRESS || process.env.EPOCH_VAULT_AUTHORITY_ADDRESS)!), 255];
  }
  return PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID);
}

export function getVaultUserPda(): [PublicKey, number] {
  if (process.env.NEXT_PUBLIC_VAULT_USER_ADDRESS || process.env.EPOCH_VAULT_USER_ADDRESS) {
    return [new PublicKey((process.env.NEXT_PUBLIC_VAULT_USER_ADDRESS || process.env.EPOCH_VAULT_USER_ADDRESS)!), 255];
  }
  const [vaultAuth] = getVaultAuthorityPda();
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user"), vaultAuth.toBuffer()],
    PROGRAM_ID
  );
}

export function getQuoteMintPda(): [PublicKey, number] {
  if (process.env.NEXT_PUBLIC_MINT_ADDRESS || process.env.EPOCH_MINT_ADDRESS) {
    return [new PublicKey((process.env.NEXT_PUBLIC_MINT_ADDRESS || process.env.EPOCH_MINT_ADDRESS)!), 255];
  }
  return PublicKey.findProgramAddressSync([Buffer.from("quote_mint")], PROGRAM_ID);
}

export function getCollateralVaultPda(): [PublicKey, number] {
  if (process.env.NEXT_PUBLIC_VAULT_ADDRESS || process.env.EPOCH_VAULT_ADDRESS) {
    return [new PublicKey((process.env.NEXT_PUBLIC_VAULT_ADDRESS || process.env.EPOCH_VAULT_ADDRESS)!), 255];
  }
  return PublicKey.findProgramAddressSync(
    [Buffer.from("collateral_vault")],
    PROGRAM_ID
  );
}
