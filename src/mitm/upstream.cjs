function iterateHeaderEntries(headers) {
	if (!headers) return [];
	if (typeof headers.entries === "function") {
		return headers.entries();
	}
	return Object.entries(headers);
}

function appendRequestHeader(headers, name, value) {
	if (value === undefined) return;
	if (Array.isArray(value)) {
		for (const item of value) {
			headers.append(name, item);
		}
		return;
	}
	headers.set(name, value);
}

function createPassthroughRequestHeaders(headers, targetHost) {
	const requestHeaders = new Headers();

	for (const [name, value] of iterateHeaderEntries(headers)) {
		appendRequestHeader(requestHeaders, name, value);
	}

	requestHeaders.set("host", targetHost);
	return requestHeaders;
}

async function passthroughToTarget({
	requestPath,
	method,
	headers,
	bodyBuffer,
	targetHost,
	resolveTargetIP,
	tlsRejectUnauthorized,
	fetchImpl = fetch,
}) {
	const targetIP = await resolveTargetIP();
	const hasRequestBody = bodyBuffer.length > 0;
	return fetchImpl(`https://${targetIP}${requestPath}`, {
		method,
		headers: createPassthroughRequestHeaders(headers, targetHost),
		body: hasRequestBody ? bodyBuffer : undefined,
		duplex: hasRequestBody ? "half" : undefined,
		tls: {
			serverName: targetHost,
			rejectUnauthorized: tlsRejectUnauthorized,
		},
	});
}

module.exports = {
	createPassthroughRequestHeaders,
	passthroughToTarget,
};
