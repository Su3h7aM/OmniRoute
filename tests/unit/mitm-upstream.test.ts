import { describe, expect, it } from "bun:test";

const {
	createPassthroughRequestHeaders,
	passthroughToTarget,
} = require("../../src/mitm/upstream.cjs");

const TARGET_HOST = "daily-cloudcode-pa.googleapis.com";

describe("mitm upstream helpers", () => {
	it("forces target host header while preserving other headers", () => {
		const headers = createPassthroughRequestHeaders(
			{
				host: "localhost:443",
				"x-test": "1",
				"set-cookie": ["a=1", "b=2"],
			},
			TARGET_HOST
		);

		expect(headers.get("host")).toBe(TARGET_HOST);
		expect(headers.get("x-test")).toBe("1");
		expect(headers.get("set-cookie")).toContain("a=1");
		expect(headers.get("set-cookie")).toContain("b=2");
	});

	it("returns the fetch response for Bun-native handlers", async () => {
		const response = new Response("hello world", {
			status: 201,
			headers: { "content-type": "text/plain" },
		});

		const result = await passthroughToTarget({
			requestPath: "/v1/test",
			method: "GET",
			headers: new Headers(),
			bodyBuffer: Buffer.alloc(0),
			targetHost: TARGET_HOST,
			resolveTargetIP: async () => "1.2.3.4",
			tlsRejectUnauthorized: true,
			fetchImpl: async () => response,
		});

		expect(result).toBe(response);
		expect(result.status).toBe(201);
		expect(await result.text()).toBe("hello world");
	});

	type FetchCall = {
		url: string;
		init: RequestInit & { tls?: unknown; duplex?: unknown };
	};

	it("uses Bun fetch with target IP, host header, tls serverName and body", async () => {
		const calls: FetchCall[] = [];
		const bodyBuffer = Buffer.from('{"hello":"world"}');

		await passthroughToTarget({
			requestPath: "/v1/test",
			method: "POST",
			headers: {
				host: "localhost",
				"content-type": "application/json",
			},
			bodyBuffer,
			targetHost: TARGET_HOST,
			resolveTargetIP: async () => "1.2.3.4",
			tlsRejectUnauthorized: true,
			fetchImpl: async (url, init) => {
				calls.push({
					url,
					init: init as RequestInit & { tls?: unknown; duplex?: unknown },
				});
				return new Response(null, { status: 204 });
			},
		});

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://1.2.3.4/v1/test");
		expect((calls[0]?.init.headers as Headers).get("host")).toBe(TARGET_HOST);
		expect(calls[0]?.init.duplex).toBe("half");
		expect(calls[0]?.init.tls).toEqual({
			serverName: TARGET_HOST,
			rejectUnauthorized: true,
		});
		expect(calls[0]?.init.body).toBe(bodyBuffer);
	});
});
