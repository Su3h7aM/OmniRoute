import { createHash, randomUUID } from "node:crypto";
import { STATUS_CODES } from "node:http";

export const WS_PUBLIC_PATHS = new Set(["/v1/ws", "/api/v1/ws"]);
export const WS_ALLOWED_ENDPOINTS = new Set([
  "/v1/chat/completions",
  "/api/v1/chat/completions",
  "/v1/messages",
  "/api/v1/messages",
  "/v1/responses",
  "/api/v1/responses",
  "/v1/completions",
  "/api/v1/completions",
]);

const HANDSHAKE_PATH = "/api/v1/ws";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const WS_QUERY_TOKEN_KEYS = ["api_key", "token", "access_token"];
const textDecoder = new TextDecoder();

type FetchLike = typeof fetch;
type BaseUrlProvider = string | (() => string);
type ActiveRequest = { abortController: AbortController };
type RequestEnvelope = {
  type: "request";
  id?: unknown;
  endpoint?: unknown;
  payload?: unknown;
};
type CancelEnvelope = {
  type: "cancel";
  id?: unknown;
};
type PingEnvelope = {
  type: "ping";
};
type SessionReadyPayload = {
  type: "session.ready";
  sessionId: string;
  path: string;
  wsAuth: boolean;
  authenticated: boolean;
  authType: string;
};

type WsBridgeSocketData = {
  sessionId: string;
  baseUrl: string;
  fetchImpl: FetchLike;
  requestHeaders: Record<string, string>;
  activeRequests: Map<string, ActiveRequest>;
  readyPayload: SessionReadyPayload;
};

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function jsonStringifySafe(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      type: "protocol.error",
      code: "serialization_failed",
      message: "Failed to serialize WebSocket payload",
    });
  }
}

function jsonResponse(status: number, body: string, headers: Record<string, string> = {}) {
  return new Response(body || "{}", {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function errorResponse(status: number, code: string, message: string, headers?: Record<string, string>) {
  return jsonResponse(
    status,
    JSON.stringify({
      error: {
        message,
        code,
      },
    }),
    headers
  );
}

function isWsPath(pathname: string) {
  return WS_PUBLIC_PATHS.has(pathname);
}

function normalizeEndpoint(rawEndpoint: unknown) {
  const endpoint = isText(rawEndpoint) ? rawEndpoint : "/v1/chat/completions";

  let parsed: URL;
  try {
    parsed = new URL(endpoint, "http://omniroute.local");
  } catch {
    return null;
  }

  if (parsed.origin !== "http://omniroute.local") {
    return null;
  }

  if (!WS_ALLOWED_ENDPOINTS.has(parsed.pathname)) {
    return null;
  }

  return `${parsed.pathname}${parsed.search}`;
}

function getForwardHeaders(requestUrl: string, requestHeaders: Headers) {
  const headers: Record<string, string> = {
    accept: "text/event-stream",
    "content-type": "application/json",
  };

  const authorization = requestHeaders.get("authorization");
  if (isText(authorization)) {
    headers.authorization = authorization;
  } else {
    const url = new URL(requestUrl, "http://omniroute.local");
    for (const key of WS_QUERY_TOKEN_KEYS) {
      const value = url.searchParams.get(key);
      if (isText(value)) {
        headers.authorization = `Bearer ${value.trim()}`;
        break;
      }
    }
  }

  const cookie = requestHeaders.get("cookie");
  if (isText(cookie)) {
    headers.cookie = cookie;
  }

  const origin = requestHeaders.get("origin");
  if (isText(origin)) {
    headers.origin = origin;
  }

  const forwardedFor = requestHeaders.get("x-forwarded-for");
  if (isText(forwardedFor)) {
    headers["x-forwarded-for"] = forwardedFor;
  }

  return headers;
}

function resolveBaseUrl(baseUrl: BaseUrlProvider) {
  return typeof baseUrl === "function" ? baseUrl() : baseUrl;
}

function getRequestHeaderSnapshot(requestHeaders: Headers) {
  return {
    authorization: requestHeaders.get("authorization") || "",
    cookie: requestHeaders.get("cookie") || "",
    origin: requestHeaders.get("origin") || "",
    "x-forwarded-for": requestHeaders.get("x-forwarded-for") || "",
  };
}

async function parseJsonSafe(text: string) {
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function performHandshake(
  fetchImpl: FetchLike,
  baseUrl: string,
  requestUrl: string,
  requestHeaders: Headers
) {
  const incomingUrl = new URL(requestUrl, baseUrl);
  const handshakeUrl = new URL(HANDSHAKE_PATH, baseUrl);

  for (const [key, value] of incomingUrl.searchParams.entries()) {
    handshakeUrl.searchParams.set(key, value);
  }
  handshakeUrl.searchParams.set("handshake", "1");

  const response = await fetchImpl(handshakeUrl, {
    method: "GET",
    headers: getRequestHeaderSnapshot(requestHeaders),
  });

  const bodyText = await response.text();
  const bodyJson = await parseJsonSafe(bodyText);

  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    bodyText,
    bodyJson,
    ok: response.ok,
  };
}

function sendJson(ws: Bun.ServerWebSocket<WsBridgeSocketData>, payload: unknown) {
  ws.send(jsonStringifySafe(payload));
}

function encodeWsFrame(opcode: number, payload = Buffer.alloc(0)) {
  const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const length = payloadBuffer.length;

  let header: Buffer;
  if (length < 126) {
    header = Buffer.allocUnsafe(2);
    header[1] = length;
  } else if (length <= 0xffff) {
    header = Buffer.allocUnsafe(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([header, payloadBuffer]);
}

function decodeClientFrames(buffer: Buffer) {
  const frames: Array<{ fin: boolean; opcode: number; payload: Buffer }> = [];
  let offset = 0;

  while (buffer.length - offset >= 2) {
    const byte1 = buffer[offset];
    const byte2 = buffer[offset + 1];
    const fin = (byte1 & 0x80) !== 0;
    const opcode = byte1 & 0x0f;
    const masked = (byte2 & 0x80) !== 0;
    let payloadLength = byte2 & 0x7f;
    let headerLength = 2;

    if (!masked) {
      throw new Error("Client WebSocket frames must be masked");
    }

    if (payloadLength === 126) {
      if (buffer.length - offset < 4) break;
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (buffer.length - offset < 10) break;
      const bigLength = buffer.readBigUInt64BE(offset + 2);
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("WebSocket payload too large");
      }
      payloadLength = Number(bigLength);
      headerLength = 10;
    }

    const totalLength = headerLength + 4 + payloadLength;
    if (buffer.length - offset < totalLength) break;

    const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
    const payload = Buffer.from(buffer.subarray(offset + headerLength + 4, offset + totalLength));
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }

    frames.push({ fin, opcode, payload });
    offset += totalLength;
  }

  return {
    frames,
    remaining: buffer.subarray(offset),
  };
}

function writeHttpError(socket: Bun.Socket<unknown>, status: number, body: string, headers: Record<string, string> = {}) {
  if (!socket.writable || socket.destroyed) return;

  const bodyBuffer = Buffer.from(body || "", "utf8");
  const statusText = STATUS_CODES[status] || "Error";
  const responseHeaders = {
    Connection: "close",
    "Content-Length": String(bodyBuffer.length),
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  };

  const head = [
    `HTTP/1.1 ${status} ${statusText}`,
    ...Object.entries(responseHeaders).map(([name, value]) => `${name}: ${value}`),
    "",
    "",
  ].join("\r\n");

  socket.write(head);
  socket.end(bodyBuffer);
}

function sendProtocolError(
  ws: Bun.ServerWebSocket<WsBridgeSocketData>,
  code: string,
  message: string,
  id: string | null = null
) {
  sendJson(ws, {
    type: "protocol.error",
    code,
    id,
    message,
  });
}

function decodeMessage(message: string | ArrayBuffer | Uint8Array) {
  if (typeof message === "string") {
    return message;
  }

  const payload = message instanceof ArrayBuffer ? new Uint8Array(message) : message;
  return textDecoder.decode(payload);
}

async function executeRequest(
  ws: Bun.ServerWebSocket<WsBridgeSocketData>,
  requestId: string,
  endpoint: string,
  payload: Record<string, unknown>,
  abortController: AbortController
) {
  const headers = {
    ...ws.data.requestHeaders,
    accept: payload.stream === false ? "application/json" : "text/event-stream",
    "content-type": "application/json",
    "x-omniroute-ws-session-id": ws.data.sessionId,
    "x-omniroute-ws-request-id": requestId,
  };

  const response = await ws.data.fetchImpl(new URL(endpoint, ws.data.baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: abortController.signal,
  });

  const contentType = response.headers.get("content-type") || "";
  sendJson(ws, {
    type: "response.start",
    id: requestId,
    status: response.status,
    ok: response.ok,
    contentType,
    endpoint,
  });

  if (contentType.includes("text/event-stream") && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk) {
          sendJson(ws, {
            type: "response.chunk",
            id: requestId,
            chunk,
          });
        }
      }

      const tail = decoder.decode();
      if (tail) {
        sendJson(ws, {
          type: "response.chunk",
          id: requestId,
          chunk: tail,
        });
      }
    } finally {
      ws.data.activeRequests.delete(requestId);
    }

    sendJson(ws, {
      type: response.ok ? "response.completed" : "response.error",
      id: requestId,
      status: response.status,
      ok: response.ok,
    });
    return;
  }

  const bodyText = await response.text();
  const parsedBody = await parseJsonSafe(bodyText);
  const body = parsedBody ?? bodyText;

  ws.data.activeRequests.delete(requestId);
  sendJson(ws, {
    type: response.ok ? "response.output" : "response.error",
    id: requestId,
    status: response.status,
    ok: response.ok,
    body,
  });
  sendJson(ws, {
    type: "response.completed",
    id: requestId,
    status: response.status,
    ok: response.ok,
  });
}

async function handleSocketMessage(
  ws: Bun.ServerWebSocket<WsBridgeSocketData>,
  message: string | ArrayBuffer | Uint8Array
) {
  await handleParsedSocketMessage(ws, decodeMessage(message));
}

function abortActiveRequests(activeRequests: Map<string, ActiveRequest>) {
  for (const active of activeRequests.values()) {
    active.abortController.abort();
  }
  activeRequests.clear();
}

function abortAllRequests(ws: Bun.ServerWebSocket<WsBridgeSocketData>) {
  abortActiveRequests(ws.data.activeRequests);
}

function sendTargetJson(
  target: Bun.ServerWebSocket<WsBridgeSocketData> | LegacyWebSocketSession,
  payload: unknown
) {
  if ("data" in target) {
    sendJson(target, payload);
    return;
  }

  target.sendJson(payload);
}

function sendTargetProtocolError(
  target: Bun.ServerWebSocket<WsBridgeSocketData> | LegacyWebSocketSession,
  code: string,
  message: string,
  id: string | null = null
) {
  if ("data" in target) {
    sendProtocolError(target, code, message, id);
    return;
  }

  target.sendProtocolError(code, message, id);
}

class LegacyWebSocketSession {
  baseUrl: string;
  fetchImpl: FetchLike;
  idleTimeoutMs: number;
  pingIntervalMs: number;
  socket: Bun.Socket<unknown>;
  requestHeaders: Record<string, string>;
  requestUrl: string;
  sessionId = randomUUID();
  closed = false;
  buffer = Buffer.alloc(0);
  fragmentOpcode: number | null = null;
  fragmentParts: Buffer[] = [];
  activeRequests = new Map<string, ActiveRequest>();
  lastSeenAt = Date.now();
  pingTimer: ReturnType<typeof setInterval>;

  constructor(options: {
    baseUrl: string;
    fetchImpl: FetchLike;
    idleTimeoutMs: number;
    pingIntervalMs: number;
    socket: Bun.Socket<unknown>;
    requestUrl: string;
    requestHeaders: Record<string, string>;
  }) {
    this.baseUrl = options.baseUrl;
    this.fetchImpl = options.fetchImpl;
    this.idleTimeoutMs = options.idleTimeoutMs;
    this.pingIntervalMs = options.pingIntervalMs;
    this.socket = options.socket;
    this.requestUrl = options.requestUrl;
    this.requestHeaders = options.requestHeaders;

    this.pingTimer = setInterval(() => {
      if (this.closed) return;
      if (Date.now() - this.lastSeenAt >= this.idleTimeoutMs) {
        this.close(1001, "idle_timeout");
        return;
      }
      this.sendFrame(0x9);
    }, this.pingIntervalMs);

    this.socket.setNoDelay?.(true);
    this.socket.on?.("data", (chunk: Buffer) => {
      this.onData(chunk).catch((error: unknown) => {
        this.sendProtocolError(
          "frame_decode_failed",
          error instanceof Error ? error.message : String(error)
        );
      });
    });
    this.socket.on?.("close", () => this.dispose());
    this.socket.on?.("end", () => this.dispose());
    this.socket.on?.("error", () => this.dispose());
  }

  sendFrame(opcode: number, payload?: Buffer | string) {
    if (this.closed || this.socket.destroyed) return;
    this.socket.write(encodeWsFrame(opcode, payload));
  }

  sendJson(payload: unknown) {
    this.sendFrame(0x1, Buffer.from(jsonStringifySafe(payload), "utf8"));
  }

  sendProtocolError(code: string, message: string, id: string | null = null) {
    this.sendJson({ type: "protocol.error", code, id, message });
  }

  async onData(chunk: Buffer) {
    this.lastSeenAt = Date.now();
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const parsed = decodeClientFrames(this.buffer);
    this.buffer = parsed.remaining;

    for (const frame of parsed.frames) {
      await this.handleFrame(frame);
    }
  }

  async handleFrame(frame: { fin: boolean; opcode: number; payload: Buffer }) {
    switch (frame.opcode) {
      case 0x0:
        if (this.fragmentOpcode === null) {
          this.sendProtocolError("unexpected_continuation", "Unexpected continuation frame");
          return;
        }
        this.fragmentParts.push(frame.payload);
        if (frame.fin) {
          const payload = Buffer.concat(this.fragmentParts);
          const opcode = this.fragmentOpcode;
          this.fragmentOpcode = null;
          this.fragmentParts = [];
          await this.handleDataFrame(opcode, payload);
        }
        return;
      case 0x1:
      case 0x2:
        if (!frame.fin) {
          this.fragmentOpcode = frame.opcode;
          this.fragmentParts = [frame.payload];
          return;
        }
        await this.handleDataFrame(frame.opcode, frame.payload);
        return;
      case 0x8:
        this.close();
        return;
      case 0x9:
        this.sendFrame(0xa, frame.payload);
        return;
      case 0xa:
        this.lastSeenAt = Date.now();
        return;
      default:
        this.sendProtocolError("unsupported_opcode", `Unsupported opcode ${frame.opcode}`);
    }
  }

  async handleDataFrame(opcode: number, payload: Buffer) {
    if (opcode !== 0x1) {
      this.sendProtocolError("unsupported_payload", "Only UTF-8 text messages are supported");
      return;
    }

    await handleParsedSocketMessage(this, decodeMessage(payload));
  }

  async executeRequest(
    requestId: string,
    endpoint: string,
    payload: Record<string, unknown>,
    abortController: AbortController
  ) {
    const headers = {
      ...this.requestHeaders,
      accept: payload.stream === false ? "application/json" : "text/event-stream",
      "content-type": "application/json",
      "x-omniroute-ws-session-id": this.sessionId,
      "x-omniroute-ws-request-id": requestId,
    };

    const response = await this.fetchImpl(new URL(endpoint, this.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });

    const contentType = response.headers.get("content-type") || "";
    this.sendJson({
      type: "response.start",
      id: requestId,
      status: response.status,
      ok: response.ok,
      contentType,
      endpoint,
    });

    if (contentType.includes("text/event-stream") && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (chunk) {
            this.sendJson({ type: "response.chunk", id: requestId, chunk });
          }
        }

        const tail = decoder.decode();
        if (tail) {
          this.sendJson({ type: "response.chunk", id: requestId, chunk: tail });
        }
      } finally {
        this.activeRequests.delete(requestId);
      }

      this.sendJson({
        type: response.ok ? "response.completed" : "response.error",
        id: requestId,
        status: response.status,
        ok: response.ok,
      });
      return;
    }

    const bodyText = await response.text();
    const parsedBody = await parseJsonSafe(bodyText);
    const body = parsedBody ?? bodyText;

    this.activeRequests.delete(requestId);
    this.sendJson({
      type: response.ok ? "response.output" : "response.error",
      id: requestId,
      status: response.status,
      ok: response.ok,
      body,
    });
    this.sendJson({ type: "response.completed", id: requestId, status: response.status, ok: response.ok });
  }

  close(code = 1000, reason = "normal_closure") {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pingTimer);
    abortActiveRequests(this.activeRequests);

    const reasonBuffer = Buffer.from(reason, "utf8");
    const payload = Buffer.allocUnsafe(2 + reasonBuffer.length);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);
    this.sendFrame(0x8, payload);
    this.socket.end();
    setTimeout(() => {
      if (!this.socket.destroyed) {
        this.socket.destroy();
      }
    }, 50).unref?.();
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pingTimer);
    abortActiveRequests(this.activeRequests);
  }
}

async function handleParsedSocketMessage(
  target: Bun.ServerWebSocket<WsBridgeSocketData> | LegacyWebSocketSession,
  rawMessage: string
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    sendTargetProtocolError(target, "invalid_json", "WebSocket message must be valid JSON");
    return;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    sendTargetProtocolError(target, "invalid_envelope", "WebSocket message must be an object");
    return;
  }

  const envelope = parsed as RequestEnvelope | CancelEnvelope | PingEnvelope;
  const sessionId = "data" in target ? target.data.sessionId : target.sessionId;
  const activeRequests = "data" in target ? target.data.activeRequests : target.activeRequests;

  if (envelope.type === "ping") {
    sendTargetJson(target, { type: "pong", sessionId });
    return;
  }

  if (envelope.type === "cancel") {
    const requestId = isText(envelope.id) ? envelope.id : null;
    if (!requestId) {
      sendTargetProtocolError(target, "invalid_cancel", "cancel envelopes require a string id");
      return;
    }

    const active = activeRequests.get(requestId);
    if (!active) {
      sendTargetProtocolError(target, "unknown_request", "No active request matches the provided id", requestId);
      return;
    }

    active.abortController.abort();
    return;
  }

  if (envelope.type !== "request") {
    sendTargetProtocolError(target, "unsupported_type", "Supported message types are request, cancel, and ping");
    return;
  }

  const requestId = isText(envelope.id) ? envelope.id : null;
  if (!requestId) {
    sendTargetProtocolError(target, "invalid_request_id", "request envelopes require a non-empty id");
    return;
  }

  if (activeRequests.has(requestId)) {
    sendTargetProtocolError(target, "duplicate_request", "A request with this id is already in flight", requestId);
    return;
  }

  if (!envelope.payload || typeof envelope.payload !== "object" || Array.isArray(envelope.payload)) {
    sendTargetProtocolError(target, "invalid_payload", "request envelopes require an object payload", requestId);
    return;
  }

  const endpoint = normalizeEndpoint(envelope.endpoint);
  if (!endpoint) {
    sendTargetProtocolError(target, "invalid_endpoint", "Endpoint must target a supported /v1 chat surface", requestId);
    return;
  }

  const payload = envelope.payload as Record<string, unknown>;
  const requestPayload = { ...payload, stream: payload.stream === undefined ? true : payload.stream };
  const abortController = new AbortController();
  activeRequests.set(requestId, { abortController });

  const execute = "data" in target ? executeRequest : target.executeRequest.bind(target);
  execute(target as Bun.ServerWebSocket<WsBridgeSocketData>, requestId, endpoint, requestPayload, abortController).catch(
    (error: unknown) => {
      sendTargetJson(target, {
        type: abortController.signal.aborted ? "response.cancelled" : "response.error",
        id: requestId,
        code: abortController.signal.aborted ? "client_cancelled" : "request_failed",
        message: error instanceof Error ? error.message : String(error),
      });
      activeRequests.delete(requestId);
    }
  );
}

export function createOmnirouteWsBridge({
  baseUrl,
  fetchImpl = fetch,
  pingIntervalMs = 25_000,
  idleTimeoutMs = 90_000,
}: {
  baseUrl: BaseUrlProvider;
  fetchImpl?: FetchLike;
  pingIntervalMs?: number;
  idleTimeoutMs?: number;
}) {
  if (typeof baseUrl !== "function" && !isText(baseUrl)) {
    throw new Error("createOmnirouteWsBridge requires a baseUrl");
  }

  return {
    isWsPath,
    async fetch(req: Request, server: Bun.Server) {
      const url = new URL(req.url);
      if (!isWsPath(url.pathname)) {
        return null;
      }

      const upgradeHeader = String(req.headers.get("upgrade") || "").toLowerCase();
      if (upgradeHeader !== "websocket") {
        return errorResponse(426, "upgrade_required", "Upgrade Required", {
          Upgrade: "websocket",
        });
      }

      try {
        const resolvedBaseUrl = resolveBaseUrl(baseUrl);
        if (!isText(resolvedBaseUrl)) {
          return errorResponse(
            500,
            "websocket_bridge_failed",
            "WebSocket bridge baseUrl is unavailable"
          );
        }

        const handshake = await performHandshake(fetchImpl, resolvedBaseUrl, req.url, req.headers);
        if (!handshake.ok) {
          return jsonResponse(handshake.status, handshake.bodyText || "{}", handshake.headers);
        }

        const sessionId = randomUUID();
        const upgraded = server.upgrade(req, {
          data: {
            sessionId,
            baseUrl: resolvedBaseUrl,
            fetchImpl,
            requestHeaders: getForwardHeaders(req.url, req.headers),
            activeRequests: new Map(),
            readyPayload: {
              type: "session.ready",
              sessionId,
              path: isText(handshake.bodyJson?.path) ? handshake.bodyJson.path : url.pathname,
              wsAuth: handshake.bodyJson?.wsAuth === true,
              authenticated: handshake.bodyJson?.authenticated === true,
              authType: isText(handshake.bodyJson?.authType) ? handshake.bodyJson.authType : "none",
            },
          } satisfies WsBridgeSocketData,
        });

        if (!upgraded) {
          return errorResponse(400, "bad_websocket_handshake", "WebSocket upgrade failed");
        }

        return undefined;
      } catch (error) {
        return errorResponse(
          500,
          "websocket_bridge_failed",
          error instanceof Error ? error.message : String(error)
        );
      }
    },
    async handleUpgrade(req: { url?: string; headers: Record<string, string | string[] | undefined> }, socket: Bun.Socket<unknown>, head?: Buffer) {
      const pathname = new URL(req.url || "/", resolveBaseUrl(baseUrl)).pathname;
      if (!isWsPath(pathname)) {
        return false;
      }

      const upgradeHeader = String(req.headers.upgrade || "").toLowerCase();
      if (upgradeHeader !== "websocket") {
        writeHttpError(
          socket,
          426,
          JSON.stringify({
            error: {
              message: "Upgrade Required",
              code: "upgrade_required",
            },
          }),
          { Upgrade: "websocket" }
        );
        return true;
      }

      try {
        const resolvedBaseUrl = resolveBaseUrl(baseUrl);
        if (!isText(resolvedBaseUrl)) {
          writeHttpError(
            socket,
            500,
            JSON.stringify({
              error: {
                message: "WebSocket bridge baseUrl is unavailable",
                code: "websocket_bridge_failed",
              },
            })
          );
          return true;
        }

        const requestHeaders = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
          if (Array.isArray(value)) {
            for (const entry of value) {
              requestHeaders.append(name, entry);
            }
          } else if (value !== undefined) {
            requestHeaders.set(name, value);
          }
        }

        const handshake = await performHandshake(fetchImpl, resolvedBaseUrl, req.url || "/", requestHeaders);
        if (!handshake.ok) {
          writeHttpError(socket, handshake.status, handshake.bodyText || "{}", handshake.headers);
          return true;
        }

        const wsKey = requestHeaders.get("sec-websocket-key");
        if (!isText(wsKey)) {
          writeHttpError(
            socket,
            400,
            JSON.stringify({
              error: {
                message: "Missing sec-websocket-key header",
                code: "bad_websocket_handshake",
              },
            })
          );
          return true;
        }

        const acceptKey = createHash("sha1").update(`${wsKey}${WS_GUID}`).digest("base64");
        const headers = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${acceptKey}`,
          "",
          "",
        ].join("\r\n");

        socket.write(headers);
        if (head && head.length > 0 && typeof socket.unshift === "function") {
          socket.unshift(head);
        }

        const session = new LegacyWebSocketSession({
          baseUrl: resolvedBaseUrl,
          fetchImpl,
          idleTimeoutMs,
          pingIntervalMs,
          socket,
          requestUrl: req.url || pathname,
          requestHeaders: getForwardHeaders(req.url || pathname, requestHeaders),
        });
        session.sendJson({
          type: "session.ready",
          sessionId: session.sessionId,
          path: isText(handshake.bodyJson?.path) ? handshake.bodyJson.path : pathname,
          wsAuth: handshake.bodyJson?.wsAuth === true,
          authenticated: handshake.bodyJson?.authenticated === true,
          authType: isText(handshake.bodyJson?.authType) ? handshake.bodyJson.authType : "none",
        });
        return true;
      } catch (error) {
        writeHttpError(
          socket,
          500,
          JSON.stringify({
            error: {
              message: error instanceof Error ? error.message : String(error),
              code: "websocket_bridge_failed",
            },
          })
        );
        return true;
      }
    },
    websocket: {
      data: {} as WsBridgeSocketData,
      idleTimeout: Math.max(1, Math.ceil(idleTimeoutMs / 1000)),
      sendPings: pingIntervalMs > 0,
      open(ws: Bun.ServerWebSocket<WsBridgeSocketData>) {
        sendJson(ws, ws.data.readyPayload);
      },
      message(ws: Bun.ServerWebSocket<WsBridgeSocketData>, message: string | ArrayBuffer | Uint8Array) {
        return handleSocketMessage(ws, message);
      },
      close(ws: Bun.ServerWebSocket<WsBridgeSocketData>) {
        abortAllRequests(ws);
      },
      error(ws: Bun.ServerWebSocket<WsBridgeSocketData>, error: Error) {
        sendJson(ws, {
          type: "response.error",
          code: "websocket_error",
          message: error.message,
        });
        abortAllRequests(ws);
      },
    } satisfies Bun.WebSocketHandler<WsBridgeSocketData>,
  };
}
