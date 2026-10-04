// Global financial number formatters enforcing Intl.NumberFormat('en-US')
// Compliant with 09-UX_SPEC.md §8.1 and Test UX-14 (standard thousand grouping, no Indian lakhs)

/**
 * Standard number formatting with en-US grouping (e.g. 11,354,172.58)
 */
export function formatNumber(val: number, decimals: number = 2): string {
  if (isNaN(val) || !isFinite(val)) return "0.00";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: true,
  }).format(val);
}

/**
 * Standard USD currency format (e.g. $11,354,172.58)
 */
export function formatUsd(val: number, decimals: number = 2): string {
  if (isNaN(val) || !isFinite(val)) return "$0.00";
  return `$${formatNumber(val, decimals)}`;
}

/**
 * Compact USD for high-level header statistics (e.g. $11.4M, $34.0M)
 */
export function formatCompactUsd(val: number): string {
  if (isNaN(val) || !isFinite(val)) return "$0.00";
  return `$${new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(val)}`;
}

/**
 * Oracle mark price formatting (4 fixed decimals per 09 §8.1 table)
 */
export function formatOracle(val: number): string {
  return formatUsd(val, 4);
}

/**
 * Standard percentage formatting (e.g. +2.45% or -1.86%)
 */
export function formatPercent(
  val: number,
  decimals: number = 2,
  includeSign: boolean = true
): string {
  if (isNaN(val) || !isFinite(val)) return "0.00%";
  const sign = includeSign && val > 0 ? "+" : "";
  return `${sign}${formatNumber(val, decimals)}%`;
}

/**
 * 8-hour funding rate formatting (4 decimals per §8.1)
 */
export function formatFundingRate(val: number): string {
  const sign = val > 0 ? "+" : "";
  return `${sign}${formatNumber(val, 4)}%/8h`;
}

/**
 * Lot formatting (e.g. 1,420 lots)
 */
export function formatLots(lots: number): string {
  return `${new Intl.NumberFormat("en-US").format(lots)} lots`;
}
