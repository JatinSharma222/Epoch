"use client";

import React, { useState } from "react";
import {
  Button,
  Input,
  Tabs,
  Dropdown,
  Tooltip,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  StatusIndicator,
  Badge,
  Modal,
  useToast,
} from "@/components/ui";
import {
  TrendingUp,
  Search,
  Shield,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  Sparkles,
} from "lucide-react";

export default function DesignSystemPage() {
  const [activeTab, setActiveTab] = useState("all");
  const [inputVal, setInputVal] = useState("119.60");
  const [inputError, setInputError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { showToast } = useToast();

  const tabItems = [
    { id: "all", label: "All Primitives" },
    { id: "buttons", label: "Buttons & Badges", count: 8 },
    { id: "inputs", label: "Inputs & Modals", count: 4 },
    { id: "tables", label: "Tables & Status", count: 6 },
  ];

  const dropdownItems = [
    { id: "1", label: "SOL-PERP (10x)", icon: <TrendingUp className="w-3.5 h-3.5 text-trade-cyan" /> },
    { id: "2", label: "BTC-PERP (20x)", icon: <Activity className="w-3.5 h-3.5 text-content-muted" />, disabled: true },
    { id: "3", label: "Disconnect Wallet", destructive: true },
  ];

  return (
    <div className="min-h-screen bg-surface-canvas text-content-primary p-6 md:p-10 font-sans select-none overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-10">
        {/* Header Banner */}
        <div className="border-b border-line-default pb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-trade-cyan animate-pulse" />
              <span className="text-2xs uppercase tracking-widest font-mono text-trade-cyan font-bold">
                Epoch Protocol · Milestone 1
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              Design System & Core Primitives Catalog
            </h1>
            <p className="text-xs text-content-secondary mt-1">
              Institutional dark trading terminal design system benchmarked against Hyperliquid & dYdX.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusIndicator status="emerald" label="Design System v1.0" subLabel="Canonical Tokens" />
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Sparkles className="w-3.5 h-3.5" />}
              onClick={() =>
                showToast({
                  type: "info",
                  title: "Toast Primitive Active",
                  description: "Non-intrusive floating snackbar notification system verified.",
                })
              }
            >
              Test Toast
            </Button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div>
          <Tabs
            items={tabItems}
            activeId={activeTab}
            onChange={setActiveTab}
            variant="segmented"
            size="md"
          />
        </div>

        {/* 1. Color Tokens Palette Matrix */}
        {(activeTab === "all" || activeTab === "buttons") && (
          <section className="space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-content-muted">
              1. Color Tokens & Surface Layering
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-2xs font-mono">
              <div className="p-3 rounded bg-surface-canvas border border-line-strong space-y-1">
                <div className="text-content-muted">--surface-canvas</div>
                <div className="font-bold text-content-primary">#07090E</div>
                <div className="text-[10px] text-content-disabled">Deepest Canvas</div>
              </div>
              <div className="p-3 rounded bg-surface-panel border border-line-default space-y-1">
                <div className="text-content-muted">--surface-panel</div>
                <div className="font-bold text-content-primary">#0B0F17</div>
                <div className="text-[10px] text-content-disabled">Terminal Panel</div>
              </div>
              <div className="p-3 rounded bg-surface-card border border-line-default space-y-1">
                <div className="text-content-muted">--surface-card</div>
                <div className="font-bold text-content-primary">#111622</div>
                <div className="text-[10px] text-content-disabled">Elevated Card</div>
              </div>
              <div className="p-3 rounded bg-surface-elevated border border-line-default space-y-1">
                <div className="text-content-muted">--surface-elevated</div>
                <div className="font-bold text-content-primary">#161D2B</div>
                <div className="text-[10px] text-content-disabled">Dropdowns / Modals</div>
              </div>
              <div className="p-3 rounded bg-surface-hover border border-line-default space-y-1">
                <div className="text-content-muted">--surface-hover</div>
                <div className="font-bold text-content-primary">#1D2638</div>
                <div className="text-[10px] text-content-disabled">Interactive Hover</div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-2xs font-mono">
              <div className="p-3 rounded bg-trade-emerald/10 border border-trade-emerald/30 space-y-1">
                <div className="text-trade-emerald font-bold">--color-emerald (#10B981)</div>
                <div className="text-content-secondary">Buy / Long / In-Band Fill</div>
              </div>
              <div className="p-3 rounded bg-trade-coral/10 border border-trade-coral/30 space-y-1">
                <div className="text-trade-coral font-bold">--color-coral (#F43F5E)</div>
                <div className="text-content-secondary">Sell / Short / Liquidation</div>
              </div>
              <div className="p-3 rounded bg-trade-cyan/10 border border-trade-cyan/30 space-y-1">
                <div className="text-trade-cyan font-bold">--color-cyan (#00D8F6)</div>
                <div className="text-content-secondary">Uniform Clearing P* / Focus</div>
              </div>
              <div className="p-3 rounded bg-trade-amber/10 border border-trade-amber/30 space-y-1">
                <div className="text-trade-amber font-bold">--color-amber (#F59E0B)</div>
                <div className="text-content-secondary">Degraded State / Warning</div>
              </div>
            </div>
          </section>
        )}

        {/* 2. Button Primitives Matrix */}
        {(activeTab === "all" || activeTab === "buttons") && (
          <section className="space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-content-muted">
              2. Button Primitives (Variants, Sizes & States)
            </h2>
            <div className="p-5 rounded-lg bg-surface-panel border border-line-default space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="buy" size="md" leftIcon={<ArrowUpRight className="w-4 h-4" />}>
                  Buy / Long
                </Button>
                <Button variant="sell" size="md" leftIcon={<ArrowDownRight className="w-4 h-4" />}>
                  Sell / Short
                </Button>
                <Button variant="primary" size="md">
                  Primary Action
                </Button>
                <Button variant="secondary" size="md">
                  Secondary Action
                </Button>
                <Button variant="ghost" size="md">
                  Ghost Action
                </Button>
                <Button variant="destructive" size="md">
                  Cancel All
                </Button>
                <Button variant="outline" size="md">
                  Outline
                </Button>
                <Button variant="primary" size="md" isLoading>
                  Loading State
                </Button>
                <Button variant="buy" size="md" disabled>
                  Disabled
                </Button>
              </div>

              {/* Sizes */}
              <div className="flex items-center gap-3 pt-3 border-t border-line-subtle">
                <Button variant="primary" size="xs">XS (24px)</Button>
                <Button variant="primary" size="sm">SM (28px)</Button>
                <Button variant="primary" size="md">MD (36px)</Button>
                <Button variant="primary" size="lg">LG (44px)</Button>
              </div>

              {/* Badges */}
              <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-line-subtle">
                <Badge variant="emerald">LONG 10x</Badge>
                <Badge variant="coral">SHORT 20x</Badge>
                <Badge variant="cyan">BATCH #319700</Badge>
                <Badge variant="amber">KEEPER DELAY</Badge>
                <Badge variant="default">DEVNET</Badge>
                <Badge variant="outline">REDUCE_ONLY</Badge>
              </div>
            </div>
          </section>
        )}

        {/* 3. Input & Form Primitives */}
        {(activeTab === "all" || activeTab === "inputs") && (
          <section className="space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-content-muted">
              3. Input & Numeric Steppers
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-5 rounded-lg bg-surface-panel border border-line-default">
              <Input
                label="Limit Price (USDC)"
                subLabel="Oracle $119.58"
                isNumeric
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onStepUp={() => setInputVal((prev) => (parseFloat(prev || "0") + 0.05).toFixed(2))}
                onStepDown={() => setInputVal((prev) => (parseFloat(prev || "0") - 0.05).toFixed(2))}
                rightAdornment={<span className="text-2xs font-mono text-content-muted">USDC</span>}
              />
              <Input
                label="Order Size (SOL)"
                subLabel="Avail: 50.00 SOL"
                isNumeric
                defaultValue="2.50"
                rightAdornment={<span className="text-2xs font-mono text-content-muted">SOL</span>}
              />
              <Input
                label="Collar Validation Input"
                isNumeric
                value={inputVal}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setInputVal(e.target.value);
                  if (v > 125 || v < 114) {
                    setInputError("Price exceeds ±50 bps collar band around oracle");
                  } else {
                    setInputError(null);
                  }
                }}
                error={inputError}
                rightAdornment={<span className="text-2xs font-mono text-content-muted">USDC</span>}
              />
            </div>
          </section>
        )}

        {/* 4. Dropdown, Tooltip & Modal Controls */}
        {(activeTab === "all" || activeTab === "inputs") && (
          <section className="space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-content-muted">
              4. Dropdown, Popover & Tooltip Primitives
            </h2>
            <div className="flex flex-wrap items-center gap-4 p-5 rounded-lg bg-surface-panel border border-line-default">
              <Dropdown label="Select Market" items={dropdownItems} />
              <Tooltip content="Orders match uniformly within ±50 bps collar at batch close">
                <Button variant="secondary" size="sm">
                  Hover for Mechanism Tooltip
                </Button>
              </Tooltip>
              <Button variant="outline" size="sm" onClick={() => setIsModalOpen(true)}>
                Open Accessible Modal
              </Button>
            </div>
          </section>
        )}

        {/* 5. Table & Tabular Ledger */}
        {(activeTab === "all" || activeTab === "tables") && (
          <section className="space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-content-muted">
              5. High-Density Institutional Table Primitive
            </h2>
            <div className="rounded-lg bg-surface-panel border border-line-default overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Market</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead alignRight>Size Lots</TableHead>
                    <TableHead alignRight>Entry Price</TableHead>
                    <TableHead alignRight>Mark Price</TableHead>
                    <TableHead alignRight>Liq Price</TableHead>
                    <TableHead alignRight>Unrealized PnL</TableHead>
                    <TableHead alignRight>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-semibold text-content-primary">SOL-PERP</TableCell>
                    <TableCell>
                      <Badge variant="emerald" size="xs">LONG</Badge>
                    </TableCell>
                    <TableCell alignRight isMono>1,000</TableCell>
                    <TableCell alignRight isMono>$119.20</TableCell>
                    <TableCell alignRight isMono>$119.60</TableCell>
                    <TableCell alignRight isMono className="text-trade-amber">$108.40</TableCell>
                    <TableCell alignRight isMono className="text-trade-emerald font-semibold">
                      +$40.00 (+3.35%)
                    </TableCell>
                    <TableCell alignRight>
                      <Button variant="destructive" size="xs">
                        Close
                      </Button>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-semibold text-content-primary">BTC-PERP</TableCell>
                    <TableCell>
                      <Badge variant="coral" size="xs">SHORT</Badge>
                    </TableCell>
                    <TableCell alignRight isMono>500</TableCell>
                    <TableCell alignRight isMono>$68,450.00</TableCell>
                    <TableCell alignRight isMono>$68,210.00</TableCell>
                    <TableCell alignRight isMono className="text-trade-amber">$74,800.00</TableCell>
                    <TableCell alignRight isMono className="text-trade-emerald font-semibold">
                      +$120.00 (+1.75%)
                    </TableCell>
                    <TableCell alignRight>
                      <Button variant="destructive" size="xs">
                        Close
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </section>
        )}

        {/* Modal Dialog */}
        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title="Institutional Collateral Deposit"
          description="Direct on-chain SPL token vault transfer"
          footer={
            <>
              <Button variant="secondary" size="sm" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setIsModalOpen(false);
                  showToast({
                    type: "success",
                    title: "Transaction Confirmed",
                    description: "Deposit instruction executed and confirmed on-chain.",
                  });
                }}
              >
                Confirm Deposit
              </Button>
            </>
          }
        >
          <div className="space-y-3 py-2">
            <Input
              label="Deposit Amount (USDC)"
              isNumeric
              defaultValue="500.00"
              rightAdornment={<span className="text-2xs font-mono text-content-muted">USDC</span>}
            />
            <div className="p-2.5 rounded bg-surface-card border border-line-subtle text-2xs space-y-1">
              <div className="flex justify-between text-content-muted">
                <span>Free Collateral:</span>
                <span className="font-mono text-content-primary">$1,250.00</span>
              </div>
              <div className="flex justify-between text-content-muted">
                <span>Post-Deposit Equity:</span>
                <span className="font-mono text-trade-emerald font-semibold">$1,750.00</span>
              </div>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
}
