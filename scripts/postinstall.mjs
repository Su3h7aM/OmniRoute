#!/usr/bin/env bun

/**
 * OmniRoute — Bun postinstall
 *
 * Bun-only migration note:
 * - no native better-sqlite3 repair logic remains
 * - SQLite is provided by bun:sqlite
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { hasStandaloneAppBundle } from "./postinstallSupport.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

async function ensureSwcHelpers() {
  if (!hasStandaloneAppBundle(ROOT)) {
    return;
  }

  const swcHelpersApp = join(ROOT, "app", "node_modules", "@swc", "helpers");
  const swcHelpersRoot = join(ROOT, "node_modules", "@swc", "helpers");

  if (existsSync(swcHelpersApp)) {
    return;
  }

  if (existsSync(swcHelpersRoot)) {
    try {
      const { cpSync } = await import("node:fs");
      mkdirSync(join(ROOT, "app", "node_modules", "@swc"), { recursive: true });
      cpSync(swcHelpersRoot, swcHelpersApp, { recursive: true });
      console.log("  ✅ @swc/helpers copied to standalone app/node_modules.\n");
    } catch (err) {
      console.warn(`  ⚠️  Could not copy @swc/helpers: ${err.message}`);
      console.warn(
        "     Try manually: cp -r node_modules/@swc/helpers app/node_modules/@swc/helpers\n"
      );
    }
    return;
  }

  console.warn("  ⚠️  @swc/helpers not found in root node_modules either.");
  console.warn("     Try: npm install --save-exact @swc/helpers@0.5.19\n");
}

async function syncProjectEnv() {
  try {
    const { syncEnv } = await import("./sync-env.mjs");
    syncEnv({ rootDir: ROOT });
  } catch (err) {
    console.warn(`  ⚠️  .env sync skipped: ${err.message}`);
  }
}

await ensureSwcHelpers();
await syncProjectEnv();
