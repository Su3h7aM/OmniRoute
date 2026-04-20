type BunProxyOption =
	| string
	| {
			url: string;
			headers?: Record<string, string>;
	  };

export type BunFetchInit = RequestInit & {
	proxy?: BunProxyOption;
};

export function getProxyAuthorizationHeader(proxyUrl: string): string | null {
	const parsed = new URL(proxyUrl);
	if (!parsed.username) return null;

	const username = decodeURIComponent(parsed.username);
	const password = decodeURIComponent(parsed.password || "");
	return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

export function createBunProxyOption(proxyUrl: string): BunProxyOption {
	const proxyAuthorization = getProxyAuthorizationHeader(proxyUrl);
	if (!proxyAuthorization) return proxyUrl;

	const parsed = new URL(proxyUrl);
	parsed.username = "";
	parsed.password = "";

	return {
		url: parsed.toString(),
		headers: {
			"Proxy-Authorization": proxyAuthorization,
		},
	};
}

export function createBunFetchInit(
	init: RequestInit = {},
	proxyUrl: string | null = null
): BunFetchInit {
	const bunInit: BunFetchInit = { ...init };

	if (proxyUrl) {
		bunInit.proxy = createBunProxyOption(proxyUrl);
	}

	return bunInit;
}
