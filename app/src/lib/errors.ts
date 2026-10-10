/**
 * User-friendly transaction error parser for Epoch protocol orders.
 * Compliant with Round 14 requirements:
 * - 6007: Ring buffer busy
 * - 6008: "Missed the batch, nothing was filled, retry"
 * - Never shows "Unknown action 'undefined'"
 */

export function parseOrderError(err: any): string {
  if (!err) return "Order failed, please retry.";

  let errStr = "";
  if (typeof err === "string") {
    errStr = err;
  } else {
    if (err.message) errStr += err.message + " ";
    if (err.transactionMessage) errStr += err.transactionMessage + " ";
    if (Array.isArray(err.logs)) errStr += err.logs.join(" ") + " ";
    if (Array.isArray(err.transactionLogs)) errStr += err.transactionLogs.join(" ") + " ";
    if (err.toString && typeof err.toString === "function") errStr += err.toString() + " ";
  }

  // 1. Specific Epoch program errors (checked by code and name)
  if (
    errStr.includes("6008") ||
    errStr.includes("BatchClosed") ||
    errStr.includes("0x1778")
  ) {
    return "Missed the batch, nothing was filled, retry";
  }

  if (
    errStr.includes("6007") ||
    errStr.includes("RingSlotBusy") ||
    errStr.includes("0x1777")
  ) {
    return "Ring buffer busy: previous batch still clearing, please retry";
  }

  if (
    errStr.includes("6010") ||
    errStr.includes("BatchInPast") ||
    errStr.includes("0x177a")
  ) {
    return "Missed the batch, nothing was filled, retry";
  }

  if (
    errStr.includes("6009") ||
    errStr.includes("BatchTooFarAhead") ||
    errStr.includes("0x1779")
  ) {
    return "Target batch is too far in the future, please retry";
  }

  if (
    errStr.includes("6003") ||
    errStr.includes("InsufficientCollateral") ||
    errStr.includes("0x1773")
  ) {
    return "Insufficient margin to place order. Deposit collateral to continue.";
  }

  if (
    errStr.includes("6000") ||
    errStr.includes("UserNotInitialized") ||
    errStr.includes("0x1770")
  ) {
    return "Account not initialized. Please deposit collateral first.";
  }

  if (
    errStr.includes("6005") ||
    errStr.includes("BatchFull") ||
    errStr.includes("0x1775")
  ) {
    return "Batch is full (128 orders reached). Please retry next batch.";
  }

  if (
    errStr.includes("User rejected") ||
    errStr.includes("Transaction cancelled") ||
    errStr.includes("rejected the request")
  ) {
    return "Transaction was cancelled in wallet.";
  }

  if (
    errStr.includes("Attempt to debit an account but found no record of a prior credit") ||
    errStr.includes("insufficient lamports")
  ) {
    return "Insufficient SOL for transaction fees. Use faucet to fund your wallet.";
  }

  // 2. Filter out raw library / web3 artifacts — NEVER show "Unknown action 'undefined'"
  if (
    errStr.includes("Unknown action") ||
    errStr.includes("undefined") ||
    errStr.includes("[object Object]")
  ) {
    return "Order simulation failed: batch state changed in flight. Please retry.";
  }

  // 3. Clean up Anchor Error Message if present
  const anchorMatch = errStr.match(/Error Message:\s*([^\n\r.]+)/);
  if (anchorMatch && anchorMatch[1]) {
    return `${anchorMatch[1].trim()}. Please retry.`;
  }

  // 4. Default clean fallback
  return err.message && !err.message.includes("Unknown action")
    ? err.message
    : "Order placement failed. Please retry.";
}
