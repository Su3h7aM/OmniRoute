import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const originalFetch = globalThis.fetch;
const originalPorts = globalThis.__testRuntimePorts;
const originalStarted = globalThis.__omnirouteApiBridgeStarted;
const originalBridgeServer = globalThis.__omnirouteApiBridgeServer;
const serversToStop: Array<{ stop: (closeActiveConnections?: boolean) => void }> = [];

mock.module("@/lib/runtime/ports", () => ({
	getRuntimePorts: () => globalThis.__testRuntimePorts,
}));

function rememberServer(server: { stop: (closeActiveConnections?: boolean) => void }) {
	serversToStop.push(server);
	return server;
}

async function cleanupBridgeTestState() {
	const { stopApiBridgeServer } = await import("../../src/lib/apiBridgeServer.ts");
	stopApiBridgeServer();
	while (serversToStop.length > 0) {
		serversToStop.pop()?.stop(true);
	}
	globalThis.fetch = originalFetch;
	globalThis.__testRuntimePorts = originalPorts;
	globalThis.__omnirouteApiBridgeStarted = originalStarted;
	globalThis.__omnirouteApiBridgeServer = originalBridgeServer;
}

describe("initApiBridgeServer", () => {
	beforeEach(() => {
		globalThis.__omnirouteApiBridgeStarted = undefined;
		globalThis.fetch = originalFetch;
	});

	afterEach(async () => {
		await cleanupBridgeTestState();
	});

	it("proxies OpenAI-compatible HTTP requests to the dashboard port", async () => {
		const dashboardServer = rememberServer(
			Bun.serve({
				port: 0,
				hostname: "127.0.0.1",
				fetch(request) {
					return Response.json({
						path: new URL(request.url).pathname,
						method: request.method,
						host: request.headers.get("host"),
					});
				},
			})
		);

		const apiPort = dashboardServer.port + 1;
		globalThis.__testRuntimePorts = {
			apiPort,
			dashboardPort: dashboardServer.port,
		};

		const { initApiBridgeServer } = await import("../../src/lib/apiBridgeServer.ts");
		initApiBridgeServer();

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
		const dashboardServer = rememberServer(
			Bun.serve({
				port: 0,
				hostname: "127.0.0.1",
				fetch() {
					return new Response("dashboard");
				},
			})
		);

		const apiPort = dashboardServer.port + 1;
		globalThis.__testRuntimePorts = {
			apiPort,
			dashboardPort: dashboardServer.port,
		};

		const { initApiBridgeServer } = await import("../../src/lib/apiBridgeServer.ts");
		initApiBridgeServer();

		const response = await fetch(`http://127.0.0.1:${apiPort}/healthz`);
		const payload = await response.json();

		expect(response.status).toBe(404);
		expect(payload.error).toBe("not_found");
	});

	it("stops and resets bridge state cleanly", async () => {
		const dashboardServer = rememberServer(
			Bun.serve({
				port: 0,
				hostname: "127.0.0.1",
				fetch() {
					return Response.json({ ok: true });
				},
			})
		);

		const apiPort = dashboardServer.port + 1;
		globalThis.__testRuntimePorts = {
			apiPort,
			dashboardPort: dashboardServer.port,
		};

		const { initApiBridgeServer, stopApiBridgeServer } = await import(
			"../../src/lib/apiBridgeServer.ts"
		);
		initApiBridgeServer();
		expect(globalThis.__omnirouteApiBridgeStarted).toBe(true);
		expect(globalThis.__omnirouteApiBridgeServer).toBeDefined();

		stopApiBridgeServer();
		expect(globalThis.__omnirouteApiBridgeStarted).toBe(false);
		expect(globalThis.__omnirouteApiBridgeServer).toBeUndefined();
	});
});
