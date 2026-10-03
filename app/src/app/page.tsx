"use client";

import React, { useState, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { MarketTickerBanner } from "../components/MarketTickerBanner";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import { BatchAuctionCrossingCurve } from "../components/BatchAuctionCrossingCurve";
import { OrderBook } from "../components/OrderBook";
import { OrderTicket } from "../components/OrderTicket";
import { BottomLedger } from "../components/BottomLedger";
import { BatchLogView } from "../components/BatchLogView";
import { EvidenceView } from "../components/EvidenceView";
import { FaucetModal } from "../components/FaucetModal";
import { DepositWithdrawModal } from "../components/DepositWithdrawModal";

export default function Home() {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();

  // Navigation State
  const [activeTab, setActiveTab] = useState<"trade" | "batches" | "evidence">("trade");

  // Modals
  const [isFaucetOpen, setIsFaucetOpen] = useState(false);
  const [depositWithdrawModal, setDepositWithdrawModal] = useState<{
    isOpen: boolean;
    mode: "deposit" | "withdraw";
  }>({ isOpen: false, mode: "deposit" });

  // On-Chain State / Simulation
  const [currentSlot, setCurrentSlot] = useState<number>(2841924);
  const [currentBatchId, setCurrentBatchId] = useState<number>(142);
  const [slotsRemaining, setSlotsRemaining] = useState<number>(2);
  const [markPrice, setMarkPrice] = useState<number>(150.04);
  const [selectedOffsetBps, setSelectedOffsetBps] = useState<number>(3);
  const [isPlacingOrder, setIsPlacingOrder] = useState<boolean>(false);

  // User Balances & Position
  const [collateral, setCollateral] = useState<number>(2500);
  const [quotePosition, setQuotePosition] = useState<number>(0);
  const [position, setPosition] = useState<{
    market: string;
    sizeLots: number;
    entryPrice: number;
    markPrice: number;
    unrealizedPnl: number;
    marginRatio: number;
    liqPrice: number;
  } | null>({
    market: "SOL-PERP",
    sizeLots: 50,
    entryPrice: 148.20,
    markPrice: 150.04,
    unrealizedPnl: 92.00,
    marginRatio: 0.12,
    liqPrice: 112.40,
  });

  const [activeOrders, setActiveOrders] = useState<
    Array<{
      batchId: number;
      slotId: number;
      side: "BUY" | "SELL";
      tickOffset: number;
      lots: number;
    }>
  >([
    { batchId: 143, slotId: 0, side: "BUY", tickOffset: 3, lots: 10 },
    { batchId: 144, slotId: 1, side: "SELL", tickOffset: 8, lots: 20 },
  ]);

  // Synthetic Tick Aggregates for K=101
  const [bidQty, setBidQty] = useState<number[]>(() => {
    const arr = new Array(101).fill(0);
    for (let i = 0; i <= 50; i++) {
      arr[i] = Math.floor(Math.sin((i / 50) * Math.PI) * 45 + 15);
    }
    return arr;
  });

  const [askQty, setAskQty] = useState<number[]>(() => {
    const arr = new Array(101).fill(0);
    for (let i = 50; i < 101; i++) {
      arr[i] = Math.floor(Math.sin(((100 - i) / 50) * Math.PI) * 45 + 15);
    }
    return arr;
  });

  // Recent Historical Batches
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
    }>
  >([
    {
      batchId: 141,
      clearingPrice: 150.045,
      matchedLots: 1420,
      offsetBps: 3,
      oraclePrice: 150.00,
      oracleConf: 12000,
      status: "SETTLED",
      cuConsumed: 18728,
    },
    {
      batchId: 140,
      clearingPrice: 149.985,
      matchedLots: 980,
      offsetBps: -1,
      oraclePrice: 150.00,
      oracleConf: 10500,
      status: "SETTLED",
      cuConsumed: 16174,
    },
    {
      batchId: 139,
      clearingPrice: 150.015,
      matchedLots: 1650,
      offsetBps: 1,
      oraclePrice: 150.00,
      oracleConf: 9800,
      status: "SETTLED",
      cuConsumed: 22890,
    },
    {
      batchId: 138,
      clearingPrice: 150.00,
      matchedLots: 0,
      offsetBps: 0,
      oraclePrice: 150.00,
      oracleConf: 500000,
      status: "VOID",
      cuConsumed: 6592,
    },
  ]);

  // Polling loop to simulate Solana slots and batch transitions (every 800ms)
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentSlot((prev) => {
        const next = prev + 1;
        setSlotsRemaining((rem) => {
          if (rem <= 1) {
            // Batch closes, increment batch ID
            setCurrentBatchId((b) => {
              const newBatchId = b + 1;
              // Generate mock clearing record
              const offset = Math.floor(Math.random() * 7) - 3;
              const clPrice = markPrice * (1 + offset / 10_000);
              const matched = Math.floor(Math.random() * 800 + 400);

              setRecentBatches((old) => [
                {
                  batchId: b,
                  clearingPrice: clPrice,
                  matchedLots: matched,
                  offsetBps: offset,
                  oraclePrice: markPrice,
                  oracleConf: 12000,
                  status: "CLEARED",
                  cuConsumed: Math.floor(Math.random() * 5000 + 16000),
                },
                ...old.slice(0, 19),
              ]);

              return newBatchId;
            });
            return 2; // reset 2 slots per batch
          }
          return rem - 1;
        });
        return next;
      });
    }, 800);

    return () => clearInterval(interval);
  }, [markPrice]);

  // Order Placement Handler
  const handlePlaceOrder = async ({
    side,
    lots,
    offsetBps,
    targetBatch,
  }: {
    side: "BUY" | "SELL";
    lots: number;
    offsetBps: number;
    targetBatch: number;
  }) => {
    setIsPlacingOrder(true);
    await new Promise((res) => setTimeout(res, 600));

    // Update local state
    const tick = 50 + offsetBps;
    if (side === "BUY") {
      setBidQty((prev) => {
        const n = [...prev];
        n[tick] = (n[tick] || 0) + lots;
        return n;
      });
    } else {
      setAskQty((prev) => {
        const n = [...prev];
        n[tick] = (n[tick] || 0) + lots;
        return n;
      });
    }

    setActiveOrders((prev) => [
      {
        batchId: targetBatch,
        slotId: prev.length,
        side,
        tickOffset: offsetBps,
        lots,
      },
      ...prev,
    ]);

    setIsPlacingOrder(false);
  };

  // Cancel Order Handler
  const handleCancelOrder = async (batchId: number, slotId: number) => {
    setActiveOrders((prev) =>
      prev.filter((o) => !(o.batchId === batchId && o.slotId === slotId))
    );
  };

  // Faucet Request Handler
  const handleRequestFaucet = async (amountUsd: number) => {
    await new Promise((res) => setTimeout(res, 800));
    setCollateral((prev) => prev + amountUsd);
  };

  // Deposit Handler
  const handleDeposit = async (amountUsd: number) => {
    await new Promise((res) => setTimeout(res, 600));
    setCollateral((prev) => prev + amountUsd);
  };

  // Withdraw Handler
  const handleWithdraw = async (amountUsd: number) => {
    await new Promise((res) => setTimeout(res, 600));
    setCollateral((prev) => Math.max(0, prev - amountUsd));
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#0b0e11] text-[#f0f3f6]">
      {/* 1. Thin Infinite Ticker Banner Across Very Top */}
      <MarketTickerBanner />

      {/* 2. Top Header Navigation */}
      <Header
        currentSlot={currentSlot}
        currentBatchId={currentBatchId}
        slotsRemaining={slotsRemaining}
        markPrice={markPrice}
        onOpenFaucetModal={() => setIsFaucetOpen(true)}
      />

      {/* 3. Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          onOpenFaucetModal={() => setIsFaucetOpen(true)}
        />

        {/* Dynamic Center Viewport */}
        {activeTab === "trade" && (
          <div className="flex-1 flex flex-col min-w-0 bg-[#0b0e11] overflow-hidden">
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* Centerpiece: Batch Auction Crossing Curve */}
              <BatchAuctionCrossingCurve
                batchId={currentBatchId}
                oraclePrice={markPrice}
                bidQty={bidQty}
                askQty={askQty}
              />

              {/* Order Book Micro-Ladder */}
              <OrderBook
                oraclePrice={markPrice}
                bidQty={bidQty}
                askQty={askQty}
                onSelectOffset={setSelectedOffsetBps}
              />

              {/* Order Placement Console */}
              <OrderTicket
                currentBatchId={currentBatchId}
                oraclePrice={markPrice}
                selectedOffsetBps={selectedOffsetBps}
                onChangeOffset={setSelectedOffsetBps}
                availableCollateral={collateral}
                isPlacingOrder={isPlacingOrder}
                onPlaceOrder={handlePlaceOrder}
              />
            </div>

            {/* Bottom Docking Ledger */}
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
            />
          </div>
        )}

        {activeTab === "batches" && <BatchLogView batches={recentBatches} />}

        {activeTab === "evidence" && <EvidenceView />}
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
        isPositionFlat={position ? position.sizeLots === 0 : true}
        onDeposit={handleDeposit}
        onWithdraw={handleWithdraw}
      />
    </div>
  );
}
