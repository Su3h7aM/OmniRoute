import { test } from "bun:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const isBunRuntime = typeof Bun !== "undefined";
const execFileAsync = promisify(childProcess.execFile);
const { createOmnirouteWsBridge } = await import("../../scripts/v1-ws-bridge.ts");

if (isBunRuntime) {
	console.warn(
		"[tests] Skipping v1-ws-bridge.test.ts on Bun: known node:http/WebSocket upgrade incompatibility in Bun runtime; re-evaluate after Bun fix or migrate bridge test to Bun.serve"
	);
}

function listen(server) {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			resolve(address.port);
		});
	});
}

function close(server) {
	return new Promise((resolve) => {
		server.close(() => resolve());
	});
}

function readRequestBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

async function runNodeWsClient(port) {
	const clientScriptPath = path.join(
		os.tmpdir(),
		`omniroute-v1-ws-client-${Date.now()}-${Math.random()}.mjs`
	);
	const clientScript = `
    import net from "node:net";
    import { randomBytes } from "node:crypto";

    const port = Number(process.argv[2]);

    function waitFor(predicate, timeoutMs = 5000, label = "condition") {
      const startedAt = Date.now();
      return new Promise((resolve, reject) => {
        const timer = setInterval(() => {
          try {
            const value = predicate();
            if (value) {
              clearInterval(timer);
              resolve(value);
              return;
            }
            if (Date.now() - startedAt >= timeoutMs) {
              clearInterval(timer);
              reject(new Error("Timed out waiting for " + label));
            }
          } catch (error) {
            clearInterval(timer);
            reject(error);
          }
        }, 10);
      });
    }

    function encodeMaskedTextFrame(text) {
      const payload = Buffer.from(text, "utf8");
      const length = payload.length;
      const mask = randomBytes(4);
      let header;

      if (length < 126) {
        header = Buffer.allocUnsafe(2);
        header[1] = 0x80 | length;
      } else if (length <= 0xffff) {
        header = Buffer.allocUnsafe(4);
        header[1] = 0x80 | 126;
        header.writeUInt16BE(length, 2);
      } else {
        header = Buffer.allocUnsafe(10);
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(length), 2);
      }

      header[0] = 0x81;
      const maskedPayload = Buffer.from(payload);
      for (let index = 0; index < maskedPayload.length; index += 1) {
        maskedPayload[index] ^= mask[index % 4];
      }
      return Buffer.concat([header, mask, maskedPayload]);
    }

    function decodeServerFrames(buffer) {
      const frames = [];
      let offset = 0;

      while (buffer.length - offset >= 2) {
        const byte1 = buffer[offset];
        const byte2 = buffer[offset + 1];
        const opcode = byte1 & 0x0f;
        let payloadLength = byte2 & 0x7f;
        let headerLength = 2;

        if (byte2 & 0x80) {
          throw new Error("Server frames must not be masked");
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

        const totalLength = headerLength + payloadLength;
        if (buffer.length - offset < totalLength) break;

        frames.push({
          opcode,
          payload: buffer.subarray(offset + headerLength, offset + totalLength),
        });
        offset += totalLength;
      }

      return { frames, remaining: buffer.subarray(offset) };
    }

    const messages = [];
    const errors = [];
    let handshakeDone = false;
    let handshakeBuffer = Buffer.alloc(0);
    let frameBuffer = Buffer.alloc(0);

    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.on("data", (chunk) => {
      if (!handshakeDone) {
        handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
        const boundary = handshakeBuffer.indexOf("\\r\\n\\r\\n");
        if (boundary === -1) return;

        const head = handshakeBuffer.subarray(0, boundary).toString("utf8");
        if (!head.startsWith("HTTP/1.1 101")) {
          throw new Error(head);
        }
        handshakeDone = true;
        frameBuffer = Buffer.concat([frameBuffer, handshakeBuffer.subarray(boundary + 4)]);
        handshakeBuffer = Buffer.alloc(0);
      } else {
        frameBuffer = Buffer.concat([frameBuffer, chunk]);
      }

      const parsed = decodeServerFrames(frameBuffer);
      frameBuffer = parsed.remaining;
      for (const frame of parsed.frames) {
        if (frame.opcode === 0x1) {
          messages.push(JSON.parse(Buffer.from(frame.payload).toString("utf8")));
        }
      }
    });
    socket.on("error", (error) => {
      errors.push(String(error?.message || error));
    });

    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    socket.write([
      "GET /v1/ws HTTP/1.1",
      "Host: 127.0.0.1:" + port,
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Key: " + randomBytes(16).toString("base64"),
      "Sec-WebSocket-Version: 13",
      "",
      "",
    ].join("\\r\\n"));

    await waitFor(() => messages.find((entry) => entry.type === "session.ready"), 5000, "session.ready");

    socket.write(encodeMaskedTextFrame("{bad json"));
    await waitFor(() => messages.find((entry) => entry.type === "protocol.error"), 5000, "protocol.error");

    socket.write(
      encodeMaskedTextFrame(
        JSON.stringify({
          type: "request",
          id: "req-1",
          endpoint: "/v1/chat/completions",
          payload: {
            model: "openai/gpt-4.1-mini",
            messages: [{ role: "user", content: "alpha" }],
          },
        })
      )
    );
    socket.write(
      encodeMaskedTextFrame(
        JSON.stringify({
          type: "request",
          id: "req-2",
          endpoint: "/v1/messages",
          payload: {
            model: "anthropic/claude-3.7-sonnet",
            messages: [{ role: "user", content: "beta" }],
          },
        })
      )
    );

    await waitFor(() => {
      const completedIds = messages
        .filter((entry) => entry.type === "response.completed")
        .map((entry) => entry.id);
      return completedIds.includes("req-1") && completedIds.includes("req-2");
    }, 10000, "response.completed");

    socket.end();
    console.log(JSON.stringify({ messages, errors }));
  `;

	await fs.writeFile(clientScriptPath, clientScript, "utf8");

	try {
		const { stdout, stderr } = await execFileAsync("node", [clientScriptPath, String(port)], {
			timeout: 15000,
			maxBuffer: 1024 * 1024,
		});

		if (stderr.trim()) {
			throw new Error(stderr.trim());
		}

		return JSON.parse(stdout.trim());
	} finally {
		await fs.rm(clientScriptPath, { force: true });
	}
}

test.if(!isBunRuntime)(
	"v1 ws bridge streams correlated request chunks and survives protocol errors",
	{ timeout: 20000 },
	async () => {
		const server = http.createServer(async (req, res) => {
			const url = new URL(req.url || "/", `http://${req.headers.host}`);

			if (url.pathname === "/api/v1/ws" && url.searchParams.get("handshake") === "1") {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						ok: true,
						path: "/v1/ws",
						wsAuth: false,
						authenticated: false,
					})
				);
				return;
			}

			if (url.pathname === "/v1/chat/completions" || url.pathname === "/v1/messages") {
				const body = JSON.parse((await readRequestBody(req)) || "{}");
				const firstMessage = Array.isArray(body.messages) ? body.messages[0] : null;
				const content =
					typeof firstMessage?.content === "string" ? firstMessage.content : body.model;

				res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
				res.write(
					`data: ${JSON.stringify({ choices: [{ delta: { content: `${content}:part1` } }] })}\n\n`
				);
				setTimeout(() => {
					res.write(
						`data: ${JSON.stringify({ choices: [{ delta: { content: `${content}:part2` } }] })}\n\n`
					);
					res.end("data: [DONE]\n\n");
				}, 10);
				return;
			}

			res.writeHead(404, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "not_found" }));
		});

		const port = await listen(server);
		const baseUrl = `http://127.0.0.1:${port}`;
		const bridge = createOmnirouteWsBridge({
			baseUrl,
			pingIntervalMs: 1000,
			idleTimeoutMs: 10000,
		});

		server.on("upgrade", async (req, socket, head) => {
			try {
				const handled = await bridge.handleUpgrade(req, socket, head);
				if (!handled && !socket.destroyed) {
					socket.destroy();
				}
			} catch {
				if (!socket.destroyed) socket.destroy();
			}
		});

		const { messages, errors } = await runNodeWsClient(port);

		const req1Chunks = messages
			.filter((entry) => entry.type === "response.chunk" && entry.id === "req-1")
			.map((entry) => entry.chunk);
		const req2Chunks = messages
			.filter((entry) => entry.type === "response.chunk" && entry.id === "req-2")
			.map((entry) => entry.chunk);

		assert.equal(errors.length, 0);
		assert.ok(messages.find((entry) => entry.type === "session.ready"));
		assert.ok(messages.find((entry) => entry.type === "protocol.error"));
		assert.equal(req1Chunks.length >= 2, true);
		assert.equal(req2Chunks.length >= 2, true);
		assert.match(req1Chunks[0], /alpha:part1/);
		assert.match(req1Chunks[1], /alpha:part2/);
		assert.match(req2Chunks[0], /beta:part1/);
		assert.match(req2Chunks[1], /beta:part2/);

		await close(server);
	}
);
