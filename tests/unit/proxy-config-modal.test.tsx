import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import "../setup/happy-dom";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import ProxyConfigModal from "../../src/shared/components/ProxyConfigModal";

mock.module("next-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

describe("ProxyConfigModal", () => {
	const originalFetch = globalThis.fetch;
	const fetchMock = mock(async (input: string, init?: RequestInit) => {
		if (input === "/api/settings/proxies") {
			return new Response(JSON.stringify({ items: [] }), { status: 200 });
		}

		if (
			input.startsWith("/api/settings/proxies/assignments?") &&
			(!init || init.method === undefined)
		) {
			return new Response(JSON.stringify({ items: [] }), { status: 200 });
		}

		if (input === "/api/settings/proxy?level=global") {
			return new Response(
				JSON.stringify({
					proxy: {
						host: " proxy.example.test ",
						port: 8080,
						type: "http",
						username: " user ",
						password: " pass ",
					},
				}),
				{ status: 200 }
			);
		}

		if (input === "/api/settings/proxies/assignments" && init?.method === "PUT") {
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}

		if (input === "/api/settings/proxy" && init?.method === "PUT") {
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}

		return new Response(JSON.stringify({}), { status: 200 });
	});

	beforeEach(() => {
		fetchMock.mockClear();
		globalThis.fetch = fetchMock as typeof globalThis.fetch;
	});

	afterEach(() => {
		cleanup();
		globalThis.fetch = originalFetch;
	});

	it("normalizes numeric port values before save", async () => {
		const onClose = mock(() => {});
		const onSaved = mock(() => {});

		const view = render(
			<ProxyConfigModal isOpen={true} onClose={onClose} level="global" onSaved={onSaved} />
		);

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith("/api/settings/proxy?level=global");
		});

		fireEvent.click(view.getByRole("button", { name: "save" }));

		await waitFor(() => {
			const saveCall = fetchMock.mock.calls.find(
				([input, init]) => input === "/api/settings/proxy" && init?.method === "PUT"
			);
			expect(saveCall).toBeTruthy();
			const [, init] = saveCall as [string, RequestInit];
			const body = JSON.parse(String(init.body));
			expect(body.proxy.port).toBe("8080");
			expect(body.proxy.host).toBe("proxy.example.test");
			expect(body.proxy.username).toBe("user");
			expect(body.proxy.password).toBe("pass");
		});
	});
});
