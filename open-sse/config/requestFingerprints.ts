/**
 * Request fingerprint definitions.
 *
 * Defines per-provider request fingerprints that control the exact ordering of HTTP
 * headers and JSON body fields. When compatibility mode is enabled for a provider,
 * OmniRoute reshapes outgoing requests to match supported client signatures.
 *
 * Header order and body field order were captured via mitmproxy traffic analysis.
 */
import { isClaudeCodeCompatible } from "../services/provider.ts";
import {
	getAntigravityUserAgent,
	GITHUB_COPILOT_CHAT_USER_AGENT,
	getQwenOauthHeaders,
} from "./providerHeaderProfiles.ts";

export interface RequestFingerprint {
	/** Ordered list of header names (case-sensitive). Unlisted headers are appended. */
	headerOrder: string[];
	/** Ordered list of top-level JSON body fields. Unlisted fields are appended. */
	bodyFieldOrder: string[];
	/** User-Agent string to inject (overrides default) */
	userAgent?: string;
	/** Extra headers to add */
	extraHeaders?: Record<string, string>;
}

/**
 * Request fingerprint registry keyed by provider alias (lowercase).
 * Based on mitmproxy traffic captures from supported client implementations.
 */
export const REQUEST_FINGERPRINTS: Record<string, RequestFingerprint> = {
	codex: {
		headerOrder: [
			"Host",
			"Content-Type",
			"Authorization",
			"Accept",
			"User-Agent",
			"Accept-Encoding",
		],
		bodyFieldOrder: [
			"model",
			"messages",
			"temperature",
			"top_p",
			"max_tokens",
			"stream",
			"tools",
			"tool_choice",
			"response_format",
			"n",
			"stop",
		],
		userAgent: "codex-cli",
	},
	claude: {
		headerOrder: [
			"Host",
			"Content-Type",
			"x-api-key",
			"anthropic-version",
			"Accept",
			"User-Agent",
			"Accept-Encoding",
		],
		bodyFieldOrder: [
			"model",
			"max_tokens",
			"messages",
			"system",
			"temperature",
			"top_p",
			"top_k",
			"stream",
			"tools",
			"tool_choice",
			"metadata",
		],
		userAgent: "claude-code",
	},
	"claude-code-compatible": {
		headerOrder: [
			"Host",
			"Content-Type",
			"x-api-key",
			"anthropic-version",
			"anthropic-beta",
			"anthropic-dangerous-direct-browser-access",
			"x-app",
			"User-Agent",
			"X-Claude-Code-Session-Id",
			"x-client-request-id",
			"X-Stainless-Retry-Count",
			"X-Stainless-Timeout",
			"X-Stainless-Lang",
			"X-Stainless-Package-Version",
			"X-Stainless-OS",
			"X-Stainless-Arch",
			"X-Stainless-Runtime",
			"X-Stainless-Runtime-Version",
			"Accept",
			"accept-language",
			"accept-encoding",
			"Connection",
		],
		bodyFieldOrder: [
			"model",
			"messages",
			"system",
			"tools",
			"tool_choice",
			"metadata",
			"max_tokens",
			"thinking",
			"context_management",
			"output_config",
			"stream",
		],
	},
	github: {
		headerOrder: [
			"Host",
			"Authorization",
			"X-Request-Id",
			"Vscode-Sessionid",
			"Vscode-Machineid",
			"Editor-Version",
			"Editor-Plugin-Version",
			"Copilot-Integration-Id",
			"Openai-Organization",
			"Openai-Intent",
			"Content-Type",
			"User-Agent",
			"Accept",
			"Accept-Encoding",
		],
		bodyFieldOrder: [
			"messages",
			"model",
			"temperature",
			"top_p",
			"max_tokens",
			"n",
			"stream",
			"intent",
			"intent_threshold",
			"intent_content",
		],
		userAgent: GITHUB_COPILOT_CHAT_USER_AGENT,
	},
	antigravity: {
		headerOrder: [
			"Host",
			"Content-Type",
			"Authorization",
			"User-Agent",
			"Accept",
			"Accept-Encoding",
		],
		bodyFieldOrder: ["project", "model", "userAgent", "requestType", "requestId", "request"],
		userAgent: getAntigravityUserAgent(),
	},
	qwen: {
		headerOrder: [
			"Host",
			"Content-Type",
			"Authorization",
			"User-Agent",
			"X-Dashscope-AuthType",
			"X-Dashscope-CacheControl",
			"X-Dashscope-UserAgent",
			"X-Stainless-Arch",
			"X-Stainless-Lang",
			"X-Stainless-Os",
			"X-Stainless-Package-Version",
			"X-Stainless-Retry-Count",
			"X-Stainless-Runtime",
			"X-Stainless-Runtime-Version",
			"Connection",
			"Accept",
			"Accept-Language",
			"Sec-Fetch-Mode",
			"Accept-Encoding",
		],
		bodyFieldOrder: [
			"model",
			"messages",
			"temperature",
			"top_p",
			"max_tokens",
			"stream",
			"tools",
			"tool_choice",
			"response_format",
			"n",
			"stop",
		],
		userAgent: getQwenOauthHeaders()["User-Agent"],
		extraHeaders: getQwenOauthHeaders(),
	},
};

/**
 * Reorder an object's keys according to a specified order.
 * Keys not in the order list are appended at the end in their original order.
 */
export function orderFields<T extends Record<string, unknown>>(obj: T, fieldOrder: string[]): T {
	if (!fieldOrder?.length || !obj || typeof obj !== "object") return obj;

	const result: Record<string, unknown> = {};
	const remaining = new Set(Object.keys(obj));

	// First, add fields in the specified order
	for (const key of fieldOrder) {
		if (key in obj) {
			result[key] = obj[key];
			remaining.delete(key);
		}
	}

	// Then append remaining fields in original order
	for (const key of remaining) {
		result[key] = obj[key];
	}

	return result as T;
}

/**
 * Reorder HTTP headers according to a fingerprint.
 * Returns a new object with headers in the specified order.
 */
export function orderHeaders(
	headers: Record<string, string>,
	headerOrder: string[]
): Record<string, string> {
	if (!headerOrder?.length || !headers) return headers;

	const result: Record<string, string> = {};
	const _remaining = new Map<string, string>();

	// Build case-insensitive lookup
	const headerMap = new Map<string, [string, string]>();
	for (const [key, value] of Object.entries(headers)) {
		headerMap.set(key.toLowerCase(), [key, value]);
	}

	// Add ordered headers first
	for (const orderedKey of headerOrder) {
		const entry = headerMap.get(orderedKey.toLowerCase());
		if (entry) {
			result[entry[0]] = entry[1];
			headerMap.delete(orderedKey.toLowerCase());
		}
	}

	// Add remaining headers
	for (const [, [key, value]] of headerMap) {
		result[key] = value;
	}

	return result;
}

/**
 * Apply a request fingerprint to headers and body.
 * Returns { headers, bodyString } with the correct ordering.
 */
export function applyFingerprint(
	provider: string,
	headers: Record<string, string>,
	body: unknown
): { headers: Record<string, string>; bodyString: string } {
	const fingerprintKey = isClaudeCodeCompatible(provider)
		? "claude-code-compatible"
		: provider?.toLowerCase();
	const fingerprint = REQUEST_FINGERPRINTS[fingerprintKey];

	if (!fingerprint) {
		return { headers, bodyString: JSON.stringify(body) };
	}

	// Apply user agent override
	if (fingerprint.userAgent) {
		headers["User-Agent"] = fingerprint.userAgent;
	}

	// Apply extra headers
	if (fingerprint.extraHeaders) {
		Object.assign(headers, fingerprint.extraHeaders);
	}

	// Reorder headers
	const orderedHeaders = orderHeaders(headers, fingerprint.headerOrder);

	// Reorder body fields
	const orderedBody =
		body && typeof body === "object" && !Array.isArray(body)
			? orderFields(body as Record<string, unknown>, fingerprint.bodyFieldOrder)
			: body;

	return {
		headers: orderedHeaders,
		bodyString: JSON.stringify(orderedBody),
	};
}

/**
 * Runtime cache for providers with request fingerprints enabled in Settings.
 */
let requestFingerprintProvidersCache: Set<string> = new Set();

/**
 * Update the runtime cache of providers with request fingerprints enabled.
 */
export function setRequestFingerprintProviders(providers: string[]): void {
	requestFingerprintProvidersCache = new Set((providers || []).map((p) => p.toLowerCase()));
}

/**
 * Get the current list of providers with request fingerprints enabled.
 */
export function getRequestFingerprintProviders(): string[] {
	return Array.from(requestFingerprintProvidersCache);
}

function isEnabledFlag(value: string | undefined): boolean {
	return value === "1" || value === "true";
}

/**
 * Check if request fingerprint compatibility mode is enabled for a provider.
 * Reads from: 1) runtime cache (Settings UI), 2) environment variables.
 */
export function isRequestFingerprintEnabled(provider: string): boolean {
	if (isClaudeCodeCompatible(provider)) return true;

	const normalizedProvider = provider?.toLowerCase();
	const providerKey = normalizedProvider?.replace(/[^a-z0-9]/g, "_");

	if (requestFingerprintProvidersCache.has(normalizedProvider)) {
		return true;
	}

	const envKey = `REQUEST_FINGERPRINT_${providerKey?.toUpperCase()}`;
	if (isEnabledFlag(process.env[envKey])) {
		return true;
	}

	return isEnabledFlag(process.env.REQUEST_FINGERPRINT_ALL);
}
