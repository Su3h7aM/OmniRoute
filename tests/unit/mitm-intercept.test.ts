import { describe, expect, it } from "bun:test";

const { createInterceptRequestBody, interceptToRouter } = require("../../src/mitm/intercept.cjs");

describe("mitm intercept helpers", () => {
	it("replaces the model in the intercepted request body", () => {
		const result = createInterceptRequestBody(
			Buffer.from('{"model":"old-model","messages":[]}'),
			"new-model"
		);

		expect(JSON.parse(result)).toEqual({
			model: "new-model",
			messages: [],
		});
	});

	it("returns the router response for Bun-native SSE handlers", async () => {
		const response = new Response("data: hello\n\n", {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});

		const result = await interceptToRouter({
			bodyBuffer: Buffer.from('{"model":"old-model","messages":[]}'),
			mappedModel: "new-model",
			routerUrl: "http://localhost:20128/v1/chat/completions",
			apiKey: "secret",
			fetchImpl: async () => response,
		});

		expect(result).toBe(response);
		expect(result.status).toBe(200);
		expect(result.headers.get("content-type")).toBe("text/event-stream");
		expect(await result.text()).toBe("data: hello\n\n");
	});

	it("posts the remapped request body to the router", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];

		await interceptToRouter({
			bodyBuffer: Buffer.from('{"model":"old-model","messages":[]}'),
			mappedModel: "new-model",
			routerUrl: "http://localhost:20128/v1/chat/completions",
			apiKey: "secret",
			fetchImpl: async (url, init) => {
				calls.push({ url, init: init as RequestInit });
				return new Response("data: ok\n\n", { status: 200 });
			},
		});

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("http://localhost:20128/v1/chat/completions");
		expect(calls[0]?.init.method).toBe("POST");
		expect(calls[0]?.init.headers).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer secret",
		});
		expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
			model: "new-model",
			messages: [],
		});
	});

	it("includes router error text in thrown errors", async () => {
		await expect(
			interceptToRouter({
				bodyBuffer: Buffer.from('{"model":"old-model"}'),
				mappedModel: "new-model",
				routerUrl: "http://localhost:20128/v1/chat/completions",
				apiKey: "secret",
				fetchImpl: async () => new Response("bad upstream", { status: 502 }),
			})
		).rejects.toThrow("OmniRoute 502: bad upstream");
	});
});
