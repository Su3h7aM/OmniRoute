export function parsePort(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value), 10);
  const isValidPort = Number.isFinite(parsed) && parsed > 0 && parsed <= 65535;
  return isValidPort ? parsed : fallback;
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [fromEnv]
 *        Defaults to process.env. Pass bootstrap `merged` so project `.env` PORT applies before spawn.
 */
export function resolveRuntimePorts(
  fromEnv: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
) {
  const basePort = parsePort(fromEnv.PORT || "20128", 20128);
  const apiPort = parsePort(fromEnv.API_PORT || String(basePort), basePort);
  const dashboardPort = parsePort(fromEnv.DASHBOARD_PORT || String(basePort), basePort);

  return { basePort, apiPort, dashboardPort };
}

export function withRuntimePortEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  runtimePorts: { basePort: number; apiPort: number; dashboardPort: number }
) {
  const { basePort, apiPort, dashboardPort } = runtimePorts;

  return {
    ...env,
    OMNIROUTE_PORT: String(basePort),
    PORT: String(dashboardPort),
    DASHBOARD_PORT: String(dashboardPort),
    API_PORT: String(apiPort),
  };
}

export function sanitizeColorEnv(env: Record<string, string | undefined> = {}) {
  const sanitized = { ...env };

  // Some tooling warns when both FORCE_COLOR and NO_COLOR are set.
  // Prefer NO_COLOR in test tooling to avoid noisy process warnings.
  if (typeof sanitized.FORCE_COLOR !== "undefined" && typeof sanitized.NO_COLOR !== "undefined") {
    delete sanitized.FORCE_COLOR;
  }

  return sanitized;
}

export function spawnWithForwardedSignals(
  command: string,
  args: string[],
  options: Bun.SpawnOptions.OptionsObject<string, "inherit" | "pipe"> = {}
) {
  const child = Bun.spawn([command, ...args], options);

  void child.exited.then((code) => {
    process.exit(code ?? 0);
  });

  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));

  return child;
}
