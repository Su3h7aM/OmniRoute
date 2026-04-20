const SUPPORTED_PROTOCOLS = new Set(["http:", "https:", "socks5:"]);

type ProxyConfigObject = {
	type?: string;
	host?: string;
	port?: string | number | null;
	username?: string;
	password?: string;
};

/**
 * Extract the port from a proxy URL string before URL parsing.
 * `new URL("http://host:80")` strips port 80 since it's the HTTP default,
 * but proxy servers commonly listen on port 80/443, so we need to preserve it.
 */
function extractExplicitPort(urlStr: string): string | null {
	try {
		const idx = urlStr.indexOf("://");
		if (idx === -1) return null;
		const authorityStart = idx + 3;
		const authorityEnd = urlStr.indexOf("/", authorityStart);
		const authority =
			authorityEnd === -1
				? urlStr.slice(authorityStart)
				: urlStr.slice(authorityStart, authorityEnd);
		const lastColon = authority.lastIndexOf(":");
		const atSign = authority.lastIndexOf("@");
		if (lastColon !== -1 && lastColon > atSign) {
			const portStr = authority.slice(lastColon + 1);
			if (/^\d+$/.test(portStr)) {
				const port = Number(portStr);
				if (Number.isInteger(port) && port >= 1 && port <= 65535) return String(port);
			}
		}
	} catch {}
	return null;
}

function defaultPortForProtocol(protocol: string): string {
	if (protocol === "https:" || protocol === "wss:") return "443";
	if (protocol === "socks5:") return "1080";
	return "8080";
}

function normalizePort(port: string | number | null | undefined, protocol: string): string {
	if (!port) return defaultPortForProtocol(protocol);
	const parsed = Number(port);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
		throw new Error("[ProxyConfig] Invalid proxy port");
	}
	return String(parsed);
}

/**
 * Build a proxy URL string manually from parsed URL components.
 * We cannot use URL.toString() because the URL serializer silently strips
 * default ports (80 for http, 443 for https). Proxy servers commonly
 * listen on these ports, so we must always include the port explicitly.
 */
function buildProxyUrlString(parsed: URL, port: string): string {
	const auth = parsed.username
		? `${parsed.username}${parsed.password ? `:${parsed.password}` : ""}@`
		: "";
	return `${parsed.protocol}//${auth}${parsed.hostname}:${port}`;
}

export function isSocks5ProxyEnabled(): boolean {
	return process.env.ENABLE_SOCKS5_PROXY === "true";
}

export function isSocksProxyProtocol(protocol: string): boolean {
	return protocol === "socks5:" || protocol === "socks5h:";
}

export function isSocksProxyUrl(proxyUrl: string): boolean {
	try {
		return isSocksProxyProtocol(new URL(proxyUrl).protocol);
	} catch {
		return false;
	}
}

export function proxyUrlForLogs(proxyUrl: string): string {
	const explicitPort = extractExplicitPort(proxyUrl);
	const parsed = new URL(proxyUrl);
	const port = explicitPort || parsed.port || defaultPortForProtocol(parsed.protocol);
	return `${parsed.protocol}//${parsed.hostname}:${port}`;
}

export function normalizeProxyUrl(
	proxyUrl: string,
	source = "proxy",
	{ allowSocks5 = isSocks5ProxyEnabled() } = {}
): string {
	const explicitPort = extractExplicitPort(proxyUrl);

	let parsed;
	try {
		parsed = new URL(proxyUrl);
	} catch {
		throw new Error(`[ProxyConfig] Invalid ${source} URL`);
	}

	if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
		throw new Error(
			`[ProxyConfig] Unsupported ${source} protocol: ${parsed.protocol.replace(":", "")}`
		);
	}
	if (parsed.protocol === "socks5:" && !allowSocks5) {
		throw new Error(
			"[ProxyConfig] SOCKS5 proxy is disabled (set ENABLE_SOCKS5_PROXY=true to enable)"
		);
	}
	if (!parsed.hostname) {
		throw new Error(`[ProxyConfig] Invalid ${source} host`);
	}

	const port = explicitPort || normalizePort(parsed.port, parsed.protocol);
	return buildProxyUrlString(parsed, port);
}

export function proxyConfigToUrl(
	proxyConfig: unknown,
	{ allowSocks5 = isSocks5ProxyEnabled() } = {}
): string | null {
	if (!proxyConfig) return null;

	if (typeof proxyConfig === "string") {
		return normalizeProxyUrl(proxyConfig, "context proxy", { allowSocks5 });
	}

	if (typeof proxyConfig !== "object" || Array.isArray(proxyConfig)) {
		throw new Error("[ProxyConfig] Invalid context proxy config");
	}

	const config = proxyConfig as ProxyConfigObject;
	const type = String(config.type || "http").toLowerCase();
	const protocol = `${type}:`;

	if (!SUPPORTED_PROTOCOLS.has(protocol)) {
		throw new Error(`[ProxyConfig] Unsupported context proxy protocol: ${type}`);
	}
	if (protocol === "socks5:" && !allowSocks5) {
		throw new Error(
			"[ProxyConfig] SOCKS5 proxy is disabled (set ENABLE_SOCKS5_PROXY=true to enable)"
		);
	}
	if (!config.host) {
		throw new Error("[ProxyConfig] Context proxy host is required");
	}

	const port = normalizePort(config.port, protocol);
	const auth = config.username
		? `${encodeURIComponent(config.username)}:${config.password ? encodeURIComponent(config.password) : ""}@`
		: "";
	const proxyUrlStr = `${type}://${auth}${config.host}:${port}`;

	return normalizeProxyUrl(proxyUrlStr, "context proxy", { allowSocks5 });
}
