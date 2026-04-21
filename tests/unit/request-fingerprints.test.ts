import { afterEach, test } from "bun:test";
import assert from "node:assert/strict";

const {
	applyFingerprint,
	getRequestFingerprintProviders,
	isRequestFingerprintEnabled,
	setRequestFingerprintProviders,
} = await import("../../open-sse/config/requestFingerprints.ts");

const ENV_KEYS = [
	"REQUEST_FINGERPRINT_CODEX",
	"REQUEST_FINGERPRINT_GITHUB",
	"REQUEST_FINGERPRINT_ALL",
	"CLI_COMPAT_CODEX",
	"CLI_COMPAT_ALL",
];

afterEach(() => {
	setRequestFingerprintProviders([]);
	for (const key of ENV_KEYS) {
		delete process.env[key];
	}
});

test("applyFingerprint reorders headers and body fields for Codex", () => {
	const headers = {
		"Accept-Encoding": "gzip",
		"X-Extra": "preserved",
		Authorization: "Bearer token",
		"Content-Type": "application/json",
		Accept: "text/event-stream",
		Host: "chatgpt.com",
	};
	const body = {
		stream: true,
		messages: [{ role: "user", content: "hello" }],
		model: "gpt-5-codex",
		temperature: 0.2,
		custom: "preserved",
	};

	const result = applyFingerprint("codex", headers, body);
	const orderedHeaderKeys = Object.keys(result.headers);
	const orderedBodyKeys = Object.keys(JSON.parse(result.bodyString));

	assert.deepEqual(orderedHeaderKeys.slice(0, 6), [
		"Host",
		"Content-Type",
		"Authorization",
		"Accept",
		"User-Agent",
		"Accept-Encoding",
	]);
	assert.equal(result.headers["User-Agent"], "codex-cli");
	assert.equal(result.headers["X-Extra"], "preserved");
	assert.deepEqual(orderedBodyKeys.slice(0, 4), ["model", "messages", "temperature", "stream"]);
	assert.equal(orderedBodyKeys.at(-1), "custom");
});

test("applyFingerprint applies provider-specific extra headers", () => {
	const headers = {
		Host: "dashscope.aliyuncs.com",
		Authorization: "Bearer token",
		"Content-Type": "application/json",
		Accept: "application/json",
	};

	const result = applyFingerprint("qwen", headers, { model: "qwen3-coder-plus", messages: [] });

	assert.match(result.headers["User-Agent"], /^QwenCode\//);
	assert.equal(result.headers.Accept, "application/json");
	assert.equal(result.headers["Accept-Language"], "*");
	assert.equal(result.headers["X-Dashscope-AuthType"], "qwen-oauth");
	assert.equal(result.headers["X-Stainless-Lang"], "js");
	assert.equal(result.headers["X-Stainless-Runtime"], "node");
});

test("applyFingerprint leaves unknown providers as plain JSON", () => {
	const headers = { "X-Test": "1" };
	const body = { z: 1, a: 2 };

	const result = applyFingerprint("unknown-provider", headers, body);

	assert.strictEqual(result.headers, headers);
	assert.equal(result.bodyString, JSON.stringify(body));
});

test("request fingerprint enablement supports runtime cache and new env vars", () => {
	assert.equal(isRequestFingerprintEnabled("codex"), false);

	setRequestFingerprintProviders(["Codex"]);
	assert.deepEqual(getRequestFingerprintProviders(), ["codex"]);
	assert.equal(isRequestFingerprintEnabled("codex"), true);

	setRequestFingerprintProviders([]);
	process.env.REQUEST_FINGERPRINT_CODEX = "1";
	assert.equal(isRequestFingerprintEnabled("codex"), true);

	delete process.env.REQUEST_FINGERPRINT_CODEX;
	process.env.REQUEST_FINGERPRINT_ALL = "true";
	assert.equal(isRequestFingerprintEnabled("github"), true);
});

test("legacy CLI_COMPAT env vars no longer enable request fingerprints", () => {
	process.env.CLI_COMPAT_CODEX = "1";
	process.env.CLI_COMPAT_ALL = "true";

	assert.equal(isRequestFingerprintEnabled("codex"), false);
	assert.equal(isRequestFingerprintEnabled("github"), false);

	delete process.env.CLI_COMPAT_CODEX;
	delete process.env.CLI_COMPAT_ALL;
});
