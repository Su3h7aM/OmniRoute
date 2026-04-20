import { createBunFetchInit } from "@omniroute/open-sse/utils/bunFetchOptions.ts";
import {
	createProxyDispatcher,
	isSocks5ProxyEnabled,
	proxyConfigToUrl,
	proxyUrlForLogs,
} from "@omniroute/open-sse/utils/proxyDispatcher.ts";
import { testProxySchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { createErrorResponse, createErrorResponseFromUnknown } from "@/lib/api/errorResponse";
import { getProxyById } from "@/lib/localDb";

const BASE_SUPPORTED_PROXY_TYPES = new Set(["http", "https"]);
const PROXY_TEST_URL = "https://api64.ipify.org?format=json";
const PROXY_TEST_TIMEOUT_MS = 10000;
const isBunRuntime = typeof Bun !== "undefined";

function getErrorMessage(error: unknown, fallbackMessage: string): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return fallbackMessage;
}

function getSupportedProxyTypes() {
	if (isSocks5ProxyEnabled()) {
		return new Set([...BASE_SUPPORTED_PROXY_TYPES, "socks5"]);
	}
	return BASE_SUPPORTED_PROXY_TYPES;
}

function supportedTypesMessage() {
	return isSocks5ProxyEnabled() ? "http, https, or socks5" : "http or https";
}

async function fetchPublicIpWithBun(proxyUrl: string | null): Promise<string> {
	const response = await fetch(
		PROXY_TEST_URL,
		createBunFetchInit(
			{
				method: "GET",
				signal: AbortSignal.timeout(PROXY_TEST_TIMEOUT_MS),
			},
			proxyUrl
		)
	);
	return response.text();
}

async function fetchPublicIpWithLegacyDispatcher(proxyUrl: string): Promise<string> {
	const { request: undiciRequest } = await import("undici");
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), PROXY_TEST_TIMEOUT_MS);
	const dispatcher = await createProxyDispatcher(proxyUrl);

	try {
		const result = await undiciRequest(PROXY_TEST_URL, {
			method: "GET",
			dispatcher,
			signal: controller.signal,
			headersTimeout: PROXY_TEST_TIMEOUT_MS,
			bodyTimeout: PROXY_TEST_TIMEOUT_MS,
		});

		return result.body.text();
	} finally {
		clearTimeout(timeout);
	}
}

function parsePublicIpResponse(responseText: string): { ip?: string } {
	try {
		const parsedJson = JSON.parse(responseText);
		if (parsedJson && typeof parsedJson === "object") {
			return parsedJson as { ip?: string };
		}
		return { ip: String(parsedJson) };
	} catch {
		return { ip: responseText.trim() };
	}
}

/**
 * POST /api/settings/proxy/test — test proxy connectivity
 * Body: { proxy: { type, host, port, username?, password? } }
 * Returns: { success, publicIp?, latencyMs?, error? }
 */
export async function POST(request: Request) {
	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch {
		return createErrorResponse({
			status: 400,
			message: "Invalid JSON body",
			type: "invalid_request",
		});
	}

	try {
		const validation = validateBody(testProxySchema, rawBody);
		if (isValidationFailure(validation)) {
			return createErrorResponse({
				status: 400,
				message: validation.error.message,
				details: validation.error.details,
				type: "invalid_request",
			});
		}
		let { proxy } = validation.data;

		// If a proxyId is provided, look up the real (non-redacted) credentials from DB.
		// The frontend sends redacted credentials (***) from listProxies(), so we need
		// the actual secrets for testing.
		const body = rawBody as Record<string, unknown>;
		const proxyId = typeof body.proxyId === "string" ? body.proxyId.trim() : null;
		if (proxyId) {
			const dbProxy = await getProxyById(proxyId, { includeSecrets: true });
			if (dbProxy) {
				proxy = {
					...proxy,
					host: proxy.host || dbProxy.host,
					port: proxy.port || String(dbProxy.port),
					type: proxy.type || dbProxy.type,
					username: dbProxy.username,
					password: dbProxy.password,
				};
			}
		}

		const proxyType = String(proxy.type || "http").toLowerCase();
		if (proxyType === "socks5" && !isSocks5ProxyEnabled()) {
			return createErrorResponse({
				status: 400,
				message: "SOCKS5 proxy is disabled (set ENABLE_SOCKS5_PROXY=true to enable)",
				type: "invalid_request",
			});
		}
		if (proxyType.startsWith("socks") && proxyType !== "socks5") {
			return createErrorResponse({
				status: 400,
				message: `proxy.type must be ${supportedTypesMessage()}`,
				type: "invalid_request",
			});
		}
		if (!getSupportedProxyTypes().has(proxyType)) {
			return createErrorResponse({
				status: 400,
				message: `proxy.type must be ${supportedTypesMessage()}`,
				type: "invalid_request",
			});
		}

		let proxyUrl: string;
		try {
			const normalizedProxyUrl = proxyConfigToUrl(
				{
					type: proxyType,
					host: proxy.host,
					port: proxy.port,
					username: proxy.username || "",
					password: proxy.password || "",
				},
				{ allowSocks5: isSocks5ProxyEnabled() }
			);
			if (!normalizedProxyUrl) {
				return createErrorResponse({
					status: 400,
					message: "Invalid proxy configuration",
					type: "invalid_request",
				});
			}
			proxyUrl = normalizedProxyUrl;
		} catch (proxyError) {
			return createErrorResponse({
				status: 400,
				message: getErrorMessage(proxyError, "Invalid proxy configuration"),
				type: "invalid_request",
			});
		}

		const publicProxyUrl = proxyUrlForLogs(proxyUrl);

		const startTime = Date.now();

		try {
			const responseText =
				isBunRuntime && proxyType !== "socks5"
					? await fetchPublicIpWithBun(proxyUrl)
					: await fetchPublicIpWithLegacyDispatcher(proxyUrl);
			const parsed = parsePublicIpResponse(responseText);

			return Response.json({
				success: true,
				publicIp: parsed.ip || null,
				latencyMs: Date.now() - startTime,
				proxyUrl: publicProxyUrl,
			});
		} catch (fetchError) {
			return Response.json({
				success: false,
				error:
					fetchError instanceof Error && fetchError.name === "AbortError"
						? "Connection timeout (10s)"
						: getErrorMessage(fetchError, "Connection failed"),
				latencyMs: Date.now() - startTime,
				proxyUrl: publicProxyUrl,
			});
		}
	} catch (error) {
		return createErrorResponseFromUnknown(error, "Unexpected server error");
	}
}
