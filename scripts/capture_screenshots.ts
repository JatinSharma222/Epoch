import puppeteer from "puppeteer-core";
import * as path from "path";
import * as fs from "fs";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUTPUT_DIR = path.resolve(__dirname, "../research/review/ux");

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

  const resolutions = [
    { width: 1440, height: 900, label: "1440x900" },
    { width: 1280, height: 720, label: "1280x720" },
  ];

  for (const res of resolutions) {
    console.log(`\nCapturing at resolution ${res.label}...`);
    const page = await browser.newPage();
    await page.setViewport({ width: res.width, height: res.height });
    await page.goto("http://localhost:3000", { waitUntil: "networkidle0" });

    // 1. Trade screen (wallet disconnected / idle)
    await page.screenshot({
      path: path.join(OUTPUT_DIR, `trade_idle_${res.label}.png`),
    });
    console.log(`Saved trade_idle_${res.label}.png`);

    // 2. Batches screen
    // Click on Batches tab in sidebar
    const batchesBtn = await page.waitForSelector('button:has-text("Batches"), [data-tab="batches"]', { timeout: 3000 }).catch(() => null);
    if (batchesBtn) {
      await batchesBtn.click();
      await new Promise((r) => setTimeout(r, 600));
      await page.screenshot({
        path: path.join(OUTPUT_DIR, `batches_${res.label}.png`),
      });
      console.log(`Saved batches_${res.label}.png`);
    } else {
      // Find button containing text "Batches"
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const b = buttons.find((el) => el.textContent?.includes("Batches"));
        b?.click();
      });
      await new Promise((r) => setTimeout(r, 600));
      await page.screenshot({
        path: path.join(OUTPUT_DIR, `batches_${res.label}.png`),
      });
      console.log(`Saved batches_${res.label}.png via text click`);
    }

    // 3. Evidence screen
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const b = buttons.find((el) => el.textContent?.includes("Evidence"));
      b?.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({
      path: path.join(OUTPUT_DIR, `evidence_${res.label}.png`),
    });
    console.log(`Saved evidence_${res.label}.png`);

    // 4. Back to Trade screen & open Deposit modal
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const b = buttons.find((el) => el.textContent?.includes("Trade"));
      b?.click();
    });
    await new Promise((r) => setTimeout(r, 400));

    // Open Deposit modal
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const b = buttons.find((el) => el.textContent?.includes("Deposit"));
      b?.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({
      path: path.join(OUTPUT_DIR, `account_deposit_${res.label}.png`),
    });
    console.log(`Saved account_deposit_${res.label}.png`);

    await page.close();
  }

  await browser.close();
  console.log("\nAll screenshots saved to:", OUTPUT_DIR);
}

capture().catch((err) => {
  console.error("Capture failed:", err);
  process.exit(1);
});
