import { beforeEach, describe, expect, it, mock } from "bun:test";

const isAuthenticated = mock(async () => true);
const getSettings = mock();
const updateSettings = mock();
const invalidateMemorySettingsCache = mock(() => undefined);

mock.module("../../../../shared/utils/apiAuth", () => ({
	isAuthenticated,
}));
mock.module("../../../../lib/localDb", () => ({
	getSettings,
	updateSettings,
}));
mock.module("@/lib/memory/settings", () => ({
	invalidateMemorySettingsCache,
	normalizeMemorySettings: (settings: Record<string, unknown> = {}) => ({
		enabled: typeof settings.memoryEnabled === "boolean" ? settings.memoryEnabled : true,
		maxTokens:
			typeof settings.memoryMaxTokens === "number"
				? Math.min(Math.max(Math.round(settings.memoryMaxTokens), 0), 16000)
				: 2000,
		retentionDays:
			typeof settings.memoryRetentionDays === "number"
				? Math.min(Math.max(Math.round(settings.memoryRetentionDays), 1), 365)
				: 30,
		strategy:
			settings.memoryStrategy === "recent" ||
			settings.memoryStrategy === "semantic" ||
			settings.memoryStrategy === "hybrid"
				? settings.memoryStrategy
				: "hybrid",
		skillsEnabled: typeof settings.skillsEnabled === "boolean" ? settings.skillsEnabled : false,
	}),
	toMemorySettingsUpdates: (settings: Record<string, unknown>) => {
		const updates: Record<string, unknown> = {};
		if (settings.enabled !== undefined) updates.memoryEnabled = settings.enabled;
		if (settings.maxTokens !== undefined) updates.memoryMaxTokens = settings.maxTokens;
		if (settings.retentionDays !== undefined)
			updates.memoryRetentionDays = settings.retentionDays;
		if (settings.strategy !== undefined) updates.memoryStrategy = settings.strategy;
		if (settings.skillsEnabled !== undefined) updates.skillsEnabled = settings.skillsEnabled;
		return updates;
	},
}));

const { GET, PUT } = await import("../memory/route");

function createRequest(method: "GET" | "PUT", body?: unknown) {
	return new Request("http://localhost/api/settings/memory", {
		method,
		headers: { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("/api/settings/memory", () => {
	beforeEach(() => {
		isAuthenticated.mockReset();
		getSettings.mockReset();
		updateSettings.mockReset();
		invalidateMemorySettingsCache.mockReset();

		isAuthenticated.mockResolvedValue(true);
		getSettings.mockResolvedValue({
			memoryEnabled: true,
			memoryMaxTokens: 2000,
			memoryRetentionDays: 30,
			memoryStrategy: "hybrid",
			skillsEnabled: false,
		});
		updateSettings.mockImplementation(async (updates: Record<string, unknown>) => ({
			memoryEnabled: true,
			memoryMaxTokens: 2000,
			memoryRetentionDays: 30,
			memoryStrategy: "hybrid",
			skillsEnabled: false,
			...updates,
		}));
	});

	it("returns normalized memory and skills settings", async () => {
		getSettings.mockResolvedValue({
			memoryEnabled: false,
			memoryMaxTokens: 3200,
			memoryRetentionDays: 999,
			memoryStrategy: "recent",
			skillsEnabled: true,
		});

		const res = await GET(createRequest("GET") as any);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			enabled: false,
			maxTokens: 3200,
			retentionDays: 365,
			strategy: "recent",
			skillsEnabled: true,
		});
	});

	it("persists updates and clears the cached settings snapshot", async () => {
		const res = await PUT(
			createRequest("PUT", {
				enabled: false,
				maxTokens: 0,
				retentionDays: 14,
				strategy: "semantic",
				skillsEnabled: true,
			}) as any
		);

		expect(res.status).toBe(200);
		expect(updateSettings).toHaveBeenCalledTimes(1);
		expect(updateSettings).toHaveBeenCalledWith({
			memoryEnabled: false,
			memoryMaxTokens: 0,
			memoryRetentionDays: 14,
			memoryStrategy: "semantic",
			skillsEnabled: true,
		});
		expect(invalidateMemorySettingsCache).toHaveBeenCalledTimes(1);
		await expect(res.json()).resolves.toEqual({
			enabled: false,
			maxTokens: 0,
			retentionDays: 14,
			strategy: "semantic",
			skillsEnabled: true,
		});
	});
});
