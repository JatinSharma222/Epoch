"use client";

import React, { useState } from "react";
import Image from "next/image";
import {
  Home,
  ArrowLeftRight,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Coins,
  FileText,
  ShieldCheck,
  History,
  GitCompare,
} from "lucide-react";

interface SidebarProps {
  activeTab: "trade" | "batches" | "evidence" | "compare";
  onSelectTab: (tab: "trade" | "batches" | "evidence" | "compare") => void;
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
        collapsed ? "w-[56px]" : "w-[180px]"
      } hidden md:flex flex-col justify-between bg-[#0e1217] border-r bp-border shrink-0 py-2.5 px-2 z-30 transition-all duration-200 select-none`}
    >
      <div className="flex flex-col gap-0.5 w-full">
        {/* Epoch Brand Logo */}
        <a
          href="#"
          className="flex items-center gap-2.5 px-2.5 py-1.5 mb-2 hover:opacity-90 transition-opacity"
          onClick={(e) => { e.preventDefault(); onSelectTab("trade"); }}
        >
          <div className="w-6 h-6 rounded-md bg-[#e54040] flex items-center justify-center shadow-sm shrink-0 overflow-hidden">
            <Image src="/logo.png" alt="E" width={24} height={24} className="object-cover" />
          </div>
          {!collapsed && (
            <span className="font-bold text-[15px] text-white tracking-tight">
              Epoch
            </span>
          )}
        </a>

        {/* Main Navigation */}
        <nav className="space-y-0.5">
          {/* Home (navigates to trade) */}
          <button
            onClick={() => onSelectTab("trade")}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[#848e9c] hover:text-white hover:bg-[#161b22] transition-colors text-[12px] font-medium"
          >
            <Home className="w-4 h-4 shrink-0" />
            {!collapsed && <span>Home</span>}
          </button>

          {/* Trade */}
          <button
            onClick={() => onSelectTab("trade")}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12px] transition-colors ${
              activeTab === "trade"
                ? "text-white bg-[#181d24] font-semibold border-l-2 border-[#e54040] shadow-sm"
                : "text-[#848e9c] hover:text-white hover:bg-[#161b22] font-medium"
            }`}
          >
            <ArrowLeftRight
              className={`w-4 h-4 shrink-0 ${
                activeTab === "trade" ? "text-[#e54040]" : ""
              }`}
            />
            {!collapsed && <span>Trade</span>}
          </button>

          {/* Batch Log */}
          <button
            onClick={() => onSelectTab("batches")}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12px] transition-colors ${
              activeTab === "batches"
                ? "text-white bg-[#181d24] font-semibold border-l-2 border-[#e54040] shadow-sm"
                : "text-[#848e9c] hover:text-white hover:bg-[#161b22] font-medium"
            }`}
          >
            <History
              className={`w-4 h-4 shrink-0 ${
                activeTab === "batches" ? "text-[#e54040]" : ""
              }`}
            />
            {!collapsed && <span>Batch Log</span>}
          </button>

          {/* Evidence */}
          <button
            onClick={() => onSelectTab("evidence")}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12px] transition-colors ${
              activeTab === "evidence"
                ? "text-white bg-[#181d24] font-semibold border-l-2 border-[#e54040] shadow-sm"
                : "text-[#848e9c] hover:text-white hover:bg-[#161b22] font-medium"
            }`}
          >
            <ShieldCheck
              className={`w-4 h-4 shrink-0 ${
                activeTab === "evidence" ? "text-[#e54040]" : ""
              }`}
            />
            {!collapsed && <span>Evidence</span>}
          </button>

          {/* Compare (Task T-19) */}
          <button
            onClick={() => onSelectTab("compare")}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12px] transition-colors ${
              activeTab === "compare"
                ? "text-white bg-[#181d24] font-semibold border-l-2 border-[#e54040] shadow-sm"
                : "text-[#848e9c] hover:text-white hover:bg-[#161b22] font-medium"
            }`}
          >
            <GitCompare
              className={`w-4 h-4 shrink-0 ${
                activeTab === "compare" ? "text-[#e54040]" : ""
              }`}
            />
            {!collapsed && <span>Compare</span>}
          </button>

          {/* Tools Section Header */}
          {!collapsed && (
            <div className="pt-3">
              <div className="px-2.5 pb-1 text-[11px] font-semibold text-[#848e9c] flex items-center gap-1.5">
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Tools</span>
              </div>
              <div className="space-y-0.5 text-[11px] pl-2">
                <button
                  onClick={onOpenFaucetModal}
                  className="w-full flex items-center gap-2 px-2 py-1 text-[#848e9c] hover:text-white rounded transition-colors text-left"
                >
                  <Coins className="w-3 h-3 shrink-0 text-[#eab308]" />
                  <span>Faucet</span>
                </button>
                <a
                  href="https://github.com/JatinSharma222/Epoch"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-2 py-1 text-[#848e9c] hover:text-white rounded transition-colors"
                >
                  <FileText className="w-3 h-3 shrink-0" />
                  <span>Docs</span>
                </a>
              </div>
            </div>
          )}
        </nav>
      </div>

      {/* Bottom: Collapse & Support */}
      <div className="flex flex-col gap-0.5 border-t bp-border pt-2 text-[#848e9c]">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:text-white hover:bg-[#161b22] text-[11px] w-full text-left transition-colors"
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
        {!collapsed && (
          <button className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:text-white hover:bg-[#161b22] text-[11px] w-full text-left transition-colors">
            <MessageCircle className="w-4 h-4 shrink-0" />
            <span>Support</span>
          </button>
        )}
      </div>
    </aside>
  );
};
