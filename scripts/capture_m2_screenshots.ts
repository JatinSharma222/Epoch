import puppeteer from "puppeteer-core";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUTPUT_DIR = path.resolve(__dirname, "../evidence/screenshots/milestone2");
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
  const isRunning = await isServerReady("http://localhost:3000/");

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
      if (await isServerReady("http://localhost:3000/")) {
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
    // 1. Desktop Full HD (1920x1080) - Main Trading Terminal
    console.log("Capturing 1: terminal_desktop_1920x1080.png...");
    const page1080 = await browser.newPage();
    await page1080.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
    await page1080.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
    await wait(2000);
    await page1080.screenshot({
      path: path.join(OUTPUT_DIR, "terminal_desktop_1920x1080.png"),
    });
    await page1080.close();

    // 2. Laptop Standard (1440x900) - Main Trading Terminal
    console.log("Capturing 2: terminal_laptop_1440x900.png...");
    const page1440 = await browser.newPage();
    await page1440.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page1440.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
    await wait(2000);
    await page1440.screenshot({
      path: path.join(OUTPUT_DIR, "terminal_laptop_1440x900.png"),
    });

    // 3. Slide-over Diagnostic Drawer Open (1440x900)
    console.log("Capturing 3: terminal_diagnostic_drawer_1440x900.png...");
    await page1440.evaluate(() => {
      const statusPill = document.querySelector('button[aria-label="System Health Telemetry"]') as HTMLButtonElement;
      statusPill?.click();
    });
    await wait(800);
    await page1440.screenshot({
      path: path.join(OUTPUT_DIR, "terminal_diagnostic_drawer_1440x900.png"),
    });
    await page1440.close();

    // 4. Tablet Landscape (1024x768)
    console.log("Capturing 4: terminal_tablet_1024x768.png...");
    const pageTablet = await browser.newPage();
    await pageTablet.setViewport({ width: 1024, height: 768, deviceScaleFactor: 2 });
    await pageTablet.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
    await wait(2000);
    await pageTablet.screenshot({
      path: path.join(OUTPUT_DIR, "terminal_tablet_1024x768.png"),
    });
    await pageTablet.close();

    // 5. Mobile Viewport (375x812 - iPhone X/12)
    console.log("Capturing 5: terminal_mobile_375x812.png...");
    const pageMobile = await browser.newPage();
    await pageMobile.setViewport({ width: 375, height: 812, deviceScaleFactor: 3 });
    await pageMobile.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
    await wait(2000);
    await pageMobile.screenshot({
      path: path.join(OUTPUT_DIR, "terminal_mobile_375x812.png"),
    });
    await pageMobile.close();

    console.log("Successfully captured all Milestone 2 terminal screenshots!");
  } catch (err) {
    console.error("Screenshot capture error:", err);
  } finally {
    await browser.close();
    if (serverProcess) {
      console.log("Shutting down temporary Next.js server...");
      serverProcess.kill();
    }
  }
}

run().catch(console.error);
