import { beforeEach, describe, expect, it, mock } from "bun:test";

const getSettings = mock();
const updateSettings = mock();
const requireManagementAuth = mock(async () => null);
const getConsistentMachineId = mock(async () => "test-machine-id");
const validateProxyUrl = mock(() => ({ valid: true }));
const upsertUpstreamProxyConfig = mock(async () => undefined);
const ensurePersistentManagementPasswordHash = mock(async ({ settings }) => ({ settings }));
const getStoredManagementPassword = mock(() => null);
const hasManagementPasswordConfigured = mock(() => false);
const hashManagementPassword = mock(async (value: string) => `hashed:${value}`);
const verifyManagementPassword = mock(async () => true);

mock.module("@/lib/localDb", () => ({
  getSettings,
  updateSettings,
}));
mock.module("@/lib/api/requireManagementAuth", () => ({
  requireManagementAuth,
}));
mock.module("@/lib/runtime/ports", () => ({
  getRuntimePorts: () => ({ apiPort: 20128, dashboardPort: 20128 }),
}));
mock.module("@/shared/utils/machineId", () => ({
  getConsistentMachineId,
}));
mock.module("@/lib/db/upstreamProxy", () => ({
  validateProxyUrl,
  upsertUpstreamProxyConfig,
}));
mock.module("@/lib/auth/managementPassword", () => ({
  ensurePersistentManagementPasswordHash,
  getStoredManagementPassword,
  hasManagementPasswordConfigured,
  hashManagementPassword,
  verifyManagementPassword,
}));

const { PATCH } = await import("../route");

// Helper to create a Request with JSON body
function createPatchRequest(body: unknown) {
  return new Request("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/settings", () => {
  beforeEach(() => {
    getSettings.mockReset();
    updateSettings.mockReset();
    requireManagementAuth.mockReset();
    validateProxyUrl.mockReset();
    upsertUpstreamProxyConfig.mockReset();
    ensurePersistentManagementPasswordHash.mockReset();
    getStoredManagementPassword.mockReset();
    hasManagementPasswordConfigured.mockReset();
    hashManagementPassword.mockReset();
    verifyManagementPassword.mockReset();

    requireManagementAuth.mockResolvedValue(null);
    validateProxyUrl.mockReturnValue({ valid: true });
    upsertUpstreamProxyConfig.mockResolvedValue(undefined);
    ensurePersistentManagementPasswordHash.mockImplementation(async ({ settings }) => ({ settings }));
    getStoredManagementPassword.mockReturnValue(null);
    hasManagementPasswordConfigured.mockReturnValue(false);
    hashManagementPassword.mockImplementation(async (value: string) => `hashed:${value}`);
    verifyManagementPassword.mockResolvedValue(true);

    // Default settings before each test
    getSettings.mockResolvedValue({
      debugMode: false,
      hiddenSidebarItems: [],
    });
    // Mock updateSettings to merge updates into the original
    updateSettings.mockImplementation(async (updates: Record<string, unknown>) => {
      const current = await getSettings();
      return { ...current, ...updates };
    });
  });

  it("toggles debugMode via PATCH", async () => {
    const req = createPatchRequest({ debugMode: true });
    const res = await PATCH(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.debugMode).toBe(true);
    // Ensure password is not leaked
    expect(json).not.toHaveProperty("password");
    // Verify DB update called with correct payload
    expect(updateSettings).toHaveBeenCalledTimes(1);
    const calledWith = updateSettings.mock.calls[0][0];
    expect(calledWith.debugMode).toBe(true);
  });

  it("updates hiddenSidebarItems via PATCH", async () => {
    const req = createPatchRequest({ hiddenSidebarItems: [] });
    const res = await PATCH(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hiddenSidebarItems).toEqual([]);
    expect(updateSettings).toHaveBeenCalledTimes(1);
    const calledWith = updateSettings.mock.calls[0][0];
    expect(calledWith.hiddenSidebarItems).toEqual([]);
  });
});
