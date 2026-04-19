#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const cwd = process.cwd();

const deprecatedPatterns = [
  /(^|\/)tests\/unit\/cli-runtime-.*\.test\.(ts|tsx|js|mjs)$/,
  /(^|\/)tests\/unit\/cliproxyapi-executor\.test\.(ts|tsx|js|mjs)$/,
  /(^|\/)tests\/unit\/cli-memory\.test\.(ts|tsx|js|mjs)$/,
  /(^|\/)tests\/unit\/cli-tools\.test\.(ts|tsx|js|mjs)$/,
  /(^|\/)tests\/unit\/qoder-cli\.test\.(ts|tsx|js|mjs)$/,
  /(^|\/)tests\/unit\/t40-opencode-cli-tools-integration\.test\.(ts|tsx|js|mjs)$/,
  /(^|\/)tests\/unit\/claude-cli-defaults\.test\.(ts|tsx|js|mjs)$/,
];

const testFilePattern = /(?:\.test|\.spec)\.(?:[cm]?[jt]sx?)$/;

function isDeprecatedTest(file) {
  const normalized = file.split(path.sep).join("/");
  return deprecatedPatterns.some((pattern) => pattern.test(normalized));
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, out);
      continue;
    }
    if (testFilePattern.test(entry.name) && !isDeprecatedTest(fullPath)) {
      out.push(fullPath);
    }
  }
  return out;
}

function collectTargets(args) {
  if (args.length === 0) return walk(path.join(cwd, "tests", "unit"));

  const files = [];
  for (const arg of args) {
    const resolved = path.resolve(cwd, arg);
    if (!fs.existsSync(resolved)) continue;
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      files.push(...walk(resolved));
    } else if (testFilePattern.test(resolved) && !isDeprecatedTest(resolved)) {
      files.push(resolved);
    }
  }
  return files;
}

const targets = collectTargets(argv).sort();

if (targets.length === 0) {
  console.error("[run-bun-tests] No non-deprecated test files matched.");
  process.exit(1);
}

let failed = 0;

for (const target of targets) {
  const result = spawnSync("bun", ["test", target], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  if ((result.status ?? 1) !== 0) {
    failed += 1;
  }
}

process.exit(failed === 0 ? 0 : 1);
