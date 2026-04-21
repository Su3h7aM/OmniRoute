import { afterEach, describe, expect, it } from "bun:test";
import net from "node:net";

import {
	clearProxyHealthCache,
	getCachedProxyHealth,
	invalidateProxyHealth,
	isProxyReachable,
} from "../../src/lib/proxyHealth.ts";

afterEach(() => {
	clearProxyHealthCache();
});

async function withTcpServer(fn: (url: string) => Promise<void>) {
	const server = net.createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});

	const address = server.address();
	if (!address || typeof address !== "object") {
		throw new Error("Expected TCP server address");
	}

	try {
		await fn(`http://127.0.0.1:${address.port}`);
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => {
				if (error) reject(error);
				else resolve();
			});
		});
	}
}

describe("proxyHealth", () => {
	it("marks reachable proxy URLs as healthy and caches result", async () => {
		await withTcpServer(async (proxyUrl) => {
			expect(await isProxyReachable(proxyUrl, 100, 1000)).toBe(true);
			expect(getCachedProxyHealth(proxyUrl)).toBe(true);
		});
	});

	it("marks malformed proxy URLs as unhealthy", async () => {
		expect(await isProxyReachable("not-a-url", 50, 1000)).toBe(false);
		expect(getCachedProxyHealth("not-a-url")).toBe(false);
	});

	it("invalidates cached proxy health", async () => {
		await withTcpServer(async (proxyUrl) => {
			await isProxyReachable(proxyUrl, 100, 1000);
			expect(getCachedProxyHealth(proxyUrl)).toBe(true);
			invalidateProxyHealth(proxyUrl);
			expect(getCachedProxyHealth(proxyUrl)).toBeNull();
		});
	});
});
