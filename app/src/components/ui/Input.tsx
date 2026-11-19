"use client";

import React, { forwardRef } from "react";
import { AlertCircle } from "lucide-react";

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  subLabel?: string;
  leftAdornment?: React.ReactNode;
  rightAdornment?: React.ReactNode;
  error?: string | null;
  sizeVariant?: "sm" | "md" | "lg";
  isNumeric?: boolean;
  onStepUp?: () => void;
  onStepDown?: () => void;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      subLabel,
      leftAdornment,
      rightAdornment,
      error,
      sizeVariant = "md",
      isNumeric = false,
      disabled = false,
      onStepUp,
      onStepDown,
      className = "",
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

    const sizeContainerStyles = {
      sm: "h-7 text-xs px-2",
      md: "h-9 text-sm px-2.5",
      lg: "h-11 text-base px-3",
    };

    const hasError = Boolean(error);

    return (
      <div className="w-full flex flex-col gap-1 font-sans">
        {(label || subLabel) && (
          <div className="flex items-center justify-between text-2xs font-medium">
            {label && (
              <label
                htmlFor={inputId}
                className="text-content-secondary select-none"
              >
                {label}
              </label>
            )}
            {subLabel && (
              <span className="text-content-muted tabular-nums select-none">
                {subLabel}
              </span>
            )}
          </div>
        )}

        <div
          className={`relative flex items-center bg-surface-card rounded border transition-all duration-150 ${
            hasError
              ? "border-trade-coral/60 focus-within:border-trade-coral focus-within:ring-1 focus-within:ring-trade-coral"
              : "border-line-default focus-within:border-line-strong focus-within:ring-1 focus-within:ring-trade-cyan"
          } ${
            disabled
              ? "opacity-50 cursor-not-allowed bg-surface-panel"
              : "hover:border-line-strong"
          } ${sizeContainerStyles[sizeVariant]}`}
        >
          {leftAdornment && (
            <div className="flex items-center text-content-muted mr-1.5 shrink-0 select-none">
              {leftAdornment}
            </div>
          )}

          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            className={`w-full bg-transparent text-content-primary placeholder-content-disabled font-medium focus:outline-none disabled:cursor-not-allowed ${
              isNumeric ? "font-mono tabular-nums text-right" : ""
            } ${className}`}
            aria-invalid={hasError}
            aria-describedby={hasError && inputId ? `${inputId}-error` : undefined}
            {...props}
          />

          {(onStepUp || onStepDown) && (
            <div className="flex flex-col ml-1 shrink-0 border-l border-line-subtle pl-1 select-none">
              {onStepUp && (
                <button
                  type="button"
                  tabIndex={-1}
                  disabled={disabled}
                  onClick={onStepUp}
                  className="text-content-muted hover:text-content-primary p-0.5 text-[8px] leading-none transition-colors"
                  aria-label="Increment"
                >
                  ▲
                </button>
              )}
              {onStepDown && (
                <button
                  type="button"
                  tabIndex={-1}
                  disabled={disabled}
                  onClick={onStepDown}
                  className="text-content-muted hover:text-content-primary p-0.5 text-[8px] leading-none transition-colors"
                  aria-label="Decrement"
                >
                  ▼
                </button>
              )}
            </div>
          )}

          {rightAdornment && (
            <div className="flex items-center text-content-secondary ml-2 shrink-0 select-none">
              {rightAdornment}
            </div>
          )}
        </div>

        {hasError && (
          <div
            id={inputId ? `${inputId}-error` : undefined}
            className="flex items-center gap-1 text-2xs text-trade-coral font-medium mt-0.5 animate-scale-in"
            role="alert"
          >
            <AlertCircle className="w-3 h-3 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
