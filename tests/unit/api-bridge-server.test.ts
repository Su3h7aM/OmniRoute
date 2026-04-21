import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const originalFetch = globalThis.fetch;
const originalPorts = globalThis.__testRuntimePorts;
const originalStarted = globalThis.__omnirouteApiBridgeStarted;
const originalBridgeServer = globalThis.__omnirouteApiBridgeServer;
const serversToStop: Array<{ stop: (closeActiveConnections?: boolean) => void }> = [];

mock.module("@/lib/runtime/ports", () => ({
	getRuntimePorts: () => globalThis.__testRuntimePorts,
}));

describe("initApiBridgeServer", () => {
	beforeEach(() => {
		globalThis.__omnirouteApiBridgeStarted = undefined;
		globalThis.fetch = originalFetch;
	});

	afterEach(() => {
		while (serversToStop.length > 0) {
			serversToStop.pop()?.stop(true);
		}
		globalThis.fetch = originalFetch;
		globalThis.__testRuntimePorts = originalPorts;
		globalThis.__omnirouteApiBridgeStarted = originalStarted;
		globalThis.__omnirouteApiBridgeServer = originalBridgeServer;
	});

	it("proxies OpenAI-compatible HTTP requests to the dashboard port", async () => {
		const dashboardServer = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch(request) {
				return Response.json({
					path: new URL(request.url).pathname,
					method: request.method,
					host: request.headers.get("host"),
				});
			},
		});
		serversToStop.push(dashboardServer);

		const apiPort = dashboardServer.port + 1;
		globalThis.__testRuntimePorts = {
			apiPort,
			dashboardPort: dashboardServer.port,
		};

		const { initApiBridgeServer } = await import("../../src/lib/apiBridgeServer.ts");
		initApiBridgeServer();
		serversToStop.push(globalThis.__omnirouteApiBridgeServer as { stop: () => void });

		const response = await fetch(`http://127.0.0.1:${apiPort}/v1/models`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ hello: "world" }),
		});
		const payload = await response.json();

		expect(response.status).toBe(200);
		expect(payload).toEqual({
			path: "/v1/models",
			method: "POST",
			host: `127.0.0.1:${dashboardServer.port}`,
		});
	});

	it("returns 404 for non OpenAI-compatible routes", async () => {
		const dashboardServer = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch() {
				return new Response("dashboard");
			},
		});
		serversToStop.push(dashboardServer);

		const apiPort = dashboardServer.port + 1;
		globalThis.__testRuntimePorts = {
			apiPort,
			dashboardPort: dashboardServer.port,
		};

		const { initApiBridgeServer } = await import("../../src/lib/apiBridgeServer.ts");
		initApiBridgeServer();
		serversToStop.push(globalThis.__omnirouteApiBridgeServer as { stop: () => void });

		const response = await fetch(`http://127.0.0.1:${apiPort}/healthz`);
		const payload = await response.json();

		expect(response.status).toBe(404);
		expect(payload.error).toBe("not_found");
	});
});
