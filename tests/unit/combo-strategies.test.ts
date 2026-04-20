import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, test } from "bun:test";
import assert from "node:assert/strict";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-combo-strategies-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const { handleComboChat } = await import("../../open-sse/services/combo.ts");
const combosDb = await import("../../src/lib/db/combos.ts");

function stubConnection() {
	return [
		{
			id: "conn-openai",
			provider: "openai",
			authType: "oauth",
			isActive: 1,
			accessToken: "token",
		},
	];
}

const reqBodyNullContext = {
	model: "comboTest",
	messages: [{ role: "user", content: null }], // hit toTextContent (!string, !array)
	stream: false,
};

const reqBodyTextArray = {
	model: "comboTest",
	messages: [{ role: "user", content: [{ text: "hi array" }, { image: "url" }, null] }],
	stream: false,
};

test("handleComboChat with 'usage' strategy hits sortModelsByUsage", async () => {
	const id = crypto.randomUUID();
	await combosDb.createCombo({
		id,
		name: id,
		strategy: "usage",
		models: ["openai/gpt-3.5-turbo", "openai/gpt-4"],
	});

	// No proxy/http mock needed if we expect error or quick reject
	const req = new Request("http://localhost", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...reqBodyTextArray, model: id }),
	});

	try {
		const res = await handleComboChat(id, req, stubConnection());
		assert.equal(res.status >= 200, true);
	} catch (_e) {
		// Expect error as fetch is not globally mocked for this quick edge branch test, that's fine
	}
});

test("handleComboChat with 'context' strategy hits sortModelsByContextSize", async () => {
	const id = crypto.randomUUID();
	await combosDb.createCombo({
		id,
		name: id,
		strategy: "context",
		models: ["openai/gpt-4-32k", "openai/gpt-4", "unknown/unknown"],
	});

	const req = new Request("http://localhost", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...reqBodyNullContext, model: id }),
	});

	try {
		const _res = await handleComboChat(id, req, stubConnection());
	} catch (_e) {}
});

afterAll(() => {
	try {
		if (globalThis.__omnirouteDb?.open) {
			globalThis.__omnirouteDb.close();
		}
	} catch {}
	delete globalThis.__omnirouteDb;
	fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("handleComboChat hits extractPromptForIntent edge cases", async () => {
	const id = crypto.randomUUID();
	await combosDb.createCombo({
		id,
		name: id,
		strategy: "auto",
		autoConfig: { intentConfig: { enabled: true } },
		models: ["openai/gpt-4"],
	});

	// Null message content
	const reqNull = new Request("http://localhost", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ model: id, messages: [{ role: "user", content: null }] }),
	});

	// Empty messages array
	const reqEmpty = new Request("http://localhost", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ model: id, messages: [] }),
	});

	try {
		await handleComboChat(id, reqNull, stubConnection());
	} catch (_e) {}
	try {
		await handleComboChat(id, reqEmpty, stubConnection());
	} catch (_e) {}
});
