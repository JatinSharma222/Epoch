"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import {
  ArrowLeftRight,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  FileText,
  ShieldCheck,
  History,
  GitCompare,
} from "lucide-react";

interface SidebarProps {
  activeTab: "trade" | "batches" | "evidence" | "compare";
  onSelectTab: (tab: "trade" | "batches" | "evidence" | "compare") => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
}) => {
  // 09 §3.5 rule 9: Sidebar icon-only by default below 1440px
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setCollapsed(window.innerWidth < 1440);
      const handleResize = () => {
        if (window.innerWidth < 1440) {
          setCollapsed(true);
        }
      };
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }
  }, []);

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
          title="Epoch Protocol"
        >
          <div className="w-6 h-6 rounded-md bg-[#e54040] flex items-center justify-center shadow-sm shrink-0 overflow-hidden">
            <Image src="/logo.png" alt="Epoch" width={24} height={24} className="object-cover" />
          </div>
          {!collapsed && (
            <span className="font-bold text-[15px] text-white tracking-tight">
              Epoch
            </span>
          )}
        </a>

        {/* Main Navigation (09 §3.5 rule 8: 'Home' removed as it duplicates Trade) */}
        <nav className="space-y-0.5">
          {/* Trade */}
          <button
            onClick={() => onSelectTab("trade")}
            title="Trade"
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
            title="Batch Log"
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
            title="Evidence"
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
            title="Compare"
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

          {/* Tools Section */}
          {!collapsed ? (
            <div className="pt-3">
              <div className="px-2.5 pb-1 text-[11px] font-semibold text-[#848e9c] flex items-center gap-1.5">
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Tools</span>
              </div>
              <div className="space-y-0.5 text-[11px] pl-2">
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
          ) : (
            <div className="pt-3 border-t bp-border flex justify-center">
              <a
                href="https://github.com/JatinSharma222/Epoch"
                target="_blank"
                rel="noopener noreferrer"
                title="Documentation"
                className="p-1.5 text-[#848e9c] hover:text-white rounded transition-colors"
              >
                <FileText className="w-4 h-4" />
              </a>
            </div>
          )}
        </nav>
      </div>

      {/* Bottom: Collapse Button */}
      <div className="flex flex-col gap-0.5 border-t bp-border pt-2 text-[#848e9c]">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:text-white hover:bg-[#161b22] text-[11px] w-full text-left transition-colors"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
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
