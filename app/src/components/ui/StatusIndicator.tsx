"use client";

import React from "react";

export type StatusVariant =
  | "emerald"
  | "amber"
  | "coral"
  | "cyan"
  | "muted";

export interface StatusIndicatorProps {
  status: StatusVariant;
  label?: string;
  subLabel?: string;
  pulse?: boolean;
  size?: "xs" | "sm" | "md";
  className?: string;
  title?: string;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  status,
  label,
  subLabel,
  pulse = true,
  size = "sm",
  className = "",
  title,
}) => {
  const dotSizes = {
    xs: "w-1.5 h-1.5",
    sm: "w-2 h-2",
    md: "w-2.5 h-2.5",
  };

  const statusColors: Record<StatusVariant, { dot: string; glow: string; text: string }> = {
    emerald: {
      dot: "bg-trade-emerald",
      glow: "bg-trade-emerald/50",
      text: "text-trade-emerald",
    },
    amber: {
      dot: "bg-trade-amber",
      glow: "bg-trade-amber/50",
      text: "text-trade-amber",
    },
    coral: {
      dot: "bg-trade-coral",
      glow: "bg-trade-coral/50",
      text: "text-trade-coral",
    },
    cyan: {
      dot: "bg-trade-cyan",
      glow: "bg-trade-cyan/50",
      text: "text-trade-cyan",
    },
    muted: {
      dot: "bg-content-muted",
      glow: "bg-content-muted/30",
      text: "text-content-muted",
    },
  };

  const current = statusColors[status];

  return (
    <div
      className={`inline-flex items-center gap-1.5 font-sans select-none ${className}`}
      title={title}
    >
      <div className="relative flex items-center justify-center shrink-0">
        {pulse && status !== "muted" && (
          <span
            className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${current.glow}`}
          />
        )}
        <span
          className={`relative inline-flex rounded-full ${dotSizes[size]} ${current.dot}`}
        />
      </div>

      {(label || subLabel) && (
        <div className="flex items-center gap-1 text-xs">
          {label && (
            <span className={`font-semibold ${current.text}`}>{label}</span>
          )}
          {subLabel && (
            <span className="text-content-secondary font-normal">
              {subLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
