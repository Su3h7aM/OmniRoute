import { normalizeProxyUrl } from "./proxyConfig.ts";
import { getUpstreamTimeoutConfig } from "@/shared/utils/runtimeTimeouts";

type Dispatcher = unknown;
const isBunRuntime = typeof Bun !== "undefined";

/**
 * Legacy dispatcher compatibility layer.
 * Bun-native request execution should avoid this module for active fetch behavior.
 * Remaining runtime responsibilities here are Node compatibility and SOCKS5 support.
 */

const DISPATCHER_CACHE_KEY = Symbol.for("omniroute.proxyDispatcher.cache");
const DEFAULT_DISPATCHER_KEY = Symbol.for("omniroute.proxyDispatcher.default");

type DispatcherCache = Map<string, Dispatcher>;
type GlobalWithDispatcherCache = typeof globalThis & {
	[DISPATCHER_CACHE_KEY]?: DispatcherCache;
	[DEFAULT_DISPATCHER_KEY]?: Dispatcher;
};
type SocksDispatcherOptions = {
	type: number;
	host: string;
	port: number;
	userId?: string;
	password?: string;
};

function getDispatcherCache(): DispatcherCache {
	const globalWithCache = globalThis as GlobalWithDispatcherCache;
	if (!globalWithCache[DISPATCHER_CACHE_KEY]) {
		globalWithCache[DISPATCHER_CACHE_KEY] = new Map();
	}
	return globalWithCache[DISPATCHER_CACHE_KEY];
}

/**
 * Clear all cached proxy dispatchers.
 * Call this when proxy configuration changes to avoid stale connections.
 */
export function clearDispatcherCache() {
	const cache = getDispatcherCache();
	cache.clear();

	const globalWithCache = globalThis as GlobalWithDispatcherCache;
	delete globalWithCache[DEFAULT_DISPATCHER_KEY];
}

function getDispatcherOptions() {
	const timeouts = getUpstreamTimeoutConfig(process.env, (message) => {
		console.warn(`[ProxyDispatcher] ${message}`);
	});

	return {
		headersTimeout: timeouts.fetchHeadersTimeoutMs,
		bodyTimeout: timeouts.fetchBodyTimeoutMs,
		connectTimeout: timeouts.fetchConnectTimeoutMs,
		keepAliveTimeout: timeouts.fetchKeepAliveTimeoutMs,
	};
}

/** Node-only legacy direct-fetch dispatcher. Returns null on Bun. */
export async function getDefaultDispatcher(): Promise<Dispatcher | null> {
	if (isBunRuntime) return null;

	const globalWithCache = globalThis as GlobalWithDispatcherCache;
	if (!globalWithCache[DEFAULT_DISPATCHER_KEY]) {
		const { Agent } = await import("undici");
		globalWithCache[DEFAULT_DISPATCHER_KEY] = new Agent(getDispatcherOptions()) as Dispatcher;
	}
	return globalWithCache[DEFAULT_DISPATCHER_KEY] ?? null;
}

/** Node-only legacy proxy dispatcher. Returns null on Bun. */
export async function createProxyDispatcher(proxyUrl: string): Promise<Dispatcher | null> {
	if (isBunRuntime) return null;

	const normalizedUrl = normalizeProxyUrl(proxyUrl, "proxy dispatcher");
	const dispatcherCache = getDispatcherCache();
	const dispatcherOptions = getDispatcherOptions();

	let dispatcher = dispatcherCache.get(normalizedUrl);
	if (dispatcher) return dispatcher;

	const parsed = new URL(normalizedUrl);
	const port = parsed.port || (parsed.protocol === "socks5:" ? "1080" : "8080");

	if (parsed.protocol === "socks5:") {
		const { socksDispatcher } = await import("fetch-socks");
		const socksOptions: SocksDispatcherOptions = {
			type: 5,
			host: parsed.hostname,
			port: Number(port),
		};
		if (parsed.username) socksOptions.userId = decodeURIComponent(parsed.username);
		if (parsed.password) socksOptions.password = decodeURIComponent(parsed.password);
		dispatcher = socksDispatcher(
			socksOptions as Parameters<typeof socksDispatcher>[0],
			dispatcherOptions
		) as Dispatcher;
	} else {
		const { ProxyAgent } = await import("undici");
		dispatcher = new ProxyAgent({
			uri: normalizedUrl,
			...dispatcherOptions,
		}) as Dispatcher;
	}

	dispatcherCache.set(normalizedUrl, dispatcher);
	return dispatcher;
}
