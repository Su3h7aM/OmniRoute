const INTERCEPT_RESPONSE_HEADERS = {
	"Content-Type": "text/event-stream",
	"Cache-Control": "no-cache",
	Connection: "keep-alive",
	"X-Accel-Buffering": "no",
};

function createInterceptRequestBody(bodyBuffer, mappedModel) {
	const body = JSON.parse(bodyBuffer.toString());
	body.model = mappedModel;
	return JSON.stringify(body);
}

async function readErrorText(response) {
	try {
		return await response.text();
	} catch {
		return "";
	}
}

async function interceptToRouter({
	bodyBuffer,
	mappedModel,
	routerUrl,
	apiKey,
	fetchImpl = fetch,
}) {
	const response = await fetchImpl(routerUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: createInterceptRequestBody(bodyBuffer, mappedModel),
	});

	if (!response.ok) {
		const errText = await readErrorText(response);
		throw new Error(`OmniRoute ${response.status}: ${errText}`);
	}

	return response;
}

module.exports = {
	INTERCEPT_RESPONSE_HEADERS,
	createInterceptRequestBody,
	interceptToRouter,
};
