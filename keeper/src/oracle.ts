import { Connection, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { OraclePriceData } from "./types";

export class PythOracleService {
  private connection: Connection;
  private feedId: string;
  private priceFeedAccount: PublicKey | null = null;

  constructor(
    connection: Connection,
    feedId: string = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"
  ) {
    this.connection = connection;
    this.feedId = feedId;
  }

  /**
   * Lazily resolves Pyth price feed account address using Pyth Solana receiver SDK.
   */
  public async getPriceFeedAccount(): Promise<PublicKey | null> {
    if (this.priceFeedAccount) return this.priceFeedAccount;
    try {
      const { PythSolanaReceiver } = await import(
        "@pythnetwork/pyth-solana-receiver"
      );
      const receiver = new PythSolanaReceiver({
        connection: this.connection,
        wallet: {} as any,
      });
      this.priceFeedAccount = receiver.getPriceFeedAccountAddress(
        0,
        this.feedId
      );
      return this.priceFeedAccount;
    } catch {
      return null;
    }
  }

  /**
   * Fetches latest price from Pyth on-chain receiver.
   * If not available (e.g. localnet or unposted feed), falls back to defaultPrice.
   */
  public async getLatestPrice(
    defaultPrice: number = 150_000_000
  ): Promise<OraclePriceData> {
    const currentSlot = await this.connection.getSlot();
    try {
      const { PythSolanaReceiver } = await import(
        "@pythnetwork/pyth-solana-receiver"
      );
      const receiver = new PythSolanaReceiver({
        connection: this.connection,
        wallet: {} as any,
      });
      const priceFeedAccount = receiver.getPriceFeedAccountAddress(
        0,
        this.feedId
      );
      const accInfo = await this.connection.getAccountInfo(priceFeedAccount);
      if (accInfo && accInfo.data.length > 0) {
        const priceUpdate = await receiver.fetchPriceUpdateAccount(
          priceFeedAccount
        );
        const rawPrice = Number(priceUpdate.priceMessage.price);
        const exponent = priceUpdate.priceMessage.exponent;
        const rawConf = Number(priceUpdate.priceMessage.conf);
        const postedSlot = Number(priceUpdate.postedSlot);
        const publishTime = Number(priceUpdate.priceMessage.publishTime);

        // Convert rawPrice (with exponent, typically -8) to micro-USDC (6 decimals)
        const scaleFactor = Math.pow(10, exponent + 6);
        const microUsdcPrice = Math.round(rawPrice * scaleFactor);
        const microUsdcConf = Math.round(rawConf * scaleFactor);

        return {
          price: new anchor.BN(microUsdcPrice),
          conf: new anchor.BN(microUsdcConf),
          postedSlot: new anchor.BN(postedSlot),
          publishTime: new anchor.BN(publishTime),
          isFallback: false,
        };
      }
    } catch {
      // Fallback below
    }

    // Fallback: Use default price, 0 conf, current slot, current timestamp
    return {
      price: new anchor.BN(defaultPrice),
      conf: new anchor.BN(0),
      postedSlot: new anchor.BN(currentSlot),
      publishTime: new anchor.BN(Math.floor(Date.now() / 1000)),
      isFallback: true,
    };
  }
}
