#!/usr/bin/env node

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { sanitizeColorEnv } from "./runtime-env.mjs";

const port = process.env.DASHBOARD_PORT || process.env.PORT || "20128";
const baseUrl = process.env.OMNIROUTE_BASE_URL || `http://localhost:${port}`;
const healthUrl = `${baseUrl}/api/monitoring/health`;
const maxWaitMs = Number(process.env.ECOSYSTEM_SERVER_WAIT_MS || 180000);
const pollMs = 2000;

async function isServerReady() {
  const timeout = AbortSignal.timeout(2000);
  try {
    const res = await fetch(healthUrl, { signal: timeout });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServerReady() {
  const maxAttempts = Math.ceil(maxWaitMs / pollMs);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (await isServerReady()) return;
    await delay(pollMs);
  }
  throw new Error(`Timed out waiting for ${healthUrl} after ${maxWaitMs}ms`);
}

async function ensureServer(testEnv) {
  if (await isServerReady()) {
    return { serverProcess: null, startedHere: false };
  }

  const serverProcess = spawn(process.execPath, ["scripts/run-next-playwright.mjs", "dev"], {
    stdio: "inherit",
    env: testEnv,
  });

  let exited = false;
  let exitCode = null;
  serverProcess.once("exit", (code) => {
    exited = true;
    exitCode = code ?? 1;
  });

  try {
    await waitForServerReady();
    return { serverProcess, startedHere: true };
  } catch (error) {
    if (exited && (await isServerReady())) {
      return { serverProcess: null, startedHere: false };
    }
    throw error;
  }
}

async function main() {
  const testEnv = sanitizeColorEnv(process.env);
  const { serverProcess, startedHere } = await ensureServer(testEnv);

  const testProcess = spawn("bun", ["test", "tests/e2e/protocol-clients.test.ts"], {
    stdio: "inherit",
    env: testEnv,
  });

  const exitCode = await new Promise((resolve) => {
    testProcess.on("exit", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });

  if (startedHere && serverProcess) {
    serverProcess.kill("SIGTERM");
    await delay(1000);
    if (!serverProcess.killed) {
      serverProcess.kill("SIGKILL");
    }
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error("[test:protocols:e2e] Failed:", error?.message || error);
  process.exit(1);
});
