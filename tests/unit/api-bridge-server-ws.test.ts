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

describe("apiBridgeServer websocket bridge", () => {
	beforeEach(() => {
		globalThis.__omnirouteApiBridgeStarted = undefined;
		globalThis.fetch = originalFetch;
	});

	afterEach(async () => {
		await cleanupBridgeTestState();
	});

	it("forwards websocket messages between the API port and dashboard port", async () => {
		const dashboardServer = rememberServer(
			Bun.serve({
				port: 0,
				hostname: "127.0.0.1",
				fetch(request, server) {
					if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
						const upgraded = server.upgrade(request, { data: {} });
						return upgraded
							? undefined
							: new Response("upgrade failed", { status: 500 });
					}
					return new Response("dashboard");
				},
				websocket: {
					open(ws) {
						ws.send(JSON.stringify({ source: "dashboard", type: "ready" }));
					},
					message(ws, message) {
						const payload =
							typeof message === "string" ? message : Buffer.from(message).toString();
						ws.send(JSON.stringify({ source: "dashboard", echo: payload }));
					},
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

		const socket = new WebSocket(`ws://127.0.0.1:${apiPort}/v1/realtime`);
		const messages: string[] = [];

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error("timed out waiting for websocket")),
				5000
			);

			socket.addEventListener("open", () => {
				socket.send("hello bridge");
			});
			socket.addEventListener("message", (event) => {
				messages.push(String(event.data));
				if (messages.length >= 2) {
					clearTimeout(timeout);
					resolve();
				}
			});
			socket.addEventListener("error", () => {
				clearTimeout(timeout);
				reject(new Error("websocket bridge error"));
			});
		});

		expect(messages).toEqual([
			JSON.stringify({ source: "dashboard", type: "ready" }),
			JSON.stringify({ source: "dashboard", echo: "hello bridge" }),
		]);

		socket.close();
	});
});
