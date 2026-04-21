#!/usr/bin/env bun
/**
 * OmniRoute — Environment Sync
 */

export { getEnvSyncPlan, parseEnvFile, syncEnv } from "../src/lib/system/envSync";

if (process.argv[1]?.endsWith("sync-env.mjs")) {
  const { syncEnv } = await import("../src/lib/system/envSync");
  syncEnv({ scope: process.argv.includes("--oauth-only") ? "oauth" : "full" });
}
