#!/usr/bin/env bun

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import next from "next";
import { bootstrapEnv } from "./bootstrap-env.ts";
import { resolveRuntimePorts, withRuntimePortEnv } from "./runtime-env.ts";
import { createOmnirouteWsBridge } from "./v1-ws-bridge.ts";

function ensureNoConflictingRootAppDir() {
  const rootAppDir = path.join(process.cwd(), "app");
  if (!fs.existsSync(rootAppDir) || !fs.statSync(rootAppDir).isDirectory()) {
    return;
  }

  console.error("\x1b[31m[FATAL ERROR]\x1b[0m Next.js App Router conflict detected!");
  console.error(`A root-level 'app/' directory was found at: ${rootAppDir}`);
  console.error("This conflicts with the 'src/app/' directory on Windows environments.");
  console.error("Next.js will serve 404s for all pages because it prefers the root 'app/' folder.");
  console.error("Please rename or delete the root 'app/' directory before starting OmniRoute.\n");
  process.exit(1);
}

ensureNoConflictingRootAppDir();

const command = process.argv[2];
const dev = command !== "start";

const bootstrappedEnv = bootstrapEnv();
const runtimePorts = resolveRuntimePorts(bootstrappedEnv);
const mergedEnv = withRuntimePortEnv(bootstrappedEnv, runtimePorts);

for (const [key, value] of Object.entries(mergedEnv)) {
  if (value !== undefined) {
    process.env[key] = value;
  }
}

const { dashboardPort } = runtimePorts;
const hostname = process.env.HOST || "localhost";
const useTurbopack = dev;

const nextApp = next({
  dev,
  dir: process.cwd(),
  hostname,
  port: dashboardPort,
  turbopack: useTurbopack,
});

async function start() {
  await nextApp.prepare();

  const requestHandler = nextApp.getRequestHandler();
  const upgradeHandler = nextApp.getUpgradeHandler();
  const wsBridge = createOmnirouteWsBridge({
    baseUrl: `http://127.0.0.1:${dashboardPort}`,
  });

  const server = http.createServer(requestHandler);
  server.on("upgrade", async (req, socket, head) => {
    try {
      const handled = await wsBridge.handleUpgrade(req, socket, head);
      if (handled) return;
      await upgradeHandler(req, socket, head);
    } catch (error) {
      if (!socket.destroyed) {
        socket.destroy(error instanceof Error ? error : undefined);
      }
      console.error("[WS] Upgrade handling failed:", error);
    }
  });

  server.on("error", (error) => {
    console.error("[FATAL] Next custom server failed:", error);
    process.exit(1);
  });

  const shutdown = async (signal) => {
    try {
      await new Promise((resolve) => server.close(resolve));
      await nextApp.close();
    } catch (error) {
      console.error(`[SHUTDOWN] Failed during ${signal}:`, error);
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  server.listen(dashboardPort, hostname, () => {
    const mode = dev ? "development" : "production";
    const bundler = dev ? "turbopack" : "production";
    console.log(
      `[Next] ${mode} server listening on http://${hostname}:${dashboardPort} (${bundler})`
    );
  });
}

start().catch((error) => {
  console.error("[FATAL] Failed to start Next custom server:", error);
  process.exit(1);
});
