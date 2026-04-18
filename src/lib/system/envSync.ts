import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

type EnvSyncScope = "full" | "oauth";

const CRYPTO_SECRETS: Record<string, () => string> = {
  JWT_SECRET: () => randomBytes(64).toString("hex"),
  API_KEY_SECRET: () => randomBytes(32).toString("hex"),
  STORAGE_ENCRYPTION_KEY: () => randomBytes(32).toString("hex"),
  MACHINE_ID_SALT: () => `omniroute-${randomBytes(8).toString("hex")}`,
};

export function parseEnvFile(filePath: string) {
  if (!existsSync(filePath)) return new Map<string, string>();

  const content = readFileSync(filePath, "utf8");
  const entries = new Map<string, string>();

  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvEntry(line);
    if (!parsed) continue;

    const [key, value] = parsed;
    entries.set(key, value);
  }

  return entries;
}

function parseEnvEntry(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const eqIndex = trimmed.indexOf("=");
  if (eqIndex < 1) return null;

  const key = trimmed.slice(0, eqIndex).trim();
  const value = trimmed.slice(eqIndex + 1).trim();
  return [key, value];
}

function parseExampleEntries(content: string, scope: EnvSyncScope = "full") {
  const entries = new Map<string, string>();
  const lines = content.split(/\r?\n/);

  if (scope === "oauth") {
    let inOauthSection = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (/OAUTH PROVIDER CREDENTIALS/i.test(trimmed)) {
        inOauthSection = true;
        continue;
      }

      if (!inOauthSection) continue;
      if (/Provider User-Agent Overrides/i.test(trimmed)) break;

      const parsed = parseEnvEntry(line);
      if (!parsed) continue;

      const [key, value] = parsed;
      entries.set(key, value);
    }

    return entries;
  }

  for (const line of lines) {
    const parsed = parseEnvEntry(line);
    if (!parsed) continue;

    const [key, value] = parsed;
    entries.set(key, value);
  }

  return entries;
}

function getEnvPaths(rootDir?: string) {
  const root = rootDir || process.cwd();
  return {
    root,
    envExamplePath: path.join(root, ".env.example"),
    envPath: path.join(root, ".env"),
  };
}

export function getEnvSyncPlan({ rootDir, scope = "full" }: { rootDir?: string; scope?: EnvSyncScope } = {}) {
  const { envExamplePath, envPath } = getEnvPaths(rootDir);

  if (!existsSync(envExamplePath)) {
    return {
      available: false,
      created: false,
      added: 0,
      missingEntries: [] as Array<{ key: string; value: string; generated: boolean }>,
    };
  }

  const exampleEntries = parseExampleEntries(readFileSync(envExamplePath, "utf8"), scope);
  const currentEntries = parseEnvFile(envPath);
  const missingEntries: Array<{ key: string; value: string; generated: boolean }> = [];

  for (const [key, defaultValue] of exampleEntries) {
    if (currentEntries.has(key)) continue;

    if (CRYPTO_SECRETS[key] && !defaultValue) {
      missingEntries.push({ key, value: CRYPTO_SECRETS[key](), generated: true });
      continue;
    }

    missingEntries.push({ key, value: defaultValue, generated: false });
  }

  return {
    available: true,
    created: !existsSync(envPath),
    added: missingEntries.length,
    missingEntries,
  };
}

function replaceBlankSecret(content: string, key: string, value: string) {
  const pattern = new RegExp(`^${key}=\\s*$`, "m");
  return pattern.test(content) ? content.replace(pattern, `${key}=${value}`) : content;
}

export function syncEnv({
  rootDir,
  quiet = false,
  scope = "full",
}: {
  rootDir?: string;
  quiet?: boolean;
  scope?: EnvSyncScope;
} = {}) {
  const log = quiet ? () => {} : (message: string) => process.stderr.write(`[sync-env] ${message}\n`);
  const { envExamplePath, envPath } = getEnvPaths(rootDir);

  if (!existsSync(envExamplePath)) {
    log("⚠️  .env.example not found — skipping sync");
    return { created: false, added: 0 };
  }

  const exampleEntries = parseExampleEntries(readFileSync(envExamplePath, "utf8"), scope);

  if (!existsSync(envPath)) {
    if (scope === "full") {
      copyFileSync(envExamplePath, envPath);

      let content = readFileSync(envPath, "utf8");
      let generated = 0;
      for (const [key, generator] of Object.entries(CRYPTO_SECRETS)) {
        const nextContent = replaceBlankSecret(content, key, generator());
        if (nextContent !== content) {
          content = nextContent;
          generated++;
          log(`✨ ${key} auto-generated`);
        }
      }

      writeFileSync(envPath, content, "utf8");
      log(
        `✨ Created .env from .env.example (${exampleEntries.size} keys, ${generated} secrets generated)`
      );
      return { created: true, added: exampleEntries.size };
    }

    const { missingEntries } = getEnvSyncPlan({ rootDir, scope });
    const content = [
      "# ── Auto-added by sync-env (oauth defaults) ──",
      ...missingEntries.map((entry) => `${entry.key}=${entry.value}`),
      "",
    ].join("\n");
    writeFileSync(envPath, content, "utf8");
    log(`✨ Created .env with oauth defaults (${missingEntries.length} keys)`);
    return { created: true, added: missingEntries.length };
  }

  const { missingEntries } = getEnvSyncPlan({ rootDir, scope });

  if (missingEntries.length === 0) {
    log("✅ .env is up to date (0 keys added)");
    return { created: false, added: 0 };
  }

  const appendLines = [
    "",
    `# ── Auto-added by sync-env (${new Date().toISOString().slice(0, 10)}) ──`,
  ];

  for (const entry of missingEntries) {
    appendLines.push(`${entry.key}=${entry.value}`);
    log(`${entry.generated ? "✨" : "📦"} ${entry.key}${entry.generated ? " (auto-generated)" : ""}`);
  }

  appendLines.push("");

  const currentContent = readFileSync(envPath, "utf8");
  writeFileSync(envPath, `${currentContent.trimEnd()}\n${appendLines.join("\n")}`, "utf8");
  log(`📦 Synced .env — added ${missingEntries.length} missing keys`);

  return { created: false, added: missingEntries.length };
}
