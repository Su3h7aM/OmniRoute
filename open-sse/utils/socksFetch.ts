type SocksFetchInit = RequestInit & {
	proxy?: string | { url: string; resolveDnsLocally?: boolean };
};

export async function fetchViaSocksProxy(
	input: string | URL | Request,
	init: RequestInit = {},
	proxyUrl: string,
	resolveDnsLocally = false
): Promise<Response> {
	const { fetch: netbunFetch } = await import("netbun");
	return netbunFetch(input, {
		...init,
		proxy: {
			url: proxyUrl,
			resolveDnsLocally,
		},
	} as SocksFetchInit);
}
