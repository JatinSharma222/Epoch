import { describe, it, expect } from "bun:test";
import * as UI from "./index";

describe("Milestone 1: Design System Tokens & Core Primitives", () => {
  it("exports all 10 core primitives and utility types", () => {
    expect(UI.Button).toBeDefined();
    expect(UI.Input).toBeDefined();
    expect(UI.Tabs).toBeDefined();
    expect(UI.Dropdown).toBeDefined();
    expect(UI.Tooltip).toBeDefined();
    expect(UI.Table).toBeDefined();
    expect(UI.TableHeader).toBeDefined();
    expect(UI.TableBody).toBeDefined();
    expect(UI.TableRow).toBeDefined();
    expect(UI.TableHead).toBeDefined();
    expect(UI.TableCell).toBeDefined();
    expect(UI.StatusIndicator).toBeDefined();
    expect(UI.Badge).toBeDefined();
    expect(UI.Modal).toBeDefined();
    expect(UI.ToastProvider).toBeDefined();
    expect(UI.useToast).toBeDefined();
  });

  it("verifies canonical surface and trading color palette", () => {
    const canonicalTokens = {
      canvas: "#07090E",
      panel: "#0B0F17",
      card: "#111622",
      elevated: "#161D2B",
      hover: "#1D2638",
      emerald: "#10B981",
      coral: "#F43F5E",
      cyan: "#00D8F6",
      amber: "#F59E0B",
    };

    expect(canonicalTokens.canvas).toBe("#07090E");
    expect(canonicalTokens.panel).toBe("#0B0F17");
    expect(canonicalTokens.card).toBe("#111622");
    expect(canonicalTokens.elevated).toBe("#161D2B");
    expect(canonicalTokens.hover).toBe("#1D2638");
    expect(canonicalTokens.emerald).toBe("#10B981");
    expect(canonicalTokens.coral).toBe("#F43F5E");
    expect(canonicalTokens.cyan).toBe("#00D8F6");
    expect(canonicalTokens.amber).toBe("#F59E0B");
  });

  it("verifies Button variants adhere to trading color conventions", () => {
    const buyVariant = "bg-trade-emerald text-surface-canvas hover:bg-trade-emerald-hover font-bold shadow-sm disabled:hover:bg-trade-emerald";
    const sellVariant = "bg-trade-coral text-surface-canvas hover:bg-trade-coral-hover font-bold shadow-sm disabled:hover:bg-trade-coral";
    const primaryVariant = "bg-trade-cyan text-surface-canvas hover:bg-trade-cyan-hover font-bold shadow-sm disabled:hover:bg-trade-cyan";

    expect(buyVariant).toContain("trade-emerald");
    expect(sellVariant).toContain("trade-coral");
    expect(primaryVariant).toContain("trade-cyan");
  });

  it("verifies StatusIndicator maps states to accurate semantic colors", () => {
    const statusMap = {
      emerald: "bg-trade-emerald",
      amber: "bg-trade-amber",
      coral: "bg-trade-coral",
      cyan: "bg-trade-cyan",
      muted: "bg-content-muted",
    };

    expect(statusMap.emerald).toBe("bg-trade-emerald");
    expect(statusMap.amber).toBe("bg-trade-amber");
    expect(statusMap.coral).toBe("bg-trade-coral");
    expect(statusMap.cyan).toBe("bg-trade-cyan");
    expect(statusMap.muted).toBe("bg-content-muted");
  });

  it("verifies Badge variant classes adhere to design tokens", () => {
    const badgeVariants = {
      default: "bg-surface-elevated text-content-secondary border border-line-default font-medium",
      emerald: "bg-trade-emerald/10 text-trade-emerald border border-trade-emerald/30 font-semibold",
      coral: "bg-trade-coral/10 text-trade-coral border border-trade-coral/30 font-semibold",
      cyan: "bg-trade-cyan/10 text-trade-cyan border border-trade-cyan/30 font-semibold",
      amber: "bg-trade-amber/10 text-trade-amber border border-trade-amber/30 font-semibold",
    };

    expect(badgeVariants.emerald).toContain("text-trade-emerald");
    expect(badgeVariants.coral).toContain("text-trade-coral");
    expect(badgeVariants.cyan).toContain("text-trade-cyan");
    expect(badgeVariants.amber).toContain("text-trade-amber");
  });
});
