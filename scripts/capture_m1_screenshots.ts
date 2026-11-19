import puppeteer from "puppeteer-core";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUTPUT_DIR = path.resolve(__dirname, "../evidence/screenshots/milestone1");
const APP_DIR = path.resolve(__dirname, "../app");

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isServerReady(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.status === 200;
  } catch {
    return false;
  }
}

async function run() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let serverProcess: any = null;
  const isRunning = await isServerReady("http://localhost:3000/design-system");

  if (!isRunning) {
    console.log("Starting Next.js production server on port 3000...");
    serverProcess = spawn(
      "/Users/jatinsharma/.nvm/versions/node/v22.16.0/bin/node",
      ["node_modules/.bin/next", "start", "-p", "3000"],
      { cwd: APP_DIR, stdio: "inherit" }
    );

    let ready = false;
    for (let i = 0; i < 30; i++) {
      await wait(1000);
      if (await isServerReady("http://localhost:3000/design-system")) {
        ready = true;
        break;
      }
    }

    if (!ready) {
      console.error("Failed to connect to Next.js server after 30 seconds");
      if (serverProcess) serverProcess.kill();
      process.exit(1);
    }
  }

  console.log("Next.js server is ready. Launching Chrome...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

  try {
    // 1. Desktop Full HD (1920x1080) - Design System Catalog
    console.log("Capturing 1: design_system_desktop_1920x1080.png...");
    const page1080 = await browser.newPage();
    await page1080.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
    await page1080.goto("http://localhost:3000/design-system", { waitUntil: "networkidle0" });
    await wait(1000);
    await page1080.screenshot({
      path: path.join(OUTPUT_DIR, "design_system_desktop_1920x1080.png"),
      fullPage: true,
    });
    await page1080.close();

    // 2. Laptop Standard (1440x900) - Design System Catalog
    console.log("Capturing 2: design_system_laptop_1440x900.png...");
    const page1440 = await browser.newPage();
    await page1440.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page1440.goto("http://localhost:3000/design-system", { waitUntil: "networkidle0" });
    await wait(1000);
    await page1440.screenshot({
      path: path.join(OUTPUT_DIR, "design_system_laptop_1440x900.png"),
    });

    // 3. Modal Dialog Open State (1440x900)
    console.log("Capturing 3: design_system_modal_1440x900.png...");
    await page1440.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const modalBtn = buttons.find((b) => b.textContent?.includes("Open Accessible Modal"));
      modalBtn?.click();
    });
    await wait(600);
    await page1440.screenshot({
      path: path.join(OUTPUT_DIR, "design_system_modal_1440x900.png"),
    });
    await page1440.close();

    // 4. Mobile Viewport (375x812 - iPhone)
    console.log("Capturing 4: design_system_mobile_375x812.png...");
    const pageMobile = await browser.newPage();
    await pageMobile.setViewport({ width: 375, height: 812, isMobile: true, deviceScaleFactor: 2 });
    await pageMobile.goto("http://localhost:3000/design-system", { waitUntil: "networkidle0" });
    await wait(1000);
    await pageMobile.screenshot({
      path: path.join(OUTPUT_DIR, "design_system_mobile_375x812.png"),
      fullPage: true,
    });
    await pageMobile.close();

    // 5. Existing Terminal Baseline (1440x900) to confirm zero visual regression
    console.log("Capturing 5: terminal_baseline_1440x900.png...");
    const pageTerminal = await browser.newPage();
    await pageTerminal.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await pageTerminal.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
    await wait(1500);
    await pageTerminal.screenshot({
      path: path.join(OUTPUT_DIR, "terminal_baseline_1440x900.png"),
    });
    await pageTerminal.close();

    console.log("\nAll Milestone 1 screenshots successfully captured and saved to evidence/screenshots/milestone1/");
  } finally {
    await browser.close();
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
    }
  }
}

run().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
