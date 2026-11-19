"use client";

import React, { forwardRef } from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "destructive"
  | "buy"
  | "sell"
  | "outline";

export type ButtonSize = "xs" | "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = "primary",
      size = "md",
      isLoading = false,
      disabled = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      className = "",
      type = "button",
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "relative inline-flex items-center justify-center font-sans font-semibold transition-all duration-150 select-none rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-surface-canvas focus-visible:ring-trade-cyan disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]";

    const sizeStyles: Record<ButtonSize, string> = {
      xs: "h-6 px-2 text-2xs gap-1",
      sm: "h-7 px-2.5 text-xs gap-1.5",
      md: "h-9 px-3.5 text-sm gap-2",
      lg: "h-11 px-5 text-base gap-2.5",
    };

    const variantStyles: Record<ButtonVariant, string> = {
      primary:
        "bg-trade-cyan text-surface-canvas hover:bg-trade-cyan-hover font-bold shadow-sm disabled:hover:bg-trade-cyan",
      secondary:
        "bg-surface-elevated text-content-primary hover:bg-surface-hover border border-line-default hover:border-line-strong disabled:hover:bg-surface-elevated",
      ghost:
        "bg-transparent text-content-secondary hover:text-content-primary hover:bg-surface-hover/60 border border-transparent disabled:hover:bg-transparent",
      destructive:
        "bg-trade-coral/20 text-trade-coral hover:bg-trade-coral/30 border border-trade-coral/40 disabled:hover:bg-trade-coral/20",
      buy: "bg-trade-emerald text-surface-canvas hover:bg-trade-emerald-hover font-bold shadow-sm disabled:hover:bg-trade-emerald",
      sell: "bg-trade-coral text-surface-canvas hover:bg-trade-coral-hover font-bold shadow-sm disabled:hover:bg-trade-coral",
      outline:
        "bg-transparent text-content-primary border border-line-default hover:border-line-strong hover:bg-surface-card",
    };

    const widthStyle = fullWidth ? "w-full" : "";
    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${widthStyle} ${className}`}
        aria-busy={isLoading}
        {...props}
      >
        {isLoading && (
          <Loader2
            className={`animate-spin shrink-0 ${
              size === "xs"
                ? "w-3 h-3"
                : size === "sm"
                ? "w-3.5 h-3.5"
                : "w-4 h-4"
            }`}
          />
        )}
        {!isLoading && leftIcon && <span className="shrink-0">{leftIcon}</span>}
        <span className="truncate">{children}</span>
        {!isLoading && rightIcon && (
          <span className="shrink-0">{rightIcon}</span>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";
