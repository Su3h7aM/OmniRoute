import { afterEach, beforeEach, expect, mock, test } from "bun:test";

beforeEach(() => {
	mock.restore();
});

afterEach(() => {
	mock.restore();
});

test("fetchViaSocksProxy passes proxy url and resolveDnsLocally to netbun", async () => {
	const netbunFetch = mock(
		async (
			_input: string | URL | Request,
			init?: RequestInit & {
				proxy?: { url: string; resolveDnsLocally?: boolean };
			}
		) => {
			expect(init?.proxy).toEqual({
				url: "socks5://user:pass@127.0.0.1:1080",
				resolveDnsLocally: true,
			});
			return new Response("ok");
		}
	);

	mock.module("netbun", () => ({
		fetch: netbunFetch,
	}));

	const { fetchViaSocksProxy } = await import("../../open-sse/utils/socksFetch.ts");
	const response = await fetchViaSocksProxy(
		"https://example.com",
		{ method: "POST" },
		"socks5://user:pass@127.0.0.1:1080",
		true
	);

	expect(await response.text()).toBe("ok");
	expect(netbunFetch).toHaveBeenCalledTimes(1);
});
