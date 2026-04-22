#!/usr/bin/env bun

export { getEnvSyncPlan, parseEnvFile, syncEnv } from "../src/lib/system/envSync";

if (process.argv[1]?.endsWith("sync-env.ts")) {
  const scope = process.argv.includes("--oauth-only") ? "oauth" : "full";
  const { syncEnv } = await import("../src/lib/system/envSync");
  syncEnv({ scope });
}
