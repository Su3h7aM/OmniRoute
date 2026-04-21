import { getRuntimePorts } from "@/lib/runtime/ports";
import { getApiBridgeTimeoutConfig } from "@/shared/utils/runtimeTimeouts";

const API_BRIDGE_TIMEOUTS = getApiBridgeTimeoutConfig(process.env, (message) => {
	console.warn(`[API Bridge] ${message}`);
});

const OPENAI_COMPAT_PATHS = [
	/^\/v1(?:\/|$)/,
	/^\/chat\/completions(?:\?|$)/,
	/^\/responses(?:\?|$)/,
	/^\/models(?:\?|$)/,
	/^\/codex(?:\/|\?|$)/,
	/^\/api\/oauth(?:\/|$)/,
	/^\/callback(?:\?|$)/,
];

type BridgeWebSocketData = {
	upstream?: WebSocket;
};

declare global {
	var __omnirouteApiBridgeStarted: boolean | undefined;
	var __omnirouteApiBridgeServer: Server | undefined;
	var __testRuntimePorts:
		| {
				apiPort: number;
				dashboardPort: number;
		  }
		| undefined;
}

function isOpenAiCompatiblePath(pathname: string): boolean {
	return OPENAI_COMPAT_PATHS.some((pattern) => pattern.test(pathname));
}

function createNotFoundResponse(): Response {
	return Response.json(
		{
			error: "not_found",
			message: "API port only serves OpenAI-compatible routes.",
		},
		{ status: 404 }
	);
}

function createTimeoutResponse(): Response {
	return Response.json(
		{
			error: "api_bridge_timeout",
			detail: `Proxy request timed out after ${API_BRIDGE_TIMEOUTS.proxyTimeoutMs}ms`,
		},
		{ status: 504 }
	);
}

function createProxyErrorResponse(error: unknown): Response {
	return Response.json(
		{
			error: "api_bridge_unavailable",
			detail: String(error instanceof Error ? error.message : error),
		},
		{ status: 502 }
	);
}

function getRequestBody(request: Request): BodyInit | undefined {
	if (request.method === "GET" || request.method === "HEAD") {
		return undefined;
	}
	return request.body;
}

function createDashboardUrl(requestUrl: string, dashboardPort: number): URL {
	const targetUrl = new URL(requestUrl);
	targetUrl.hostname = "127.0.0.1";
	targetUrl.port = String(dashboardPort);
	return targetUrl;
}

function createDashboardHeaders(request: Request, dashboardPort: number): Headers {
	const headers = new Headers(request.headers);
	headers.set("host", `127.0.0.1:${dashboardPort}`);
	return headers;
}

async function proxyHttpRequest(request: Request, dashboardPort: number): Promise<Response> {
	const targetUrl = createDashboardUrl(request.url, dashboardPort);
	const headers = createDashboardHeaders(request, dashboardPort);

	try {
		const timeoutSignal = AbortSignal.timeout(API_BRIDGE_TIMEOUTS.proxyTimeoutMs);
		const response = await fetch(targetUrl, {
			method: request.method,
			headers,
			body: getRequestBody(request),
			signal: timeoutSignal,
			duplex: "half",
		});
		return new Response(response.body, {
			status: response.status,
			headers: response.headers,
		});
	} catch (error) {
		if (error instanceof Error && error.name === "TimeoutError") {
			return createTimeoutResponse();
		}
		return createProxyErrorResponse(error);
	}
}

function toWebSocketUrl(requestUrl: string, dashboardPort: number): string {
	const url = createDashboardUrl(requestUrl, dashboardPort);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url.toString();
}

function getWebSocketOptions(request: Request, dashboardPort: number) {
	const headers = createDashboardHeaders(request, dashboardPort);
	const protocols = request.headers.get("sec-websocket-protocol");
	if (!protocols) {
		return { headers };
	}
	return {
		headers,
		protocols: protocols
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean),
	};
}

function forEachLinkedSocket(
	server: Server<BridgeWebSocketData>,
	upstream: WebSocket,
	callback: (socket: ServerWebSocket<BridgeWebSocketData>) => void
) {
	server.pendingWebSockets?.forEach((socket) => {
		if (socket.data.upstream === upstream) {
			callback(socket);
		}
	});
}

function bridgeWebSockets(
	request: Request,
	server: Server<BridgeWebSocketData>,
	dashboardPort: number
): Response {
	const upgraded = server.upgrade(request, { data: {} as BridgeWebSocketData });
	if (!upgraded) {
		return createProxyErrorResponse("Failed to upgrade API bridge websocket");
	}

	const upstream = new WebSocket(
		toWebSocketUrl(request.url, dashboardPort),
		getWebSocketOptions(request, dashboardPort)
	);

	server.pendingWebSockets?.forEach((socket) => {
		if (!socket.data.upstream) {
			socket.data.upstream = upstream;
		}
	});

	upstream.addEventListener("message", (event) => {
		forEachLinkedSocket(server, upstream, (socket) => {
			socket.send(event.data);
		});
	});

	const closeLinkedSockets = () => {
		forEachLinkedSocket(server, upstream, (socket) => {
			socket.close();
		});
	};

	upstream.addEventListener("close", closeLinkedSockets);
	upstream.addEventListener("error", closeLinkedSockets);

	return new Response(null);
}

function createApiBridgeServer(apiPort: number, dashboardPort: number, host: string): Server {
	return Bun.serve<BridgeWebSocketData>({
		port: apiPort,
		hostname: host,
		idleTimeout: Math.max(1, Math.ceil(API_BRIDGE_TIMEOUTS.serverKeepAliveTimeoutMs / 1000)),
		fetch(request, server) {
			const pathname = new URL(request.url).pathname;
			if (!isOpenAiCompatiblePath(pathname)) {
				return createNotFoundResponse();
			}

			if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
				return bridgeWebSockets(request, server, dashboardPort);
			}

			return proxyHttpRequest(request, dashboardPort);
		},
		websocket: {
			message(ws, message) {
				ws.data.upstream?.send(message);
			},
			close(ws) {
				ws.data.upstream?.close();
			},
		},
		error(error) {
			if ((error as NodeJS.ErrnoException)?.code === "EADDRINUSE") {
				console.warn(
					`[API Bridge] Port ${apiPort} is already in use. API bridge disabled. (dashboard: ${dashboardPort})`
				);
				return createProxyErrorResponse(error);
			}
			console.warn(
				"[API Bridge] Failed to start:",
				error instanceof Error ? error.message : error
			);
			return createProxyErrorResponse(error);
		},
	});
}

export function initApiBridgeServer(): void {
	if (globalThis.__omnirouteApiBridgeStarted) return;

	const { apiPort, dashboardPort } = globalThis.__testRuntimePorts || getRuntimePorts();
	if (apiPort === dashboardPort) return;

	const host = process.env.API_HOST || "127.0.0.1";
	const server = createApiBridgeServer(apiPort, dashboardPort, host);
	globalThis.__omnirouteApiBridgeServer = server;
	globalThis.__omnirouteApiBridgeStarted = true;
	console.log(`[API Bridge] Listening on ${host}:${apiPort} -> dashboard:${dashboardPort}`);
}
