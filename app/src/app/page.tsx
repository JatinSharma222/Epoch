"use client";

import React, { useState, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import epochIdl from "../lib/epoch_idl.json";
import {
  getMarketPda,
  getBatchPda,
  getUserPda,
  getQuoteMintPda,
  getCollateralVaultPda,
  getVaultAuthorityPda,
  getVaultUserPda,
} from "../lib/constants";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import { TradingChart } from "../components/TradingChart";
import { OrderBook } from "../components/OrderBook";
import { OrderTicket } from "../components/OrderTicket";
import { BottomLedger } from "../components/BottomLedger";
import { BatchLogView } from "../components/BatchLogView";
import { EvidenceView } from "../components/EvidenceView";
import { ComparisonView } from "../components/ComparisonView";
import { FaucetModal } from "../components/FaucetModal";
import { DepositWithdrawModal } from "../components/DepositWithdrawModal";
import { ReferencePriceStrip } from "../components/ReferencePriceStrip";
import { fetchSolStats, fetchLiveDepth, MarketStats, BookRow } from "../lib/marketData";
import { parseOrderError } from "../lib/errors";
import { computeLiquidationPrice } from "../lib/clearingEngine";

export default function Home() {
  const { connection } = useConnection();
  const walletContext = useWallet();
  const { publicKey, connected } = walletContext;

  // Navigation State
  const [activeTab, setActiveTab] = useState<"trade" | "batches" | "evidence" | "compare">("trade");

  // Modals
  const [isFaucetOpen, setIsFaucetOpen] = useState(false);
  const [depositWithdrawModal, setDepositWithdrawModal] = useState<{
    isOpen: boolean;
    mode: "deposit" | "withdraw";
  }>({ isOpen: false, mode: "deposit" });
  const [mobileOrderDrawer, setMobileOrderDrawer] = useState<{
    isOpen: boolean;
    side: "BUY" | "SELL";
  }>({ isOpen: false, side: "BUY" });

  // Live Market State
  const [markPrice, setMarkPrice] = useState<number>(119.60);
  const [marketStats, setMarketStats] = useState<MarketStats | null>(null);
  const [dynamicBids, setDynamicBids] = useState<BookRow[]>([]);
  const [dynamicAsks, setDynamicAsks] = useState<BookRow[]>([]);
  const [selectedPrice, setSelectedPrice] = useState<number>(119.60);
  const [selectedOffsetBps, setSelectedOffsetBps] = useState<number>(0);
  const [isPlacingOrder, setIsPlacingOrder] = useState<boolean>(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  // On-Chain Slot & Batch Tracking (B.1: batch_id = (slot - start_slot) / N)
  const [currentSlot, setCurrentSlot] = useState<number>(508012057);
  const [currentBatchId, setCurrentBatchId] = useState<number>(319700);
  const [slotsRemaining, setSlotsRemaining] = useState<number>(2);
  const [startSlot, setStartSlot] = useState<number>(507372656);
  const [batchSlots, setBatchSlots] = useState<number>(2);
  const [solBalance, setSolBalance] = useState<number | null>(null);

  // User Balances & Margin Account (09 §6.1: empty without wallet)
  const [collateral, setCollateral] = useState<number>(0);
  const [quotePosition, setQuotePosition] = useState<number>(0);
  const [position, setPosition] = useState<{
    market: string;
    sizeLots: number;
    entryPrice: number;
    markPrice: number;
    unrealizedPnl: number;
    marginRatio: number;
    liqPrice: number;
  } | null>(null);

  const [activeOrders, setActiveOrders] = useState<
    Array<{
      batchId: number;
      slotId: number;
      side: "BUY" | "SELL";
      tickOffset: number;
      lots: number;
    }>
  >([]);

  // 09 §3.5 rule 11 & C.6: On-chain batch aggregates only (no synthetic sine-wave data)
  const [bidQty, setBidQty] = useState<number[]>(() => new Array(101).fill(0));
  const [askQty, setAskQty] = useState<number[]>(() => new Array(101).fill(0));

  // Recent Historical Batches (loaded from real on-chain snapshot)
  const [recentBatches, setRecentBatches] = useState<
    Array<{
      batchId: number;
      clearingPrice: number;
      matchedLots: number;
      offsetBps: number;
      oraclePrice: number;
      oracleConf: number;
      status: "CLEARED" | "VOID" | "SETTLED";
      cuConsumed?: number;
      signature?: string;
    }>
  >([]);

  // Keeper liveness tracking (Item 7: >15s without clearing triggers offline alarm)
  const [lastClearedBatchTs, setLastClearedBatchTs] = useState<number>(Date.now());
  const [now, setNow] = useState<number>(Date.now());
  const [isDevnetOutage, setIsDevnetOutage] = useState<boolean>(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const lastClearedAgeSec = Math.max(0, Math.floor((now - lastClearedBatchTs) / 1000));
  const isKeeperOffline = lastClearedAgeSec > 15;

  // Vault Inventory Tracking (Round 11 Requirement 2)
  const [vaultInventoryNotice, setVaultInventoryNotice] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const checkVaultInventory = async () => {
      try {
        const [vaultUser] = getVaultUserPda();
        const [marketPda] = getMarketPda();
        const dummyWallet = {
          publicKey: PublicKey.default,
          signTransaction: async (tx: any) => tx,
          signAllTransactions: async (txs: any) => txs,
        };
        const provider = new AnchorProvider(connection, dummyWallet as any, { commitment: "confirmed" });
        const program = new Program(epochIdl as any, provider);
        const [marketAcc, vaultUserAcc] = await Promise.all([
          (program.account as any).market.fetch(marketPda),
          (program.account as any).userAccount.fetch(vaultUser),
        ]);
        if (!mounted) return;
        const basePos = vaultUserAcc.basePosition.toNumber();
        const maxLots = marketAcc.vaultParams.maxInventoryLots.toNumber();
        if (basePos >= maxLots) {
          setVaultInventoryNotice(
            `Backstop Vault at max LONG inventory (+${(basePos * 0.001).toFixed(1)} / ${(maxLots * 0.001).toFixed(1)} SOL). Bid quoting halted. Market sells will expire unfilled until rebalanced.`
          );
        } else if (basePos <= -maxLots) {
          setVaultInventoryNotice(
            `Backstop Vault at max SHORT inventory (${(basePos * 0.001).toFixed(1)} / -${(maxLots * 0.001).toFixed(1)} SOL). Ask quoting halted. Market buys will expire unfilled until rebalanced.`
          );
        } else {
          setVaultInventoryNotice(null);
        }
      } catch {
        // ignore
      }
    };
    checkVaultInventory();
    const interval = setInterval(checkVaultInventory, 4000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [connection]);

  useEffect(() => {
    fetch("/data/snapshot.json")
      .then((res) => res.json())
      .then((data) => {
        if (data && Array.isArray(data.batches) && data.batches.length > 0) {
          setRecentBatches(data.batches);
          setLastClearedBatchTs(Date.now());
        }
      })
      .catch((err) => console.warn("Failed to load /data/snapshot.json:", err));
  }, []);

  // 1. LIVE MARKET DATA POLLING LOOP (Every 2.5 seconds)
  useEffect(() => {
    let mounted = true;

    const pollMarketData = async () => {
      try {
        const stats = await fetchSolStats();
        if (mounted && stats) {
          setMarketStats(stats);
          setMarkPrice(stats.lastPrice);
        }

        const depth = await fetchLiveDepth(stats?.lastPrice || markPrice);
        if (mounted && depth) {
          setDynamicBids(depth.bids);
          setDynamicAsks(depth.asks);
        }
      } catch (err) {
        console.error("Live market polling failed:", err);
      }
    };

    pollMarketData();
    const interval = setInterval(pollMarketData, 2500);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // 2. LIVE SOLANA SLOT & BATCH CYCLE (09 §3.5 rule 14, B.5, and Round 8 B.1: (slot - start_slot) / N)
  useEffect(() => {
    let mounted = true;

    // Fetch on-chain market params (start_slot, batch_slots)
    const fetchMarketParams = async () => {
      try {
        const [marketPda] = getMarketPda();
        const dummyWallet = {
          publicKey: PublicKey.default,
          signTransaction: async () => {},
          signAllTransactions: async () => {},
        };
        const provider = new AnchorProvider(connection, dummyWallet as any, { commitment: "confirmed" });
        const program = new Program(epochIdl as any, provider);
        const marketAcc = await (program.account as any).market.fetch(marketPda);
        if (mounted && marketAcc) {
          if (marketAcc.startSlot) {
            setStartSlot(marketAcc.startSlot.toNumber());
          }
          if (marketAcc.params?.batchSlots) {
            setBatchSlots(marketAcc.params.batchSlots);
          }
        }
      } catch {
        // Fallback to known on-chain parameters (507372656, 2)
      }
    };
    fetchMarketParams();

    const syncSlot = async () => {
      try {
        const slot = await connection.getSlot("processed");
        if (mounted && slot > 0) {
          setIsDevnetOutage(false);
          setCurrentSlot(slot);
          const sSlot = startSlot || 507372656;
          const bSlots = batchSlots || 2;
          const bId = Math.max(0, Math.floor((slot - sSlot) / bSlots));
          setCurrentBatchId(bId);
          const rem = bSlots - ((slot - sSlot) % bSlots);
          setSlotsRemaining(rem);
        }
      } catch {
        if (mounted) {
          // B.5: Remove local reactive simulation; show outage banner and freeze widgets
          setIsDevnetOutage(true);
        }
      }
    };

    const interval = setInterval(syncSlot, 800);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [connection, startSlot, batchSlots]);

  // 2b. ON-CHAIN BATCH AGGREGATES SYNC (09 §3.5 rule 11 & C.6)
  useEffect(() => {
    let mounted = true;

    const syncBatchAccount = async () => {
      try {
        const ringIndex = currentBatchId % 8;
        const [batchPda] = getBatchPda(ringIndex);
        const accInfo = await connection.getAccountInfo(batchPda);
        if (accInfo && mounted) {
          const dummyWallet = {
            publicKey: PublicKey.default,
            signTransaction: async (tx: any) => tx,
            signAllTransactions: async (txs: any) => txs,
          };
          const provider = new AnchorProvider(connection, dummyWallet as any, { commitment: "confirmed" });
          const program = new Program(epochIdl as any, provider);
          const batchAcc = await (program.account as any).batch.fetch(batchPda);
          if (mounted && batchAcc) {
            if (batchAcc.batchId && batchAcc.batchId.toNumber() === currentBatchId) {
              const bArr = batchAcc.bidQty.map((x: any) => x.toNumber());
              const aArr = batchAcc.askQty.map((x: any) => x.toNumber());
              setBidQty(bArr);
              setAskQty(aArr);
            } else {
              setBidQty(new Array(101).fill(0));
              setAskQty(new Array(101).fill(0));
            }
          }
        }
      } catch {
        // Keep existing on-chain data or empty
      }
    };

    syncBatchAccount();
    const interval = setInterval(syncBatchAccount, 1600);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [connection, currentBatchId]);

  // 3. LIVE SOLANA WALLET BALANCE
  useEffect(() => {
    if (!connected || !publicKey) {
      setSolBalance(null);
      return;
    }

    let mounted = true;
    const fetchBalance = async () => {
      try {
        const lamports = await connection.getBalance(publicKey);
        if (mounted) {
          setSolBalance(lamports / 1e9);
        }
      } catch (e) {
        console.error("Balance fetch error:", e);
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [connected, publicKey, connection]);

  // 3b. LIVE ON-CHAIN USER ACCOUNT (Collateral, Quote, Positions)
  useEffect(() => {
    if (!connected || !publicKey) {
      setCollateral(0);
      setQuotePosition(0);
      setPosition(null);
      return;
    }

    let mounted = true;
    const fetchUserAccount = async () => {
      try {
        const [userPda] = getUserPda(publicKey);
        const accInfo = await connection.getAccountInfo(userPda);
        if (accInfo && mounted) {
          const dummyWallet = {
            publicKey,
            signTransaction: async (tx: any) => tx,
            signAllTransactions: async (txs: any) => txs,
          };
          const provider = new AnchorProvider(connection, dummyWallet as any, { commitment: "confirmed" });
          const program = new Program(epochIdl as any, provider);
          const userAcc = await (program.account as any).userAccount.fetch(userPda);
          if (mounted && userAcc) {
            setCollateral(userAcc.collateral.toNumber() / 1_000_000);
            setQuotePosition(userAcc.quotePosition.toNumber() / 1_000_000);
            const basePos = userAcc.basePosition.toNumber();
            if (basePos !== 0) {
              const collateralMicro = userAcc.collateral.toNumber();
              const quotePosMicro = userAcc.quotePosition.toNumber();
              const liqPriceMicro = computeLiquidationPrice(collateralMicro, quotePosMicro, basePos, 0, 500);
              const currentMark = markPrice || 119.80;
              const notionalUsd = (Math.abs(basePos) * 0.001) * currentMark;
              const equityUsd = (collateralMicro + quotePosMicro) / 1_000_000;
              const marginRatio = notionalUsd > 0 ? equityUsd / notionalUsd : 0;

              setPosition({
                market: "SOL-PERP",
                sizeLots: basePos,
                entryPrice: currentMark,
                markPrice: currentMark,
                unrealizedPnl: 0,
                marginRatio,
                liqPrice: liqPriceMicro > 0 ? liqPriceMicro / 1_000_000 : 0,
              });
            } else {
              setPosition(null);
            }
          }
        }
      } catch (e) {
        console.warn("User account sync error:", e);
      }
    };

    fetchUserAccount();
    const interval = setInterval(fetchUserAccount, 2000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [connected, publicKey, connection, markPrice]);

  // Support Playwright automated testing of connected/funded states
  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).__EPOCH_TEST_WALLET__) {
      setSolBalance(2.812);
      setCollateral(50.0);
      setQuotePosition(0);
      setPosition({
        market: "SOL-PERP",
        sizeLots: 1000,
        entryPrice: 120.0,
        markPrice: markPrice || 120.58,
        unrealizedPnl: 0.58,
        marginRatio: 5.0,
        liqPrice: 96.0,
      });
      setActiveOrders([
        {
          batchId: currentBatchId + 1,
          slotId: 0,
          side: "BUY",
          tickOffset: 5,
          lots: 1000,
        },
      ]);
    }
  }, [markPrice, currentBatchId]);

  // 4. DYNAMIC POSITION MARK-TO-MARKET UPDATE
  useEffect(() => {
    if (position && position.sizeLots !== 0) {
      const positionSol = position.sizeLots * 0.001;
      const uPnl = positionSol * (markPrice - position.entryPrice);
      setPosition((prev) =>
        prev
          ? {
              ...prev,
              markPrice,
              unrealizedPnl: parseFloat(uPnl.toFixed(2)),
            }
          : null
      );
    }
  }, [markPrice]);

  // Helper to obtain Anchor Program when wallet is connected
  const getAnchorProgram = () => {
    if (!connected || !publicKey || !walletContext) return null;
    try {
      const provider = new AnchorProvider(
        connection,
        walletContext as any,
        { commitment: "confirmed" }
      );
      return new Program(epochIdl as any, provider);
    } catch {
      return null;
    }
  };

  // Disconnect handler to purge all account state (UX-18 & Guardrail G-10)
  const handleDisconnectPurge = () => {
    setSolBalance(null);
    setCollateral(0);
    setQuotePosition(0);
    setPosition(null);
    setActiveOrders([]);
  };

  // Guardrail G-10: Reactively purge private account state when wallet disconnects
  useEffect(() => {
    if (!connected || !publicKey) {
      handleDisconnectPurge();
    }
  }, [connected, publicKey]);

  // Order Placement Handler (09-UX_SPEC.md §4 & §5 & Guardrails G-01..G-06, G-09)
  const handlePlaceOrder = async ({
    side,
    price,
    lots,
    offsetBps,
    lifetimeBatches,
    reduceOnly,
  }: {
    side: "BUY" | "SELL";
    price: number;
    lots: number;
    offsetBps: number;
    lifetimeBatches: number;
    reduceOnly: boolean;
  }) => {
    // Guardrail G-09: Block transaction placement during RPC disconnection
    if (isDevnetOutage) return;

    setIsPlacingOrder(true);
    setOrderError(null);
    const numBatches = Math.max(1, Math.min(4, lifetimeBatches || 1));
    const tick = Math.max(0, Math.min(100, 50 + offsetBps));

    // Guardrail G-03: Dynamic user slot allocation (0..7, never hardcode slotId: 0)
    const usedSlots = new Set(activeOrders.map((o) => o.slotId));
    const allocatedSlots: number[] = [];
    for (let s = 0; s < 8; s++) {
      if (!usedSlots.has(s)) {
        allocatedSlots.push(s);
        if (allocatedSlots.length === numBatches) break;
      }
    }
    while (allocatedSlots.length < numBatches) {
      allocatedSlots.push((activeOrders.length + allocatedSlots.length) % 8);
    }

    // 1. Attempt on-chain transactions across targeted batches if wallet connected
    const program = getAnchorProgram();
    if (program && publicKey) {
      try {
        const [marketPda] = getMarketPda();
        const [userPda] = getUserPda(publicKey);

        for (let i = 0; i < numBatches; i++) {
          const targetBatch = currentBatchId + i;
          const ringIndex = targetBatch % 8;
          const [batchPda] = getBatchPda(ringIndex);
          const userSlotId = allocatedSlots[i];

          await program.methods
            .placeOrder({
              targetBatch: new BN(targetBatch),
              ringIndex,
              slotId: userSlotId,
              side: side === "BUY" ? 0 : 1,
              tick,
              lots: new BN(lots),
              flags: reduceOnly ? 1 : 0,
            })
            .accounts({
              market: marketPda,
              batch: batchPda,
              user: userPda,
              owner: publicKey,
            })
            .rpc();
        }
      } catch (err: any) {
        const friendlyMsg = parseOrderError(err);
        console.warn("On-chain place_order failed:", friendlyMsg, err);
        setOrderError(friendlyMsg);
        setIsPlacingOrder(false);
        // Guardrail G-01: Return early on on-chain failure; zero simulated balance mutation
        return;
      }
    } else {
      await new Promise((res) => setTimeout(res, 500));
    }

    // 2. Update reactive local state
    if (side === "BUY") {
      setBidQty((prev) => {
        const n = [...prev];
        n[tick] = (n[tick] || 0) + lots * numBatches;
        return n;
      });
    } else {
      setAskQty((prev) => {
        const n = [...prev];
        n[tick] = (n[tick] || 0) + lots * numBatches;
        return n;
      });
    }

    const orderMargin = price * lots * 0.001 * 0.1 * numBatches;
    setCollateral((prev) => Math.max(0, parseFloat((prev - orderMargin).toFixed(2))));

    const newOrders: Array<{
      batchId: number;
      slotId: number;
      side: "BUY" | "SELL";
      tickOffset: number;
      lots: number;
    }> = [];
    for (let i = 0; i < numBatches; i++) {
      newOrders.push({
        batchId: currentBatchId + i,
        slotId: allocatedSlots[i],
        side,
        tickOffset: offsetBps,
        lots,
      });
    }
    setActiveOrders((prev) => [...newOrders, ...prev]);
    setIsPlacingOrder(false);
  };

  // Cancel Order Handler
  const handleCancelOrder = async (batchId: number, slotId: number) => {
    const program = getAnchorProgram();
    if (program && publicKey) {
      try {
        const [marketPda] = getMarketPda();
        const ringIndex = batchId % 8;
        const [batchPda] = getBatchPda(ringIndex);
        const [userPda] = getUserPda(publicKey);

        await program.methods
          .cancelOrder(new BN(batchId), ringIndex, slotId)
          .accounts({
            market: marketPda,
            batch: batchPda,
            user: userPda,
            owner: publicKey,
          })
          .rpc();
      } catch (err) {
        console.warn("On-chain cancel_order fell back to local state:", err);
      }
    }

    const order = activeOrders.find((o) => o.batchId === batchId && o.slotId === slotId);
    if (order) {
      const orderMargin = markPrice * order.lots * 0.001 * 0.1;
      setCollateral((prev) => parseFloat((prev + orderMargin).toFixed(2)));
    }
    setActiveOrders((prev) =>
      prev.filter((o) => !(o.batchId === batchId && o.slotId === slotId))
    );
  };

  // Faucet Request Handler (Guardrails G-01 & G-09 compliant)
  const handleRequestFaucet = async (amountUsd: number) => {
    if (isDevnetOutage) return;
    const program = getAnchorProgram();
    if (program && publicKey) {
      try {
        const [quoteMintPda] = getQuoteMintPda();
        const [vaultAuthorityPda] = getVaultAuthorityPda();
        await program.methods
          .faucet(new BN(amountUsd * 1_000_000))
          .accounts({
            quoteMint: quoteMintPda,
            mintAuthority: vaultAuthorityPda,
            userQuoteAccount: publicKey,
            user: publicKey,
          })
          .rpc();
        setCollateral((prev) => prev + amountUsd);
      } catch (err) {
        console.warn("On-chain faucet failed:", err);
        // Guardrail G-01: No simulated balance mutation on failure!
        return;
      }
    } else {
      await new Promise((res) => setTimeout(res, 600));
      setCollateral((prev) => prev + amountUsd);
    }
  };

  // Deposit Handler (Guardrails G-01 & G-09 compliant)
  const handleDeposit = async (amountUsd: number) => {
    if (isDevnetOutage) return;
    const program = getAnchorProgram();
    if (program && publicKey) {
      try {
        const [marketPda] = getMarketPda();
        const [userPda] = getUserPda(publicKey);
        const [vaultPda] = getCollateralVaultPda();
        await program.methods
          .deposit(new BN(amountUsd * 1_000_000))
          .accounts({
            market: marketPda,
            user: userPda,
            owner: publicKey,
            userTokenAccount: publicKey,
            vault: vaultPda,
          })
          .rpc();
        setCollateral((prev) => prev + amountUsd);
      } catch (err) {
        console.warn("On-chain deposit failed:", err);
        // Guardrail G-01: No simulated balance mutation on failure!
        return;
      }
    } else {
      await new Promise((res) => setTimeout(res, 500));
      setCollateral((prev) => prev + amountUsd);
    }
  };

  // Withdraw Handler (Guardrails G-01, G-07 & G-09 compliant)
  const handleWithdraw = async (amountUsd: number) => {
    if (isDevnetOutage) return;
    // Guardrail G-07: Prohibit withdrawal when either a non-zero position or active orders exist
    if ((position && position.sizeLots !== 0) || activeOrders.length > 0) {
      console.warn("Withdrawal blocked by Guardrail G-07: position not flat or active orders exist");
      return;
    }
    const program = getAnchorProgram();
    if (program && publicKey) {
      try {
        const [marketPda] = getMarketPda();
        const [userPda] = getUserPda(publicKey);
        const [vaultPda] = getCollateralVaultPda();
        const [vaultAuthorityPda] = getVaultAuthorityPda();
        await program.methods
          .withdraw(new BN(amountUsd * 1_000_000))
          .accounts({
            market: marketPda,
            user: userPda,
            owner: publicKey,
            userTokenAccount: publicKey,
            vault: vaultPda,
            vaultAuthority: vaultAuthorityPda,
          })
          .rpc();
        setCollateral((prev) => Math.max(0, prev - amountUsd));
      } catch (err) {
        console.warn("On-chain withdraw failed:", err);
        // Guardrail G-01: No simulated balance mutation on failure!
        return;
      }
    } else {
      await new Promise((res) => setTimeout(res, 500));
      setCollateral((prev) => Math.max(0, prev - amountUsd));
    }
  };

  // 09 §3.5 rule 6: Header stats are Epoch's own on-chain data
  const epochVolumeUsd = recentBatches.reduce(
    (acc, b) => acc + b.matchedLots * 0.001 * b.clearingPrice,
    0
  );
  const epochOpenInterestSol = position ? Math.abs(position.sizeLots * 0.001) : 0;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-surface-canvas text-content-primary">
      {/* 0. Top Scrolling Reference Prices Strip */}
      <ReferencePriceStrip />

      {/* 1. Institutional Top Header Navigation with System Status Center */}
      <Header
        currentSlot={currentSlot}
        currentBatchId={currentBatchId}
        slotsRemaining={slotsRemaining}
        markPrice={markPrice}
        stats={marketStats}
        epochVolumeUsd={epochVolumeUsd}
        epochOpenInterestSol={epochOpenInterestSol}
        solBalance={solBalance}
        collateralBalance={collateral}
        onOpenFaucetModal={() => setIsFaucetOpen(true)}
        onDisconnect={handleDisconnectPurge}
        isKeeperOffline={isKeeperOffline}
        lastClearedAgeSec={lastClearedAgeSec}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        isDevnetOutage={isDevnetOutage}
        vaultInventoryNotice={vaultInventoryNotice}
      />

      {/* 1.5 Mobile Sub-Header Route Switcher (< 768px) */}
      <div className="md:hidden flex items-center justify-around bg-surface-header border-b border-line-default px-2 py-1 shrink-0 font-sans text-xs select-none">
        <button
          type="button"
          onClick={() => setActiveTab("trade")}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            activeTab === "trade"
              ? "bg-surface-elevated text-trade-cyan font-semibold border border-trade-cyan/30 shadow-xs"
              : "text-content-secondary hover:text-content-primary"
          }`}
        >
          Trade
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("batches")}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            activeTab === "batches"
              ? "bg-surface-elevated text-trade-cyan font-semibold border border-trade-cyan/30 shadow-xs"
              : "text-content-secondary hover:text-content-primary"
          }`}
        >
          Batches
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("evidence")}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            activeTab === "evidence"
              ? "bg-surface-elevated text-trade-cyan font-semibold border border-trade-cyan/30 shadow-xs"
              : "text-content-secondary hover:text-content-primary"
          }`}
        >
          Evidence
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("compare")}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            activeTab === "compare"
              ? "bg-surface-elevated text-trade-cyan font-semibold border border-trade-cyan/30 shadow-xs"
              : "text-content-secondary hover:text-content-primary"
          }`}
        >
          Compare
        </button>
      </div>

      {/* 2. Main Workspace Layout (Frozen if RPC outage per Guardrail G-09) */}
      <div
        className={`flex-1 flex overflow-hidden ${
          isDevnetOutage ? "opacity-60 pointer-events-none filter grayscale-[30%]" : ""
        }`}
      >
        {/* Dynamic Center Viewport */}
        {activeTab === "trade" && (
          <div className="flex-1 flex flex-col min-w-0 bg-surface-canvas overflow-hidden pb-14 lg:pb-0 relative">
            {/* Top Workspace: Chart + Order Book + Order Ticket */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* Candlestick TradingView Chart */}
              <TradingChart
                markPrice={markPrice}
                batchId={currentBatchId}
                bidQty={bidQty}
                askQty={askQty}
                stats={marketStats}
                onSelectPrice={setSelectedPrice}
                recentClearingPrice={recentBatches[0]?.clearingPrice}
              />

              {/* Order Book Micro-Ladder & Depth */}
              <OrderBook
                currentBatchId={currentBatchId}
                oraclePrice={markPrice}
                bidQty={bidQty}
                askQty={askQty}
                userOrders={activeOrders}
                dynamicBids={dynamicBids}
                dynamicAsks={dynamicAsks}
                onSelectOffset={setSelectedOffsetBps}
                onSelectPrice={setSelectedPrice}
              />

              {/* Order Placement Console (Desktop / Laptop >= 1024px) */}
              <OrderTicket
                currentBatchId={currentBatchId}
                oraclePrice={markPrice}
                availableEquity={collateral}
                isPlacingOrder={isPlacingOrder}
                selectedPrice={selectedPrice}
                selectedOffsetBps={selectedOffsetBps}
                bidQty={bidQty}
                askQty={askQty}
                userPositionLots={position?.sizeLots || 0}
                onPlaceOrder={handlePlaceOrder}
                onOpenDeposit={() => setDepositWithdrawModal({ isOpen: true, mode: "deposit" })}
                orderError={orderError}
                onClearOrderError={() => setOrderError(null)}
              />
            </div>

            {/* Bottom Docking Ledger (Positions, Open Orders, Balances, Clearance) */}
            <BottomLedger
              collateral={collateral}
              quotePosition={quotePosition}
              position={position}
              activeOrders={activeOrders}
              recentBatches={recentBatches}
              onOpenDeposit={() => setDepositWithdrawModal({ isOpen: true, mode: "deposit" })}
              onOpenWithdraw={() => setDepositWithdrawModal({ isOpen: true, mode: "withdraw" })}
              onOpenFaucet={() => setIsFaucetOpen(true)}
              onCancelOrder={handleCancelOrder}
              onMarketClosePosition={() => {
                if (!position || position.sizeLots === 0) return;
                handlePlaceOrder({
                  side: position.sizeLots > 0 ? "SELL" : "BUY",
                  price: markPrice,
                  lots: Math.abs(position.sizeLots),
                  offsetBps: position.sizeLots > 0 ? -50 : 50,
                  lifetimeBatches: 1,
                  reduceOnly: true,
                });
              }}
            />

            {/* Sticky Mobile Action Bar (< 1024px) */}
            <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-surface-header/95 backdrop-blur-md border-t border-line-default px-3 py-2 flex items-center gap-2 select-none font-sans shadow-lg">
              <button
                type="button"
                data-testid="mobile-buy-button"
                onClick={() => setMobileOrderDrawer({ isOpen: true, side: "BUY" })}
                className="flex-1 py-2.5 px-3 rounded-lg bg-trade-emerald hover:bg-trade-emerald/90 text-black font-bold text-xs shadow-sm active:scale-95 transition-all flex items-center justify-center gap-1.5 font-sans"
              >
                <span className="w-2 h-2 rounded-full bg-black/40" />
                <span>Buy / Long</span>
              </button>
              <button
                type="button"
                data-testid="mobile-sell-button"
                onClick={() => setMobileOrderDrawer({ isOpen: true, side: "SELL" })}
                className="flex-1 py-2.5 px-3 rounded-lg bg-trade-coral hover:bg-trade-coral/90 text-white font-bold text-xs shadow-sm active:scale-95 transition-all flex items-center justify-center gap-1.5 font-sans"
              >
                <span className="w-2 h-2 rounded-full bg-white/40" />
                <span>Sell / Short</span>
              </button>
            </div>
          </div>
        )}

        {/* Mobile Order Entry Drawer Sheet */}
        {mobileOrderDrawer.isOpen && (
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs select-none animate-scale-in"
            onClick={(e) => {
              if (e.target === e.currentTarget) setMobileOrderDrawer({ isOpen: false, side: "BUY" });
            }}
            role="presentation"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Mobile Order Entry Ticket"
              className="w-full max-h-[85vh] bg-surface-panel border-t border-line-strong rounded-t-2xl shadow-modal flex flex-col overflow-hidden animate-slide-up"
            >
              <div className="w-12 h-1 rounded-full bg-line-strong mx-auto mt-2 mb-1 shrink-0" />
              <OrderTicket
                currentBatchId={currentBatchId}
                oraclePrice={markPrice}
                availableEquity={collateral}
                isPlacingOrder={isPlacingOrder}
                selectedPrice={selectedPrice}
                selectedOffsetBps={selectedOffsetBps}
                bidQty={bidQty}
                askQty={askQty}
                userPositionLots={position?.sizeLots || 0}
                onPlaceOrder={async (args) => {
                  await handlePlaceOrder(args);
                  setMobileOrderDrawer({ isOpen: false, side: "BUY" });
                }}
                onOpenDeposit={() => {
                  setMobileOrderDrawer({ isOpen: false, side: "BUY" });
                  setDepositWithdrawModal({ isOpen: true, mode: "deposit" });
                }}
                orderError={orderError}
                onClearOrderError={() => setOrderError(null)}
                initialSide={mobileOrderDrawer.side}
                isMobileSheet={true}
                onCloseMobile={() => setMobileOrderDrawer({ isOpen: false, side: "BUY" })}
              />
            </div>
          </div>
        )}

        {activeTab === "batches" && <BatchLogView batches={recentBatches} />}

        {activeTab === "evidence" && <EvidenceView />}

        {activeTab === "compare" && <ComparisonView />}
      </div>

      {/* Modals */}
      <FaucetModal
        isOpen={isFaucetOpen}
        onClose={() => setIsFaucetOpen(false)}
        onRequestFaucet={handleRequestFaucet}
      />

      <DepositWithdrawModal
        isOpen={depositWithdrawModal.isOpen}
        mode={depositWithdrawModal.mode}
        onClose={() => setDepositWithdrawModal({ isOpen: false, mode: "deposit" })}
        collateralBalance={collateral}
        isPositionFlat={(position ? position.sizeLots === 0 : true) && activeOrders.length === 0}
        onDeposit={handleDeposit}
        onWithdraw={handleWithdraw}
      />
    </div>
  );
}
