import { afterEach, describe, expect, it } from "bun:test";

import { startLocalServer } from "../../src/lib/oauth/utils/server.ts";

const serversToClose: Array<{ close: () => void }> = [];

afterEach(() => {
	while (serversToClose.length > 0) {
		serversToClose.pop()?.close();
	}
});

describe("startLocalServer", () => {
	it("captures callback params and returns success page", async () => {
		let received: Record<string, string> | null = null;
		const localServer = await startLocalServer((params) => {
			received = params;
		});
		serversToClose.push(localServer);

		const response = await fetch(
			`http://127.0.0.1:${localServer.port}/callback?code=test-code&state=test-state`
		);
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain("Authentication Successful");
		expect(received).toEqual({ code: "test-code", state: "test-state" });
	});

	it("returns 404 for unrelated paths", async () => {
		const localServer = await startLocalServer(() => {});
		serversToClose.push(localServer);

		const response = await fetch(`http://127.0.0.1:${localServer.port}/not-found`);
		const text = await response.text();

		expect(response.status).toBe(404);
		expect(text).toContain("Not found");
	});
});
