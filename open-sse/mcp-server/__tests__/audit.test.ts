import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";

type MockAuditDb = {
	prepare: ReturnType<typeof vi.fn>;
	pragma: ReturnType<typeof vi.fn>;
	run: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
	open?: boolean;
};

function createStatementMock() {
	return {
		get: vi.fn(),
		all: vi.fn(),
		run: vi.fn(),
	};
}

describe("MCP audit shutdown", () => {
	let dataDir: string;
	let dbFile: string;

	beforeEach(() => {
		globalThis.__omnirouteMcpAuditDb = undefined;
		dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-mcp-audit-"));
		dbFile = path.join(dataDir, "storage.sqlite");
		fs.writeFileSync(dbFile, "");
		process.env.DATA_DIR = dataDir;
	});

	afterEach(() => {
		delete process.env.DATA_DIR;
		globalThis.__omnirouteMcpAuditDb = undefined;
		delete (globalThis as any).mockDbFactory;
		vi.restoreAllMocks();
	});

	it("checkpoints and closes the audit database during shutdown", async () => {
		const mockDb: MockAuditDb = {
			prepare: vi.fn(() => createStatementMock()),
			pragma: vi.fn(),
			run: vi.fn(),
			close: vi.fn(),
			open: true,
		};
		(globalThis as any).mockDbFactory = vi.fn(() => mockDb);

		const audit = await import("file:///tmp/omniroute-audit-test-close.ts?case=close");

		await audit.logToolCall("omniroute_get_health", { ok: true }, { ok: true }, 12, true);
		expect(mockDb.prepare).toHaveBeenCalledTimes(1);

		expect(audit.closeAuditDb()).toBe(true);
		expect(mockDb.run).toHaveBeenCalledWith("PRAGMA wal_checkpoint(TRUNCATE)");
		expect(mockDb.close).toHaveBeenCalledTimes(1);
		expect(audit.closeAuditDb()).toBe(false);
	});

	it("still closes the audit database when checkpoint fails", async () => {
		const mockDb: MockAuditDb = {
			prepare: vi.fn(() => createStatementMock()),
			pragma: vi.fn(),
			run: vi.fn(() => {
				throw new Error("database is busy");
			}),
			close: vi.fn(),
			open: true,
		};
		(globalThis as any).mockDbFactory = vi.fn(() => mockDb);

		const audit = await import("file:///tmp/omniroute-audit-test-busy.ts?case=busy");

		await audit.logToolCall("omniroute_get_health", {}, {}, 5, true);
		expect(audit.closeAuditDb()).toBe(true);
		expect(mockDb.close).toHaveBeenCalledTimes(1);
	});
});
