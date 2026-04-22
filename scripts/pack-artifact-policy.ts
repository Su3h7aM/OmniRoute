/**
 * Shared policy for OmniRoute published artifact hygiene.
 *
 * The package currently publishes the standalone runtime under app/.
 * This policy keeps local backups, QA scratch files, and development-only
 * directories out of the staged app/ tree and out of the final tarball.
 */

const APP_STAGING_FORBIDDEN_PATHS = [
  "app.__qa_backup",
  "coverage",
  "logs",
  "scripts/scratch",
  "tests",
  "vscode-extension",
  "_ideia",
  "_mono_repo",
  "_references",
  "_tasks",
  "audit-report.json",
  "package-lock.json",
];

export const APP_STAGING_REMOVAL_PATHS: string[] = APP_STAGING_FORBIDDEN_PATHS;

export const APP_STAGING_ALLOWED_EXACT_PATHS: string[] = [
  ".env.example",
  "docs/openapi.yaml",
  "package.json",
  "scripts/sync-env.ts",
  "server.js",
];

export const APP_STAGING_ALLOWED_PATH_PREFIXES: string[] = [
  ".next/",
  "data/",
  "node_modules/",
  "public/",
  "src/lib/db/migrations/",
];

export const PACK_ARTIFACT_ALLOWED_EXACT_PATHS: string[] = APP_STAGING_ALLOWED_EXACT_PATHS.map(
  (filePath: string) => `app/${filePath}`
);

export const PACK_ARTIFACT_ALLOWED_PATH_PREFIXES: string[] = APP_STAGING_ALLOWED_PATH_PREFIXES.map(
  (directoryPath: string) => `app/${directoryPath}`
);

export const PACK_ARTIFACT_ROOT_ALLOWED_EXACT_PATHS: string[] = [
  ".env.example",
  "LICENSE",
  "README.md",
  "package.json",
  "scripts/build-next-isolated.ts",
  "scripts/postinstall.ts",
  "scripts/postinstallSupport.ts",
  "scripts/sync-env.ts",
];

export const PACK_ARTIFACT_ROOT_ALLOWED_PATH_PREFIXES: string[] = [
  "src/shared/contracts/",
];

export const PACK_ARTIFACT_REQUIRED_PATHS: string[] = [
  "app/server.js",
  "package.json",
  "scripts/postinstall.ts",
  "scripts/postinstallSupport.ts",
];

PACK_ARTIFACT_ALLOWED_EXACT_PATHS.push(...PACK_ARTIFACT_ROOT_ALLOWED_EXACT_PATHS);
PACK_ARTIFACT_ALLOWED_PATH_PREFIXES.push(...PACK_ARTIFACT_ROOT_ALLOWED_PATH_PREFIXES);

export function normalizeArtifactPath(filePath: string): string {
  return String(filePath)
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
}

export function findUnexpectedArtifactPaths(
  filePaths: string[],
  { exactPaths = [], prefixPaths = [] }: { exactPaths?: string[]; prefixPaths?: string[] } = {}
): string[] {
  const normalizedExact = new Set(exactPaths.map(normalizeArtifactPath));
  const normalizedPrefixes = prefixPaths.map(normalizeArtifactPath);

  return filePaths
    .map(normalizeArtifactPath)
    .filter(Boolean)
    .filter(
      (filePath) =>
        !normalizedExact.has(filePath) &&
        !normalizedPrefixes.some((prefix) => filePath.startsWith(prefix))
    )
    .sort();
}

export function findMissingArtifactPaths(
  filePaths: string[],
  requiredPaths: string[] = []
): string[] {
  const normalizedPaths = new Set(filePaths.map(normalizeArtifactPath).filter(Boolean));
  return requiredPaths
    .map(normalizeArtifactPath)
    .filter(Boolean)
    .filter((requiredPath) => !normalizedPaths.has(requiredPath))
    .sort();
}
