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
	bridgeId: string;
	upstream?: WebSocket;
	pendingMessages?: Array<string | ArrayBuffer | Uint8Array>;
};

const pendingUpstreams = new Map<string, WebSocket>();
const linkedSockets = new Map<string, Set<ServerWebSocket<BridgeWebSocketData>>>();

function clearBridgeState(): void {
	pendingUpstreams.clear();
	linkedSockets.clear();
}

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

function setApiBridgeState(server: Server | undefined, started: boolean): void {
	globalThis.__omnirouteApiBridgeServer = server;
	globalThis.__omnirouteApiBridgeStarted = started;
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

function getRequestPath(requestUrl: string): string {
	const url = new URL(requestUrl);
	return `${url.pathname}${url.search}`;
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

function getWebSocketProtocols(request: Request): string[] | undefined {
	const protocols = request.headers.get("sec-websocket-protocol");
	if (!protocols) return undefined;

	const values = protocols
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	return values.length > 0 ? values : undefined;
}

function createUpstreamWebSocket(request: Request, dashboardPort: number): WebSocket {
	const headers = createDashboardHeaders(request, dashboardPort);
	const protocols = getWebSocketProtocols(request);
	const url = toWebSocketUrl(request.url, dashboardPort);
	if (protocols) {
		return new WebSocket(url, protocols, { headers });
	}
	return new WebSocket(url, undefined, { headers });
}

function forEachLinkedSocket(
	bridgeId: string,
	callback: (socket: ServerWebSocket<BridgeWebSocketData>) => void
) {
	linkedSockets.get(bridgeId)?.forEach(callback);
}

function getOrCreateLinkedSockets(bridgeId: string): Set<ServerWebSocket<BridgeWebSocketData>> {
	const existing = linkedSockets.get(bridgeId);
	if (existing) return existing;
	const sockets = new Set<ServerWebSocket<BridgeWebSocketData>>();
	linkedSockets.set(bridgeId, sockets);
	return sockets;
}

function bridgeWebSockets(
	request: Request,
	server: Server<BridgeWebSocketData>,
	dashboardPort: number
): Response {
	const bridgeId = crypto.randomUUID();
	const upstream = createUpstreamWebSocket(request, dashboardPort);
	pendingUpstreams.set(bridgeId, upstream);

	const upgraded = server.upgrade(request, {
		data: { bridgeId, pendingMessages: [] } as BridgeWebSocketData,
	});
	if (!upgraded) {
		pendingUpstreams.delete(bridgeId);
		upstream.close();
		return createProxyErrorResponse("Failed to upgrade API bridge websocket");
	}

	upstream.addEventListener("open", () => {
		forEachLinkedSocket(bridgeId, (socket) => {
			const queuedMessages = socket.data.pendingMessages || [];
			for (const message of queuedMessages) {
				upstream.send(message);
			}
			socket.data.pendingMessages = [];
		});
	});

	upstream.addEventListener("message", (event) => {
		forEachLinkedSocket(bridgeId, (socket) => {
			socket.send(event.data);
		});
	});

	const closeLinkedSockets = () => {
		pendingUpstreams.delete(bridgeId);
		forEachLinkedSocket(bridgeId, (socket) => {
			socket.close();
		});
		linkedSockets.delete(bridgeId);
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
			const requestPath = getRequestPath(request.url);
			const pathname = requestPath.split("?", 1)[0] || "/";
			if (!isOpenAiCompatiblePath(pathname)) {
				return createNotFoundResponse();
			}

			if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
				return bridgeWebSockets(request, server, dashboardPort);
			}

			return proxyHttpRequest(request, dashboardPort);
		},
		websocket: {
			open(ws) {
				const upstream = pendingUpstreams.get(ws.data.bridgeId);
				if (!upstream) {
					ws.close();
					return;
				}
				ws.data.upstream = upstream;
				getOrCreateLinkedSockets(ws.data.bridgeId).add(ws);
			},
			message(ws, message) {
				const upstream = ws.data.upstream;
				if (!upstream || upstream.readyState === WebSocket.CONNECTING) {
					ws.data.pendingMessages?.push(message);
					return;
				}
				if (upstream.readyState === WebSocket.OPEN) {
					upstream.send(message);
				}
			},
			close(ws) {
				pendingUpstreams.delete(ws.data.bridgeId);
				const sockets = linkedSockets.get(ws.data.bridgeId);
				sockets?.delete(ws);
				if (sockets && sockets.size === 0) {
					linkedSockets.delete(ws.data.bridgeId);
				}
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

export function stopApiBridgeServer(): void {
	globalThis.__omnirouteApiBridgeServer?.stop(true);
	clearBridgeState();
	setApiBridgeState(undefined, false);
}

export function initApiBridgeServer(): void {
	if (globalThis.__omnirouteApiBridgeStarted && globalThis.__omnirouteApiBridgeServer) {
		return;
	}

	const { apiPort, dashboardPort } = globalThis.__testRuntimePorts || getRuntimePorts();
	if (apiPort === dashboardPort) {
		setApiBridgeState(undefined, false);
		return;
	}

	const host = process.env.API_HOST || "127.0.0.1";
	const server = createApiBridgeServer(apiPort, dashboardPort, host);
	setApiBridgeState(server, true);
	console.log(`[API Bridge] Listening on ${host}:${apiPort} -> dashboard:${dashboardPort}`);
}
