import { afterEach, beforeEach, test } from "bun:test";
import assert from "node:assert/strict";

import { GET } from "../../src/app/api/telemetry/summary/route.ts";
import {
	clearTelemetryHistory,
	RequestTelemetry,
	recordTelemetry,
} from "../../src/shared/utils/requestTelemetry.ts";
import {
	clearQuotaMonitors,
	getQuotaMonitorSummary,
} from "../../open-sse/services/quotaMonitor.ts";
import { clearSessions, touchSession } from "../../open-sse/services/sessionManager.ts";

const originalSetTimeout = globalThis.setTimeout;

async function flushAsyncWork() {
	await Promise.resolve();
	await new Promise((resolve) => originalSetTimeout(resolve, 0));
}

beforeEach(async () => {
	globalThis.setTimeout = originalSetTimeout;
	clearTelemetryHistory();
	clearQuotaMonitors();
	clearSessions();
	await flushAsyncWork();
});

afterEach(async () => {
	globalThis.setTimeout = originalSetTimeout;
	clearTelemetryHistory();
	clearQuotaMonitors();
	clearSessions();
	await flushAsyncWork();
});

test("telemetry summary route includes totalRequests alias plus session/quota monitor signals", async () => {
	const telemetry = new RequestTelemetry("telemetry-route");
	telemetry.startPhase("parse");
	telemetry.endPhase();
	recordTelemetry(telemetry);

	touchSession("sess-route", "conn-route");

	const response = await GET(
		new Request("http://localhost:20128/api/telemetry/summary?windowMs=600000")
	);
	const payload = await response.json();

	assert.equal(response.status, 200);
	assert.ok(payload.totalRequests >= 1);
	assert.equal(payload.sessions.activeCount, 1);
	assert.equal(payload.sessions.stickyBoundCount, 1);
	assert.equal(payload.quotaMonitor.active, 0);
	assert.equal(getQuotaMonitorSummary().active, 0);
});
