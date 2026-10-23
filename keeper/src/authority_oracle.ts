import { Connection, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { OraclePriceData } from "./types";
import { MultiVenueAggregator } from "./aggregator";
import { AggregatePrice, VenueHealth } from "./aggregator/types";

export class AuthorityOracleService {
  private connection: Connection;
  private marketPda: PublicKey;
  private programId: PublicKey;
  private authorityPricePda: PublicKey;
  private aggregator: MultiVenueAggregator;
  private program: anchor.Program;
  private lastPostedSlot: number = 0;

  constructor(
    connection: Connection,
    marketPda: PublicKey,
    program: anchor.Program,
    customAggregator?: MultiVenueAggregator
  ) {
    this.connection = connection;
    this.marketPda = marketPda;
    this.program = program;
    this.programId = program.programId;

    const [authorityPricePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle"), this.marketPda.toBuffer()],
      this.programId
    );
    this.authorityPricePda = authorityPricePda;

    this.aggregator = customAggregator || new MultiVenueAggregator();
  }

  public getAggregator(): MultiVenueAggregator {
    return this.aggregator;
  }

  public async getPriceFeedAccount(): Promise<PublicKey> {
    return this.authorityPricePda;
  }

  public getConfigSummary(): { endpoint: string; hasKey: boolean; streaming: boolean } {
    return {
      endpoint: "Multi-Venue Aggregator (Coinbase, Kraken, Bybit, Backpack, Hyperliquid, Binance)",
      hasKey: false,
      streaming: true,
    };
  }

  public startPriceStream(): void {
    this.aggregator.start();
  }

  public stopPriceStream(): void {
    this.aggregator.stop();
  }

  public getVenueHealth(): VenueHealth[] {
    return this.aggregator.getVenueHealth();
  }

  public getLatestAggregate(): AggregatePrice | null {
    return this.aggregator.getAggregate();
  }

  /**
   * Generates post_price instruction if fresh aggregate price meets quorum (>= 3 venues).
   */
  public async postPriceUpdateInstructions(
    wallet: anchor.Wallet
  ): Promise<anchor.web3.TransactionInstruction[]> {
    try {
      const agg = this.aggregator.getAggregate();
      if (!agg) {
        return [];
      }

      // Check on-chain account to avoid posting twice in the same slot
      const currentSlot = await this.connection.getSlot();
      const oracleAccInfo = await this.connection.getAccountInfo(this.authorityPricePda);
      let lastPublishSlot = 0;
      let lastPublishTime = 0;
      if (oracleAccInfo && oracleAccInfo.data.length >= 72) {
        lastPublishSlot = Number(oracleAccInfo.data.readBigUInt64LE(64));
        lastPublishTime = Number(oracleAccInfo.data.readBigInt64LE(56));
        if (currentSlot <= lastPublishSlot) {
          return [];
        }
      }

      // Synchronize publish_time with on-chain clock (blockTime) to prevent local validator drift
      let publishTimeSec = Math.floor(agg.timestampMs / 1000) - 1;
      try {
        const blockTime = await this.connection.getBlockTime(currentSlot);
        if (blockTime !== null) {
          publishTimeSec = blockTime;
        }
      } catch {}
      if (publishTimeSec < lastPublishTime) {
        publishTimeSec = lastPublishTime;
      }

      const priceBn = new anchor.BN(agg.priceMicroUsdc);
      // Guarantee confidence is strictly positive (> 0)
      const confBn = new anchor.BN(Math.max(agg.confMicroUsdc, 1000));
      const publishTimeBn = new anchor.BN(publishTimeSec);

      const ix = await this.program.methods
        .postPrice(priceBn, confBn, publishTimeBn)
        .accounts({
          market: this.marketPda,
          priceUpdate: this.authorityPricePda,
          authority: wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .instruction();

      this.lastPostedSlot = currentSlot;
      return [ix];
    } catch (err) {
      return [];
    }
  }

  public async postPrice(wallet: anchor.Wallet): Promise<string | null> {
    const ixs = await this.postPriceUpdateInstructions(wallet);
    if (ixs.length === 0) return null;
    const tx = new anchor.web3.Transaction().add(...ixs);
    return await anchor.web3.sendAndConfirmTransaction(
      this.connection,
      tx,
      [wallet.payer],
      { commitment: "confirmed" }
    );
  }

  /**
   * Fetches latest price data for valuation and liquidation.
   */
  public async getLatestPrice(
    defaultPrice: number = 150_000_000
  ): Promise<OraclePriceData> {
    const currentSlot = await this.connection.getSlot();
    const agg = this.aggregator.getAggregate();

    if (agg) {
      return {
        price: new anchor.BN(agg.priceMicroUsdc),
        conf: new anchor.BN(Math.max(agg.confMicroUsdc, 1000)),
        postedSlot: new anchor.BN(currentSlot),
        publishTime: new anchor.BN(Math.floor(agg.timestampMs / 1000)),
        isFallback: false,
      };
    }

    return {
      price: new anchor.BN(defaultPrice),
      conf: new anchor.BN(1000),
      postedSlot: new anchor.BN(currentSlot),
      publishTime: new anchor.BN(Math.floor(Date.now() / 1000)),
      isFallback: true,
    };
  }
}
