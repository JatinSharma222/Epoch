"use client";

import React from "react";

export type BadgeVariant =
  | "default"
  | "emerald"
  | "coral"
  | "cyan"
  | "amber"
  | "outline";

export type BadgeSize = "xs" | "sm" | "md";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  children: React.ReactNode;
  icon?: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = "default",
  size = "sm",
  children,
  icon,
  className = "",
  ...props
}) => {
  const sizeStyles: Record<BadgeSize, string> = {
    xs: "text-[9px] px-1 py-[0.5px] gap-0.5",
    sm: "text-2xs px-1.5 py-0.5 gap-1",
    md: "text-xs px-2 py-0.5 gap-1.5",
  };

  const variantStyles: Record<BadgeVariant, string> = {
    default:
      "bg-surface-elevated text-content-secondary border border-line-default font-medium",
    emerald:
      "bg-trade-emerald/10 text-trade-emerald border border-trade-emerald/30 font-semibold",
    coral:
      "bg-trade-coral/10 text-trade-coral border border-trade-coral/30 font-semibold",
    cyan: "bg-trade-cyan/10 text-trade-cyan border border-trade-cyan/30 font-semibold",
    amber:
      "bg-trade-amber/10 text-trade-amber border border-trade-amber/30 font-semibold",
    outline:
      "bg-transparent text-content-primary border border-line-default font-medium",
  };

  return (
    <span
      className={`inline-flex items-center rounded select-none font-sans whitespace-nowrap ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
    </span>
  );
};
