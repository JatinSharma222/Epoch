"use client";

import React, { useRef, useEffect } from "react";

export interface TabItem {
  id: string;
  label: React.ReactNode;
  count?: number;
  badge?: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  variant?: "underline" | "segmented" | "pills";
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
}

export const Tabs: React.FC<TabsProps> = ({
  items,
  activeId,
  onChange,
  variant = "underline",
  size = "md",
  className = "",
  ariaLabel = "Tabs",
}) => {
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Keyboard navigation across tabs (ArrowLeft, ArrowRight, Home, End)
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    const enabledItems = items.filter((item) => !item.disabled);
    const currentIndex = enabledItems.findIndex((item) => item.id === activeId);

    let nextIndex = -1;
    if (e.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % enabledItems.length;
    } else if (e.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + enabledItems.length) % enabledItems.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = enabledItems.length - 1;
    }

    if (nextIndex >= 0) {
      e.preventDefault();
      const nextTab = enabledItems[nextIndex];
      onChange(nextTab.id);
      tabRefs.current.get(nextTab.id)?.focus();
    }
  };

  const containerStyles = {
    underline: "flex items-center gap-1 border-b border-line-default",
    segmented:
      "inline-flex items-center p-0.5 rounded bg-surface-panel border border-line-default",
    pills: "flex items-center gap-1.5",
  };

  const sizeTextStyles = {
    sm: "text-2xs py-1 px-2",
    md: "text-xs py-1.5 px-3",
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`${containerStyles[variant]} ${className} select-none`}
    >
      {items.map((item, idx) => {
        const isActive = item.id === activeId;

        let itemStyle = "";
        if (variant === "underline") {
          itemStyle = isActive
            ? "text-content-primary font-semibold border-b-2 border-trade-cyan -mb-[1px]"
            : "text-content-secondary hover:text-content-primary hover:border-b-2 hover:border-line-strong font-medium -mb-[1px]";
        } else if (variant === "segmented") {
          itemStyle = isActive
            ? "bg-surface-elevated text-content-primary font-semibold rounded shadow-sm"
            : "text-content-secondary hover:text-content-primary font-medium rounded";
        } else if (variant === "pills") {
          itemStyle = isActive
            ? "bg-trade-cyan/15 text-trade-cyan border border-trade-cyan/30 font-semibold rounded"
            : "bg-surface-card text-content-secondary hover:text-content-primary border border-line-default hover:border-line-strong font-medium rounded";
        }

        return (
          <button
            key={item.id}
            ref={(el) => {
              if (el) tabRefs.current.set(item.id, el);
              else tabRefs.current.delete(item.id);
            }}
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${item.id}`}
            id={`tab-${item.id}`}
            tabIndex={isActive ? 0 : -1}
            disabled={item.disabled}
            onClick={() => !item.disabled && onChange(item.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`flex items-center gap-1.5 transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-trade-cyan disabled:opacity-40 disabled:cursor-not-allowed ${sizeTextStyles[size]} ${itemStyle}`}
          >
            <span>{item.label}</span>
            {item.count !== undefined && item.count > 0 && (
              <span
                className={`text-[9px] px-1 py-[0.5px] rounded-full font-mono font-bold leading-none ${
                  isActive
                    ? "bg-trade-cyan text-surface-canvas"
                    : "bg-surface-hover text-content-muted"
                }`}
              >
                {item.count}
              </span>
            )}
            {item.badge}
          </button>
        );
      })}
    </div>
  );
};
