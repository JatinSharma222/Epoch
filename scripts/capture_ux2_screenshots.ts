import puppeteer from "puppeteer-core";
import * as path from "path";
import * as fs from "fs";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUTPUT_DIR = path.resolve(__dirname, "../research/review/ux2");

async function capture() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log("Launching Chrome from:", CHROME_PATH);
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded", timeout: 15000 });
  await new Promise((r) => setTimeout(r, 2500));

  // 1. Terminal Idle (1440x900)
  console.log("Capturing 1: terminal_idle_1440x900.png...");
  await page.screenshot({
    path: path.join(OUTPUT_DIR, "terminal_idle_1440x900.png"),
  });

  // 2. Order Entered Outside Band (showing error and real unclamped offset)
  console.log("Capturing 2: order_outside_band_error_1440x900.png...");
  await page.evaluate(() => {
    // Find the price input
    const inputs = Array.from(document.querySelectorAll("input"));
    const priceInput = inputs.find((i) => i.placeholder === "0.00" || i.step === "0.01");
    if (priceInput) {
      priceInput.value = "110.00"; // Outside the ±0.50% collar band when oracle is ~$119
      priceInput.dispatchEvent(new Event("input", { bubbles: true }));
      priceInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(OUTPUT_DIR, "order_outside_band_error_1440x900.png"),
  });

  // Reset price input
  await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input"));
    const priceInput = inputs.find((i) => i.placeholder === "0.00" || i.step === "0.01");
    if (priceInput) {
      priceInput.value = "119.60";
      priceInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await new Promise((r) => setTimeout(r, 400));

  // 3. Market Selector Open (with search and logos)
  console.log("Capturing 3: market_selector_open_1440x900.png...");
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const marketBtn = buttons.find((b) => b.getAttribute("aria-label") === "Select market" || b.textContent?.includes("SOL-PERP"));
    marketBtn?.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(OUTPUT_DIR, "market_selector_open_1440x900.png"),
  });

  // Close Market Selector
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const marketBtn = buttons.find((b) => b.getAttribute("aria-label") === "Select market" || b.textContent?.includes("SOL-PERP"));
    marketBtn?.click();
  });
  await new Promise((r) => setTimeout(r, 400));

  // 4. Reference Strip Hovering
  console.log("Capturing 4: reference_strip_hover_1440x900.png...");
  await page.hover('[role="region"][aria-label="Reference Prices"]');
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({
    path: path.join(OUTPUT_DIR, "reference_strip_hover_1440x900.png"),
  });

  // 5. Evidence Page (dynamic from cu.json)
  console.log("Capturing 5: evidence_page_1440x900.png...");
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const evBtn = buttons.find((b) => b.textContent?.includes("Evidence"));
    evBtn?.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(OUTPUT_DIR, "evidence_page_1440x900.png"),
  });

  // 6. Batch Log with Sample Data Banner
  console.log("Capturing 6: batch_log_sample_banner_1440x900.png...");
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const batchBtn = buttons.find((b) => b.textContent?.includes("Batches"));
    batchBtn?.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(OUTPUT_DIR, "batch_log_sample_banner_1440x900.png"),
  });

  // 7. Mobile View (375x812)
  console.log("Capturing 7: mobile_view_375x812.png...");
  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
  // Back to Trade screen
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const tradeBtn = buttons.find((b) => b.textContent?.includes("Trade"));
    tradeBtn?.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(OUTPUT_DIR, "mobile_view_375x812.png"),
  });

  await browser.close();
  console.log("\nAll UX-2 screenshots successfully captured and saved to:", OUTPUT_DIR);
}

capture().catch((err) => {
  console.error("Screenshot capture error:", err);
  process.exit(1);
});
