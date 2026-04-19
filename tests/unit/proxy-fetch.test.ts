import { afterEach, test } from "bun:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";

import proxyFetch, {
	runWithProxyContext,
	runWithTlsTracking,
	isTlsFingerprintActive,
} from "../../open-sse/utils/proxyFetch.ts";
import tlsClient from "../../open-sse/utils/tlsClient.ts";

const isBunRuntime = typeof Bun !== "undefined";

async function withEnv(overrides, fn) {
	const previous = new Map();

	for (const [key, value] of Object.entries(overrides)) {
		previous.set(key, process.env[key]);
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}

	try {
		return await fn();
	} finally {
		for (const [key, value] of previous.entries()) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
}

async function waitForServerReady(port, host = "127.0.0.1") {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const ready = await new Promise((resolve) => {
			const socket = net.connect({ port, host }, () => {
				socket.end();
				resolve(true);
			});
			socket.once("error", () => resolve(false));
		});

		if (ready) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}

	throw new Error(`Server did not become ready on ${host}:${port}`);
}

async function withHttpServer(handler, fn) {
	const server = http.createServer(handler);

	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});

	const address = server.address();
	assert.ok(address && typeof address === "object");
	await waitForServerReady(address.port);

	try {
		return await fn(`http://127.0.0.1:${address.port}`);
	} finally {
		await new Promise((resolve, reject) => {
			server.close((error) => {
				if (error) reject(error);
				else resolve();
			});
		});
	}
}

const originalTlsAvailable = tlsClient.available;
const originalTlsFetch = tlsClient.fetch.bind(tlsClient);

afterEach(() => {
	tlsClient.available = originalTlsAvailable;
	tlsClient.fetch = originalTlsFetch;
});

test.if(!isBunRuntime)(
	"proxy fetch bypasses invalid environment proxies for local addresses",
	async () => {
		await withHttpServer(
			(_req, res) => {
				res.writeHead(200, { "Content-Type": "text/plain" });
				res.end("local-bypass-ok");
			},
			async (url) => {
				await withEnv(
					{
						HTTP_PROXY: "http://127.0.0.1:9",
						HTTPS_PROXY: undefined,
						ALL_PROXY: undefined,
						NO_PROXY: undefined,
					},
					async () => {
						const directResponse = await fetch(url);
						assert.equal(directResponse.status, 200);
						assert.equal(await directResponse.text(), "local-bypass-ok");

						const response = await proxyFetch(url);

						assert.equal(response.status, 200);
						assert.equal(await response.text(), "local-bypass-ok");
					}
				);
			}
		);
	}
);

test("runWithProxyContext requires a callback function", async () => {
	await assert.rejects(
		runWithProxyContext(null, null),
		/runWithProxyContext requires a callback function/
	);
});

test("runWithTlsTracking reports direct executions without TLS fingerprint usage", async () => {
	await withEnv({ ENABLE_TLS_FINGERPRINT: undefined }, async () => {
		const tracked = await runWithTlsTracking(async () => "ok");

		assert.deepEqual(tracked, {
			result: "ok",
			tlsFingerprintUsed: false,
		});
		assert.equal(isTlsFingerprintActive(), false);
	});
});

test("proxy fetch uses TLS fingerprint transport when enabled and available", async () => {
	await withEnv(
		{
			ENABLE_TLS_FINGERPRINT: "true",
			HTTP_PROXY: undefined,
			HTTPS_PROXY: undefined,
			ALL_PROXY: undefined,
			NO_PROXY: undefined,
		},
		async () => {
			tlsClient.available = true;
			tlsClient.fetch = async (url, options = {}) => {
				assert.equal(url, "https://omniroute.example.test/hello");
				assert.equal(options.method, "POST");
				return Response.json({ via: "tls-client" });
			};

			const tracked = await runWithTlsTracking(() =>
				proxyFetch("https://omniroute.example.test/hello", {
					method: "POST",
					headers: { "x-test": "1" },
				})
			);

			assert.equal(isTlsFingerprintActive(), true);
			assert.equal(tracked.tlsFingerprintUsed, true);
			assert.deepEqual(await tracked.result.json(), { via: "tls-client" });
		}
	);
});

test("runWithProxyContext accepts reachable HTTP proxy endpoints and returns callback result", async () => {
	await withHttpServer(
		(_req, res) => res.end("proxy-ok"),
		async (url) => {
			const parsed = new URL(url);
			const result = await runWithProxyContext(
				{
					type: "http",
					host: parsed.hostname,
					port: parsed.port,
				},
				async () => "ok"
			);

			assert.equal(result, "ok");
		}
	);
});
