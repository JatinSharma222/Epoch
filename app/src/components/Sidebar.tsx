"use client";

import React, { useState } from "react";
import {
  TrendingUp,
  History,
  FileText,
  Coins,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";

interface SidebarProps {
  activeTab: "trade" | "batches" | "evidence";
  onSelectTab: (tab: "trade" | "batches" | "evidence") => void;
  onOpenFaucetModal: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  onOpenFaucetModal,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`${
        collapsed ? "w-[56px]" : "w-[170px]"
      } hidden md:flex flex-col justify-between bg-[#0e1217] border-r bp-border shrink-0 py-2.5 px-2 z-30 transition-all duration-200 select-none`}
    >
      <div className="flex flex-col gap-1 w-full">
        {/* Navigation List */}
        <nav className="space-y-1">
          {/* Trade Tab */}
          <button
            onClick={() => onSelectTab("trade")}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              activeTab === "trade"
                ? "text-white bg-[#181d24] font-semibold border-l-2 border-[#e54040] shadow-sm"
                : "text-[#848e9c] hover:text-white hover:bg-[#161b22]"
            }`}
          >
            <TrendingUp
              className={`w-4 h-4 shrink-0 ${
                activeTab === "trade" ? "text-[#e54040]" : "text-[#848e9c]"
              }`}
            />
            {!collapsed && <span>Trade</span>}
          </button>

          {/* Batches Tab */}
          <button
            onClick={() => onSelectTab("batches")}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              activeTab === "batches"
                ? "text-white bg-[#181d24] font-semibold border-l-2 border-[#e54040] shadow-sm"
                : "text-[#848e9c] hover:text-white hover:bg-[#161b22]"
            }`}
          >
            <History
              className={`w-4 h-4 shrink-0 ${
                activeTab === "batches" ? "text-[#e54040]" : "text-[#848e9c]"
              }`}
            />
            {!collapsed && <span>Batch Log</span>}
          </button>

          {/* Evidence Tab */}
          <button
            onClick={() => onSelectTab("evidence")}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              activeTab === "evidence"
                ? "text-white bg-[#181d24] font-semibold border-l-2 border-[#e54040] shadow-sm"
                : "text-[#848e9c] hover:text-white hover:bg-[#161b22]"
            }`}
          >
            <ShieldCheck
              className={`w-4 h-4 shrink-0 ${
                activeTab === "evidence" ? "text-[#e54040]" : "text-[#848e9c]"
              }`}
            />
            {!collapsed && <span>Evidence</span>}
          </button>

          {/* Faucet Trigger */}
          <button
            onClick={onOpenFaucetModal}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium text-[#848e9c] hover:text-white hover:bg-[#161b22] transition-colors"
          >
            <Coins className="w-4 h-4 shrink-0 text-[#eab308]" />
            {!collapsed && <span>Faucet</span>}
          </button>

          {/* Documentation Link */}
          <a
            href="https://github.com/JatinSharma222/Epoch"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium text-[#848e9c] hover:text-white hover:bg-[#161b22] transition-colors"
          >
            <FileText className="w-4 h-4 shrink-0" />
            {!collapsed && <span>Docs</span>}
          </a>
        </nav>
      </div>

      {/* Collapse Toggle */}
      <div className="border-t bp-border pt-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:text-white hover:bg-[#161b22] text-[11px] text-[#848e9c] w-full text-left transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4 shrink-0" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4 shrink-0" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
};
