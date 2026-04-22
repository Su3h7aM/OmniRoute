#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Detect whether the current install tree contains the published standalone app bundle.
 * Source checkouts should not create `app/` during postinstall because Next.js would
 * mis-detect it as a competing App Router root and serve 404s for the real `src/app` routes.
 */
export function hasStandaloneAppBundle(rootDir: string): boolean {
  return existsSync(join(rootDir, "app", "server.js"));
}
