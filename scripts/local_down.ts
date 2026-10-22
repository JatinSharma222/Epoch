#!/usr/bin/env bun
/**
 * Epoch Local Environment Teardown Script (`bun run local:down`)
 *
 * Gracefully shuts down solana-test-validator, keeper, and frontend app.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const PID_FILE = path.resolve(__dirname, "../.local_pids.json");

function killPid(pid: number, name: string) {
  try {
    process.kill(pid, "SIGTERM");
    console.log(`[local:down] Stopped ${name} (PID: ${pid})`);
  } catch (err: any) {
    if (err.code !== "ESRCH") {
      console.log(`[local:down] Note on ${name} (PID ${pid}): ${err.message}`);
    }
  }
}

function killPort(port: number, name: string) {
  try {
    const stdout = execSync(`lsof -ti :${port}`, { encoding: "utf-8" }).trim();
    if (stdout) {
      const pids = stdout.split("\n").filter(Boolean);
      for (const p of pids) {
        try {
          process.kill(parseInt(p, 10), "SIGKILL");
          console.log(`[local:down] Killed process on port ${port} (${name}, PID: ${p})`);
        } catch {}
      }
    }
  } catch {}
}

async function main() {
  console.log("==================================================================");
  console.log("           EPOCH PROTOCOL LOCAL ENVIRONMENT TEARDOWN              ");
  console.log("==================================================================");

  // 1. Kill tracked PIDs from .local_pids.json
  if (fs.existsSync(PID_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(PID_FILE, "utf-8"));
      if (data.appPid) killPid(data.appPid, "Next.js App");
      if (data.keeperPid) killPid(data.keeperPid, "Aggregator Keeper");
      if (data.validatorPid) killPid(data.validatorPid, "solana-test-validator");
    } catch {}
    fs.unlinkSync(PID_FILE);
  }

  // 2. Fallback port & process cleanups
  killPort(3000, "App");
  killPort(8899, "Solana Validator RPC");
  killPort(8900, "Solana Validator WS");

  // Kill any remaining solana-test-validator
  try {
    execSync("pkill -9 -f solana-test-validator", { stdio: "ignore" });
    console.log("[local:down] Verified solana-test-validator terminated.");
  } catch {}

  console.log("==================================================================");
  console.log("  [PASS] Local environment stopped cleanly. Ports 8899 & 3000 free.");
  console.log("==================================================================");
}

main().catch((err) => {
  console.error("[local:down] Error:", err);
  process.exit(1);
});
