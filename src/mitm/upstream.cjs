const { Readable } = require("stream");

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

	for (const [name, value] of Object.entries(headers || {})) {
		appendRequestHeader(requestHeaders, name, value);
	}

	requestHeaders.set("host", targetHost);
	return requestHeaders;
}

function writeFetchResponse(res, response) {
	const responseHeaders = Object.fromEntries(response.headers.entries());
	res.writeHead(response.status, responseHeaders);

	if (!response.body) {
		res.end();
		return;
	}

	Readable.fromWeb(response.body).pipe(res);
}

async function passthroughToTarget({
	req,
	res,
	bodyBuffer,
	targetHost,
	resolveTargetIP,
	tlsRejectUnauthorized,
	fetchImpl = fetch,
}) {
	const targetIP = await resolveTargetIP();
	const hasRequestBody = bodyBuffer.length > 0;
	const response = await fetchImpl(`https://${targetIP}${req.url}`, {
		method: req.method,
		headers: createPassthroughRequestHeaders(req.headers, targetHost),
		body: hasRequestBody ? bodyBuffer : undefined,
		duplex: hasRequestBody ? "half" : undefined,
		tls: {
			serverName: targetHost,
			rejectUnauthorized: tlsRejectUnauthorized,
		},
	});

	writeFetchResponse(res, response);
}

module.exports = {
	createPassthroughRequestHeaders,
	writeFetchResponse,
	passthroughToTarget,
};
