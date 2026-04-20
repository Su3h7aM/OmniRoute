import { afterAll, beforeEach, test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_USERPROFILE = process.env.USERPROFILE;
const ORIGINAL_DATA_DIR = process.env.DATA_DIR;
const ORIGINAL_NEXT_PHASE = process.env.NEXT_PHASE;

const TEST_HOME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-usage-migrations-home-"));
const TEST_DATA_DIR = path.join(TEST_HOME_DIR, "data");

process.env.HOME = TEST_HOME_DIR;
process.env.USERPROFILE = TEST_HOME_DIR;
process.env.DATA_DIR = TEST_DATA_DIR;
delete process.env.NEXT_PHASE;

const { getLegacyDotDataDir } = await import("../../src/lib/dataPaths.ts");
const migrations = await import("../../src/lib/usage/migrations.ts");
const { getDbInstance } = await import("../../src/lib/db/core.ts");

function getLegacyDataDir() {
	return migrations.getLegacyDataDir() || getLegacyDotDataDir();
}

function getLegacyUsageJsonFile() {
	return path.join(getLegacyDataDir(), "usage.json");
}

function getLegacyCallLogsJsonFile() {
	return path.join(getLegacyDataDir(), "call_logs.json");
}

function getUsageJsonFile() {
	return path.join(TEST_DATA_DIR, "usage.json");
}

function getCallLogsJsonFile() {
	return path.join(TEST_DATA_DIR, "call_logs.json");
}

function writeJson(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function removePath(targetPath) {
	if (!targetPath) return;
	fs.rmSync(targetPath, { recursive: true, force: true });
}

function resetDbTables() {
	const db = getDbInstance();
	db.prepare("DELETE FROM usage_history").run();
	db.prepare("DELETE FROM call_logs").run();
}

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

beforeEach(() => {
	process.env.HOME = TEST_HOME_DIR;
	process.env.USERPROFILE = TEST_HOME_DIR;
	process.env.DATA_DIR = TEST_DATA_DIR;
	delete process.env.NEXT_PHASE;
	migrations.configureUsageMigrationPathsForTests({
		legacyDataDir: path.join(TEST_HOME_DIR, ".omniroute"),
		dataDir: TEST_DATA_DIR,
	});

	fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
	const legacyDataDir = getLegacyDataDir();
	const usageJsonFile = getUsageJsonFile();
	const callLogsJsonFile = getCallLogsJsonFile();
	removePath(legacyDataDir);
	removePath(usageJsonFile);
	removePath(`${usageJsonFile}.migrated`);
	removePath(callLogsJsonFile);
	removePath(`${callLogsJsonFile}.migrated`);
	removePath(migrations.CALL_LOGS_DIR);
	removePath(migrations.LOG_ARCHIVES_DIR);
	resetDbTables();
});

afterAll(() => {
	try {
		const db = getDbInstance();
		if (db?.open) db.close();
	} catch {
		// Database may already be closed.
	}

	if (ORIGINAL_HOME === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = ORIGINAL_HOME;
	}

	if (ORIGINAL_USERPROFILE === undefined) {
		delete process.env.USERPROFILE;
	} else {
		process.env.USERPROFILE = ORIGINAL_USERPROFILE;
	}

	if (ORIGINAL_DATA_DIR === undefined) {
		delete process.env.DATA_DIR;
	} else {
		process.env.DATA_DIR = ORIGINAL_DATA_DIR;
	}

	if (ORIGINAL_NEXT_PHASE === undefined) {
		delete process.env.NEXT_PHASE;
	} else {
		process.env.NEXT_PHASE = ORIGINAL_NEXT_PHASE;
	}

	migrations.configureUsageMigrationPathsForTests();
	removePath(TEST_HOME_DIR);
});

test.serial(
	"migrateLegacyUsageFiles copies legacy JSON files once and does not overwrite existing targets",
	() => {
		const legacyUsageJsonFile = getLegacyUsageJsonFile();
		const legacyCallLogsJsonFile = getLegacyCallLogsJsonFile();
		const usageJsonFile = getUsageJsonFile();
		const callLogsJsonFile = getCallLogsJsonFile();

		writeJson(legacyUsageJsonFile, { history: [{ provider: "legacy-openai" }] });
		writeJson(legacyCallLogsJsonFile, { logs: [{ id: "legacy-call" }] });

		migrations.migrateLegacyUsageFiles();

		assert.deepEqual(readJson(usageJsonFile), { history: [{ provider: "legacy-openai" }] });
		assert.deepEqual(readJson(callLogsJsonFile), { logs: [{ id: "legacy-call" }] });

		writeJson(usageJsonFile, { history: [{ provider: "current-openai" }] });
		writeJson(callLogsJsonFile, { logs: [{ id: "current-call" }] });
		writeJson(legacyUsageJsonFile, { history: [{ provider: "legacy-should-not-win" }] });
		writeJson(legacyCallLogsJsonFile, { logs: [{ id: "legacy-should-not-win" }] });

		migrations.migrateLegacyUsageFiles();

		assert.deepEqual(readJson(usageJsonFile), { history: [{ provider: "current-openai" }] });
		assert.deepEqual(readJson(callLogsJsonFile), { logs: [{ id: "current-call" }] });
	}
);

test("migrateUsageJsonToSqlite migrates usage history aliases and TTFT fallbacks", () => {
	writeJson(getUsageJsonFile(), {
		history: [
			{
				provider: "openai",
				model: "gpt-4o-mini",
				connectionId: "conn-openai",
				apiKeyId: "key-1",
				apiKeyName: "Primary Key",
				tokens: {
					prompt_tokens: 11,
					completion_tokens: 7,
					cached_tokens: 2,
					cache_creation_input_tokens: 3,
					reasoning_tokens: 5,
				},
				status: "error",
				success: false,
				latencyMs: "17",
				errorCode: "timeout",
				timestamp: "2026-01-01T00:00:00.000Z",
			},
			{
				provider: "gemini",
				model: "gemini-2.5-flash",
				tokens: {
					input: 9,
					output: 4,
					cacheRead: 1,
					cacheCreation: 2,
					reasoning: 3,
				},
				latencyMs: "99",
				timeToFirstTokenMs: "13",
				timestamp: "2026-01-02T00:00:00.000Z",
			},
		],
	});

	migrations.migrateUsageJsonToSqlite();

	assert.equal(fs.existsSync(`${getUsageJsonFile()}.migrated`), true);

	const db = getDbInstance();
	const rows = db
		.prepare(
			`
        SELECT provider, model, connection_id, api_key_id, api_key_name,
               tokens_input, tokens_output, tokens_cache_read, tokens_cache_creation,
               tokens_reasoning, status, success, latency_ms, ttft_ms, error_code
        FROM usage_history
        ORDER BY timestamp ASC
      `
		)
		.all();

	assert.deepEqual(rows, [
		{
			provider: "openai",
			model: "gpt-4o-mini",
			connection_id: "conn-openai",
			api_key_id: "key-1",
			api_key_name: "Primary Key",
			tokens_input: 11,
			tokens_output: 7,
			tokens_cache_read: 2,
			tokens_cache_creation: 3,
			tokens_reasoning: 5,
			status: "error",
			success: 0,
			latency_ms: 17,
			ttft_ms: 17,
			error_code: "timeout",
		},
		{
			provider: "gemini",
			model: "gemini-2.5-flash",
			connection_id: null,
			api_key_id: null,
			api_key_name: null,
			tokens_input: 9,
			tokens_output: 4,
			tokens_cache_read: 1,
			tokens_cache_creation: 2,
			tokens_reasoning: 3,
			status: null,
			success: 1,
			latency_ms: 99,
			ttft_ms: 13,
			error_code: null,
		},
	]);
});

test("migrateUsageJsonToSqlite migrates call logs to summary rows and ignores duplicate ids", () => {
	writeJson(getCallLogsJsonFile(), {
		logs: [
			{
				id: "call-1",
				timestamp: "2026-02-01T00:00:00.000Z",
				method: "GET",
				path: "/v1/chat/completions",
				status: 201,
				model: "gpt-4o-mini",
				provider: "openai",
				account: "acct-a",
				connectionId: "conn-a",
				duration: 31,
				tokens: { in: 12, out: 8 },
				sourceFormat: "openai",
				targetFormat: "openai",
				apiKeyId: "key-a",
				apiKeyName: "Key A",
				comboName: "combo-a",
				requestBody: { messages: [{ role: "user", content: "hi" }] },
				responseBody: { id: "resp-1" },
				error: "bad upstream",
			},
			{
				id: "call-1",
				timestamp: "2026-02-01T01:00:00.000Z",
				method: "PATCH",
				path: "/should-be-ignored",
			},
			{
				timestamp: "2026-02-02T00:00:00.000Z",
				requestBody: { foo: "bar" },
			},
		],
	});

	migrations.migrateUsageJsonToSqlite();

	assert.equal(fs.existsSync(`${getCallLogsJsonFile()}.migrated`), true);

	const db = getDbInstance();
	const rows = db
		.prepare(
			`
        SELECT id, method, path, status, provider, account, connection_id,
               detail_state, artifact_relpath, has_request_body, has_response_body, error_summary
        FROM call_logs
        ORDER BY timestamp ASC
      `
		)
		.all();

	assert.equal(rows.length, 2);
	assert.deepEqual(rows[0], {
		id: "call-1",
		method: "GET",
		path: "/v1/chat/completions",
		status: 201,
		provider: "openai",
		account: "acct-a",
		connection_id: "conn-a",
		detail_state: "ready",
		artifact_relpath: rows[0].artifact_relpath,
		has_request_body: 1,
		has_response_body: 1,
		error_summary: "bad upstream",
	});
	assert.equal(typeof rows[0].artifact_relpath, "string");
	assert.equal(rows[1].id.length > 0, true);
	assert.equal(rows[1].method, "POST");
	assert.equal(rows[1].path, null);
	assert.equal(rows[1].status, 0);
	assert.equal(rows[1].provider, null);
	assert.equal(rows[1].account, null);
	assert.equal(rows[1].connection_id, null);
	assert.equal(rows[1].detail_state, "ready");
	assert.equal(rows[1].has_request_body, 1);
	assert.equal(rows[1].has_response_body, 0);
	assert.equal(rows[1].error_summary, null);

	const firstArtifact = JSON.parse(
		fs.readFileSync(path.join(TEST_DATA_DIR, "call_logs", rows[0].artifact_relpath), "utf8")
	);
	assert.deepEqual(firstArtifact.requestBody, { messages: [{ role: "user", content: "hi" }] });
	assert.deepEqual(firstArtifact.responseBody, { id: "resp-1" });

	const secondArtifact = JSON.parse(
		fs.readFileSync(path.join(TEST_DATA_DIR, "call_logs", rows[1].artifact_relpath), "utf8")
	);
	assert.deepEqual(secondArtifact.requestBody, { foo: "bar" });
	assert.equal(secondArtifact.responseBody, null);
});

test("migrateUsageJsonToSqlite renames empty JSON payloads without inserting rows", () => {
	writeJson(getUsageJsonFile(), { history: [] });
	writeJson(getCallLogsJsonFile(), { logs: [] });

	migrations.migrateUsageJsonToSqlite();

	assert.equal(fs.existsSync(`${getUsageJsonFile()}.migrated`), true);
	assert.equal(fs.existsSync(`${getCallLogsJsonFile()}.migrated`), true);

	const db = getDbInstance();
	assert.equal(db.prepare("SELECT COUNT(*) AS count FROM usage_history").get().count, 0);
	assert.equal(db.prepare("SELECT COUNT(*) AS count FROM call_logs").get().count, 0);
});

test("migrateUsageJsonToSqlite leaves malformed JSON files in place and reports both failures", () => {
	fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
	fs.writeFileSync(getUsageJsonFile(), "{bad json");
	fs.writeFileSync(getCallLogsJsonFile(), "{bad json");

	const errors = [];
	const originalConsoleError = console.error;
	console.error = (...args) => {
		errors.push(args.map(String).join(" "));
	};

	try {
		migrations.migrateUsageJsonToSqlite();
	} finally {
		console.error = originalConsoleError;
	}

	assert.equal(fs.existsSync(getUsageJsonFile()), true);
	assert.equal(fs.existsSync(`${getUsageJsonFile()}.migrated`), false);
	assert.equal(fs.existsSync(getCallLogsJsonFile()), true);
	assert.equal(fs.existsSync(`${getCallLogsJsonFile()}.migrated`), false);

	const db = getDbInstance();
	assert.equal(db.prepare("SELECT COUNT(*) AS count FROM usage_history").get().count, 0);
	assert.equal(db.prepare("SELECT COUNT(*) AS count FROM call_logs").get().count, 0);
	assert.ok(errors.some((entry) => entry.includes("Failed to migrate usage.json")));
	assert.ok(errors.some((entry) => entry.includes("Failed to migrate call_logs.json")));
});
