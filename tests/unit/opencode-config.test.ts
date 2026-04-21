import { test } from "bun:test";
import assert from "node:assert/strict";
import path from "node:path";

const { resolveOpencodeConfigPath } = await import("../../src/shared/services/cliRuntime.ts");
const { buildOpenCodeProviderConfig, mergeOpenCodeConfig } = await import(
	"../../src/shared/services/opencodeConfig.ts"
);

test("OpenCode config path resolves per-platform", () => {
	const linuxWithXdg = resolveOpencodeConfigPath(
		"linux",
		{ XDG_CONFIG_HOME: "/tmp/xdg-config-home" },
		"/home/dev"
	);
	assert.equal(linuxWithXdg, path.join("/tmp/xdg-config-home", "opencode", "opencode.json"));

	const linuxDefault = resolveOpencodeConfigPath("linux", {}, "/home/dev");
	assert.equal(linuxDefault, path.join("/home/dev", ".config", "opencode", "opencode.json"));

	const windowsPath = resolveOpencodeConfigPath(
		"win32",
		{ APPDATA: "C:\\Users\\dev\\AppData\\Roaming" },
		"C:\\Users\\dev"
	);
	assert.equal(
		windowsPath,
		path.join("C:\\Users\\dev\\AppData\\Roaming", "opencode", "opencode.json")
	);
});

test("OpenCode config generator includes endpoint and selected API key", () => {
	const providerConfig = buildOpenCodeProviderConfig({
		baseUrl: "http://localhost:20128/v1/",
		apiKey: "sk_test_opencode",
		model: "claude-sonnet-4-5-thinking",
	});
	assert.equal(providerConfig.options.baseURL, "http://localhost:20128/v1");
	assert.equal(providerConfig.options.apiKey, "sk_test_opencode");
	assert.ok(providerConfig.models["claude-sonnet-4-5-thinking"]);

	const mergedConfig = mergeOpenCodeConfig(
		{ provider: { custom: { name: "Custom Provider" } } },
		{
			baseUrl: "http://localhost:20128/v1",
			apiKey: "sk_test_opencode",
			model: "claude-sonnet-4-5-thinking",
		}
	);
	assert.ok(mergedConfig.provider.custom);
	assert.equal(mergedConfig.provider.omniroute.options.baseURL, "http://localhost:20128/v1");
	assert.equal(mergedConfig.provider.omniroute.options.apiKey, "sk_test_opencode");
});
