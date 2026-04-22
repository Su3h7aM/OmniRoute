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

import { hasStandaloneAppBundle } from "./postinstallSupport.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function ensureSwcHelpers() {
  if (!hasStandaloneAppBundle(ROOT)) return;

  const appHelpersPath = join(ROOT, "app", "node_modules", "@swc", "helpers");
  if (existsSync(appHelpersPath)) return;

  const rootHelpersPath = join(ROOT, "node_modules", "@swc", "helpers");
  if (!existsSync(rootHelpersPath)) {
    console.warn("  ⚠️  @swc/helpers not found in root node_modules either.");
    console.warn("     Try: npm install --save-exact @swc/helpers@0.5.19\n");
    return;
  }

  try {
    const { cpSync } = await import("node:fs");
    mkdirSync(join(ROOT, "app", "node_modules", "@swc"), { recursive: true });
    cpSync(rootHelpersPath, appHelpersPath, { recursive: true });
    console.log("  ✅ @swc/helpers copied to standalone app/node_modules.\n");
  } catch (error) {
    console.warn(`  ⚠️  Could not copy @swc/helpers: ${getErrorMessage(error)}`);
    console.warn(
      "     Try manually: cp -r node_modules/@swc/helpers app/node_modules/@swc/helpers\n"
    );
  }
}

async function syncProjectEnv() {
  try {
    const { syncEnv } = await import("./sync-env.ts");
    syncEnv({ rootDir: ROOT });
  } catch (error) {
    console.warn(`  ⚠️  .env sync skipped: ${getErrorMessage(error)}`);
  }
}

await ensureSwcHelpers();
await syncProjectEnv();
