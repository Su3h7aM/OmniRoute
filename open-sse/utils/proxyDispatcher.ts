type Dispatcher = unknown;

/**
 * Legacy compatibility shim kept only to preserve imports/callers.
 * Dispatcher-based execution is no longer used.
 */

export function clearDispatcherCache() {
	// No-op: dispatcher caching removed.
}

export async function getDefaultDispatcher(): Promise<Dispatcher | null> {
	return null;
}

export async function createProxyDispatcher(_proxyUrl: string): Promise<Dispatcher | null> {
	return null;
}
