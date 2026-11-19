"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Server,
  Activity,
  Zap,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  X,
  ExternalLink,
  Wifi,
  WifiOff,
  Clock,
  Database,
  Layers,
} from "lucide-react";
import { StatusIndicator, StatusVariant } from "./ui/StatusIndicator";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";

export interface SystemStatusCenterProps {
  currentSlot: number;
  currentBatchId: number;
  isKeeperOffline: boolean;
  lastClearedAgeSec: number;
  isDevnetOutage: boolean;
  vaultInventoryNotice: string | null;
  rpcUrl?: string;
  clusterLabel?: string;
  oraclePrice?: number;
  oracleAgeSec?: number;
  venueCount?: number;
}

export const SystemStatusCenter: React.FC<SystemStatusCenterProps> = ({
  currentSlot,
  currentBatchId,
  isKeeperOffline,
  lastClearedAgeSec,
  isDevnetOutage,
  vaultInventoryNotice,
  rpcUrl = "https://api.devnet.solana.com",
  clusterLabel = "Devnet",
  oraclePrice = 119.60,
  oracleAgeSec = 1,
  venueCount = 6,
}) => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isDrawerOpen) {
        setIsDrawerOpen(false);
      }
    };
    if (isDrawerOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isDrawerOpen]);

  // Determine overall severity
  const isCritical = isDevnetOutage || isKeeperOffline;
  const isDegraded = !isCritical && (Boolean(vaultInventoryNotice) || oracleAgeSec > 30);
  const isHealthy = !isCritical && !isDegraded;

  const overallStatus: StatusVariant = isCritical
    ? "coral"
    : isDegraded
    ? "amber"
    : "emerald";

  const overallLabel = isDevnetOutage
    ? "RPC Outage"
    : isKeeperOffline
    ? `Keeper Offline (${lastClearedAgeSec}s)`
    : isDegraded
    ? "Subsystem Degraded"
    : "System Operational";

  return (
    <>
      {/* 1. Header Trigger Pill */}
      <button
        type="button"
        onClick={() => setIsDrawerOpen(true)}
        className={`flex items-center gap-2 px-2.5 py-1 rounded bg-surface-card border transition-all duration-150 text-2xs font-mono select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-trade-cyan ${
          isCritical
            ? "border-trade-coral/60 bg-trade-coral/10 text-trade-coral hover:bg-trade-coral/15"
            : isDegraded
            ? "border-trade-amber/60 bg-trade-amber/10 text-trade-amber hover:bg-trade-amber/15"
            : "border-line-default text-content-secondary hover:border-line-strong hover:bg-surface-elevated hover:text-content-primary"
        }`}
        title="Click to view detailed system health diagnostics"
        aria-label="System Health Telemetry"
        aria-haspopup="dialog"
        aria-expanded={isDrawerOpen}
      >
        <StatusIndicator status={overallStatus} size="xs" pulse={!isHealthy} />
        <span className="font-semibold">{clusterLabel}</span>
        <span className="text-line-strong">·</span>
        <span className="truncate max-w-[150px] sm:max-w-none">
          {isCritical ? overallLabel : `Keeper ~239ms/slot`}
        </span>
      </button>

      {/* 2. Slide-Over Diagnostic Drawer Backdrop & Panel */}
      {isDrawerOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs select-none animate-scale-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsDrawerOpen(false);
          }}
          role="presentation"
        >
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="System Health Diagnostics"
            className="w-full max-w-md h-full bg-surface-panel border-l border-line-strong shadow-modal flex flex-col font-sans text-xs overflow-hidden"
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-line-default bg-surface-card">
              <div className="flex items-center gap-2.5">
                <StatusIndicator status={overallStatus} size="sm" pulse={!isHealthy} />
                <div>
                  <h3 className="font-bold text-sm text-content-primary tracking-tight">
                    System Health & Diagnostics
                  </h3>
                  <p className="text-2xs text-content-muted">
                    Real-time infrastructure telemetry & execution availability
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="p-1.5 rounded text-content-muted hover:text-content-primary hover:bg-surface-hover transition-colors"
                aria-label="Close diagnostics drawer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Diagnostic Content Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Overall Status Banner */}
              <div
                className={`p-3.5 rounded-lg border flex items-start gap-3 ${
                  isCritical
                    ? "bg-trade-coral/10 border-trade-coral/30 text-trade-coral"
                    : isDegraded
                    ? "bg-trade-amber/10 border-trade-amber/30 text-trade-amber"
                    : "bg-trade-emerald/10 border-trade-emerald/30 text-trade-emerald"
                }`}
              >
                {isCritical ? (
                  <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
                ) : isDegraded ? (
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                ) : (
                  <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-bold text-xs uppercase tracking-wider">
                    {overallLabel}
                  </div>
                  <p className="text-2xs text-content-secondary mt-1 leading-relaxed">
                    {isDevnetOutage
                      ? "Solana Devnet RPC cluster is unresponsive. Market data is frozen and order submission is disabled to protect against transaction loss."
                      : isKeeperOffline
                      ? `Keeper clearance delayed (>15s threshold, last batch cleared ${lastClearedAgeSec}s ago). Automated batch matching and settlement delayed.`
                      : vaultInventoryNotice
                      ? vaultInventoryNotice
                      : "All protocol subsystems are operational. Batch auctions clearing deterministically on 2-slot cycles (~477ms)."}
                  </p>
                </div>
              </div>

              {/* Subsystem 1: Solana RPC Cluster */}
              <div className="p-3.5 rounded-lg bg-surface-card border border-line-default space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-content-primary flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5 text-trade-cyan" />
                    Solana RPC Cluster
                  </span>
                  <Badge variant={isDevnetOutage ? "coral" : "emerald"} size="xs">
                    {isDevnetOutage ? "UNREACHABLE" : "CONNECTED"}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-2xs font-mono">
                  <div className="p-2 rounded bg-surface-panel border border-line-subtle space-y-0.5">
                    <span className="text-content-muted">Cluster Endpoint</span>
                    <div className="text-content-primary truncate">{clusterLabel}</div>
                  </div>
                  <div className="p-2 rounded bg-surface-panel border border-line-subtle space-y-0.5">
                    <span className="text-content-muted">Current Slot</span>
                    <div className="text-content-primary font-bold">
                      {currentSlot > 0 ? `#${currentSlot.toLocaleString()}` : "Stalled"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Subsystem 2: Keeper Clearance Daemon */}
              <div className="p-3.5 rounded-lg bg-surface-card border border-line-default space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-content-primary flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-trade-cyan" />
                    Keeper Clearance Daemon
                  </span>
                  <Badge variant={isKeeperOffline ? "coral" : "emerald"} size="xs">
                    {isKeeperOffline ? "OFFLINE (>15s)" : "ACTIVE"}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-2xs font-mono">
                  <div className="p-2 rounded bg-surface-panel border border-line-subtle space-y-0.5">
                    <span className="text-content-muted">Last Clearance Age</span>
                    <div
                      className={`font-bold ${
                        isKeeperOffline ? "text-trade-coral" : "text-trade-emerald"
                      }`}
                    >
                      {lastClearedAgeSec}s ago
                    </div>
                  </div>
                  <div className="p-2 rounded bg-surface-panel border border-line-subtle space-y-0.5">
                    <span className="text-content-muted">Cycle Duration</span>
                    <div className="text-content-primary">2 slots (~477ms)</div>
                  </div>
                </div>
              </div>

              {/* Subsystem 3: Pyth Network Oracle */}
              <div className="p-3.5 rounded-lg bg-surface-card border border-line-default space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-content-primary flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-trade-cyan" />
                    Pyth Oracle Freshness
                  </span>
                  <Badge variant={oracleAgeSec > 30 ? "amber" : "emerald"} size="xs">
                    {oracleAgeSec > 30 ? "STALE" : "FRESH"}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-2xs font-mono">
                  <div className="p-2 rounded bg-surface-panel border border-line-subtle space-y-0.5">
                    <span className="text-content-muted">Oracle Reference</span>
                    <div className="text-content-primary font-bold">
                      ${oraclePrice.toFixed(2)}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-surface-panel border border-line-subtle space-y-0.5">
                    <span className="text-content-muted">Venue Count</span>
                    <div className="text-content-primary">{venueCount}/6 Active</div>
                  </div>
                </div>
              </div>

              {/* Subsystem 4: Backstop Vault Inventory */}
              <div className="p-3.5 rounded-lg bg-surface-card border border-line-default space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-content-primary flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-trade-cyan" />
                    Backstop Vault Inventory
                  </span>
                  <Badge
                    variant={vaultInventoryNotice ? "amber" : "emerald"}
                    size="xs"
                  >
                    {vaultInventoryNotice ? "QUOTING HALTED" : "BALANCED"}
                  </Badge>
                </div>
                <p className="text-2xs text-content-secondary font-mono leading-relaxed">
                  {vaultInventoryNotice
                    ? vaultInventoryNotice
                    : "Vault inventory within target limits. Both bid and ask liquidity ladders actively quoting across ±50 bps collar."}
                </p>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-line-default bg-surface-card flex items-center justify-between">
              <span className="text-2xs text-content-muted font-mono">
                Batch #{currentBatchId} · 1 bp tick spacing
              </span>
              <Button
                variant="secondary"
                size="xs"
                onClick={() => setIsDrawerOpen(false)}
              >
                Close Diagnostics
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
