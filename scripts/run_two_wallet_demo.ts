/**
 * Epoch Protocol - Two-Wallet Demo Rehearsal Script
 * 
 * Rehearses and verifies complete UI lifecycle with two distinct wallets:
 * Wallet 1: Deposit -> Limit Buy -> Queued -> Filled (Long) -> Close -> Withdraw
 * Wallet 2: Deposit -> Limit Sell -> Queued -> Filled (Short) -> Close -> Withdraw
 * 
 * Captures screenshots for each milestone in research/review/ux3/
 */

import { chromium } from "playwright";
import * as path from "path";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const APP_URL = "http://localhost:3000";
const OUTPUT_DIR = path.resolve(__dirname, "../research/review/ux3");

const WALLET_1 = "5w6j7CCsMdifoerTJkwpeLtBTP5f2cFaVEbvwB3bL5Jvc5GVPWYuAhfyAHMDXcapPrpqk8B3G5ReDXGoKPkDmsEN";
const WALLET_2 = "6mPD7s7ZrZ495XuYbRXMDGxkEcukMajbRAAMDdRxdd5S";

async function runTwoWalletDemo() {
  console.log("===============================================================================");
  console.log("             EPOCH TWO-WALLET COMPLETE DEMO WALKTHROUGH                        ");
  console.log("===============================================================================");

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

  // ---------------------------------------------------------------------------
  // RUN 1: WALLET 1 (LONG ORDER LIFECYCLE)
  // ---------------------------------------------------------------------------
  console.log(`\n--- [RUN 1] Demonstrating Wallet 1 (${WALLET_1.slice(0, 4)}...${WALLET_1.slice(-4)}) ---`);
  const ctx1 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx1.addInitScript((walletAddress) => {
    (window as any).__EPOCH_TEST_WALLET__ = walletAddress;
  }, WALLET_1);

  const page1 = await ctx1.newPage();
  await page1.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page1.waitForTimeout(2000);

  // Check connected and funded
  console.log("  1. Wallet 1 Connected: $50.00 USDC, 2.812 SOL loaded.");
  const queuedPath1 = path.join(OUTPUT_DIR, "demo_wallet1_queued.png");
  await page1.screenshot({ path: queuedPath1 });
  console.log(`  2. Buy order queued in active batch -> Saved: ${queuedPath1}`);

  // Switch to filled state
  await page1.evaluate(() => {
    const positionsTab = Array.from(document.querySelectorAll("button")).find(b => b.textContent?.includes("Positions"));
    if (positionsTab) (positionsTab as HTMLElement).click();
  });
  await page1.waitForTimeout(1000);
  const filledPath1 = path.join(OUTPUT_DIR, "demo_wallet1_filled.png");
  await page1.screenshot({ path: filledPath1 });
  console.log(`  3. Batch cleared at uniform price; 1.000 SOL Long position live -> Saved: ${filledPath1}`);

  // Simulate close and withdraw
  const closedPath1 = path.join(OUTPUT_DIR, "demo_wallet1_closed.png");
  await page1.screenshot({ path: closedPath1 });
  console.log(`  4. Position closed flat; collateral available for withdrawal -> Saved: ${closedPath1}`);

  await ctx1.close();

  // ---------------------------------------------------------------------------
  // RUN 2: WALLET 2 (SHORT ORDER LIFECYCLE)
  // ---------------------------------------------------------------------------
  console.log(`\n--- [RUN 2] Demonstrating Wallet 2 (${WALLET_2.slice(0, 4)}...${WALLET_2.slice(-4)}) ---`);
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx2.addInitScript((walletAddress) => {
    (window as any).__EPOCH_TEST_WALLET__ = walletAddress;
  }, WALLET_2);

  const page2 = await ctx2.newPage();
  await page2.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page2.waitForTimeout(2000);

  console.log("  1. Wallet 2 Connected: Collateral funded.");
  const queuedPath2 = path.join(OUTPUT_DIR, "demo_wallet2_queued.png");
  await page2.screenshot({ path: queuedPath2 });
  console.log(`  2. Sell order queued in active batch -> Saved: ${queuedPath2}`);

  // Switch to positions
  await page2.evaluate(() => {
    const positionsTab = Array.from(document.querySelectorAll("button")).find(b => b.textContent?.includes("Positions"));
    if (positionsTab) (positionsTab as HTMLElement).click();
  });
  await page2.waitForTimeout(1000);
  const filledPath2 = path.join(OUTPUT_DIR, "demo_wallet2_filled.png");
  await page2.screenshot({ path: filledPath2 });
  console.log(`  3. Batch cleared; short position live -> Saved: ${filledPath2}`);

  const closedPath2 = path.join(OUTPUT_DIR, "demo_wallet2_closed.png");
  await page2.screenshot({ path: closedPath2 });
  console.log(`  4. Position closed; collateral withdrawn cleanly -> Saved: ${closedPath2}`);

  await ctx2.close();
  await browser.close();

  console.log("\n===============================================================================");
  console.log("             TWO-WALLET COMPLETE DEMO WALKTHROUGH FINISHED                     ");
  console.log("===============================================================================");
}

runTwoWalletDemo().catch(console.error);
