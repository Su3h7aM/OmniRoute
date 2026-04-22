import { test } from "bun:test";
import assert from "node:assert/strict";

import {
	DEFAULT_CURSOR_VERSION,
	getCursorVersion,
	resetCursorVersionCache,
} from "../../open-sse/utils/cursorVersion.ts";

function withEnv(name: string, value: string | undefined, fn: () => void) {
	const previous = process.env[name];
	try {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
		fn();
	} finally {
		if (previous === undefined) delete process.env[name];
		else process.env[name] = previous;
	}
}

test("getCursorVersion returns the default server-safe version", () => {
	withEnv("OMNIROUTE_CURSOR_CLIENT_VERSION", undefined, () => {
		withEnv("CURSOR_CLIENT_VERSION", undefined, () => {
			resetCursorVersionCache();
			assert.equal(getCursorVersion(), DEFAULT_CURSOR_VERSION);
		});
	});
});

test("getCursorVersion prefers OMNIROUTE_CURSOR_CLIENT_VERSION", () => {
	withEnv("OMNIROUTE_CURSOR_CLIENT_VERSION", "4.0.0", () => {
		withEnv("CURSOR_CLIENT_VERSION", "3.9.0", () => {
			assert.equal(getCursorVersion(), "4.0.0");
		});
	});
});

test("getCursorVersion falls back to CURSOR_CLIENT_VERSION", () => {
	withEnv("OMNIROUTE_CURSOR_CLIENT_VERSION", undefined, () => {
		withEnv("CURSOR_CLIENT_VERSION", "3.9.0", () => {
			assert.equal(getCursorVersion(), "3.9.0");
		});
	});
});
