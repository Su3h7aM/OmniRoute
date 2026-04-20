import { describe, expect, it } from "bun:test";

import {
	normalizeProxyUrl,
	proxyConfigToUrl,
	proxyUrlForLogs,
} from "../../open-sse/utils/proxyConfig.ts";

describe("proxyConfig", () => {
	it("preserves explicit default HTTP and HTTPS proxy ports", () => {
		expect(normalizeProxyUrl("http://proxy.example.test:80")).toBe(
			"http://proxy.example.test:80"
		);
		expect(normalizeProxyUrl("https://proxy.example.test:443")).toBe(
			"https://proxy.example.test:443"
		);
	});

	it("normalizes proxy config objects into URLs", () => {
		expect(
			proxyConfigToUrl({
				type: "http",
				host: "proxy.example.test",
				port: 8080,
				username: "user",
				password: "pass word",
			})
		).toBe("http://user:pass%20word@proxy.example.test:8080");
	});

	it("redacts credentials from proxy URL logs", () => {
		expect(proxyUrlForLogs("http://user:secret@proxy.example.test:8080")).toBe(
			"http://proxy.example.test:8080"
		);
	});

	it("rejects SOCKS5 when disabled", () => {
		expect(() =>
			normalizeProxyUrl("socks5://127.0.0.1:1080", "proxy", { allowSocks5: false })
		).toThrow(/SOCKS5 proxy is disabled/i);
	});
});
