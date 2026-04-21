import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

const dataDir = path.join(os.tmpdir(), `omniroute-mitm-manager-${process.pid}`);
const mitmDir = path.join(dataDir, "mitm");
const certPath = path.join(mitmDir, "server.crt");
const pidFile = path.join(mitmDir, ".mitm.pid");

mock.module("@/lib/dataPaths", () => ({
	resolveDataDir: () => dataDir,
}));

const addDNSEntry = mock(async () => {});
const removeDNSEntry = mock(async () => {});
const generateCert = mock(async () => {
	fs.mkdirSync(mitmDir, { recursive: true });
	fs.writeFileSync(certPath, "cert");
});
const installCert = mock(async () => {});

mock.module("../../src/mitm/dns/dnsConfig", () => ({
	addDNSEntry,
	removeDNSEntry,
}));
mock.module("../../src/mitm/cert/generate", () => ({
	generateCert,
}));
mock.module("../../src/mitm/cert/install", () => ({
	installCert,
}));
mock.module("@/mitm/dns/dnsConfig", () => ({
	addDNSEntry,
	removeDNSEntry,
}));
mock.module("@/mitm/cert/generate", () => ({
	generateCert,
}));
mock.module("@/mitm/cert/install", () => ({
	installCert,
}));

type FakeProc = {
	pid: number;
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	exitCode: number | null;
	exited: Promise<number>;
	kill: ReturnType<typeof mock<(signal?: string) => void>>;
	resolveExit: (code: number) => void;
};

function createFakeProcess(pid: number): FakeProc {
	let resolveExit: (code: number) => void = () => {};
	const exited = new Promise<number>((resolve) => {
		resolveExit = (code) => {
			proc.exitCode = code;
			resolve(code);
		};
	});
	const proc: FakeProc = {
		pid,
		stdout: new ReadableStream<Uint8Array>(),
		stderr: new ReadableStream<Uint8Array>(),
		exitCode: null,
		exited,
		kill: mock(() => {}),
		resolveExit,
	};
	return proc;
}

function resetTestState() {
	fs.rmSync(dataDir, { recursive: true, force: true });
	fs.mkdirSync(mitmDir, { recursive: true });
	addDNSEntry.mockClear();
	removeDNSEntry.mockClear();
	generateCert.mockClear();
	installCert.mockClear();
}

describe("mitm manager", () => {
	beforeEach(() => {
		resetTestState();
	});

	afterEach(async () => {
		const manager = await import("../../src/mitm/manager.ts");
		manager.__resetMitmManagerForTests();
		fs.rmSync(dataDir, { recursive: true, force: true });
	});

	it("starts the MITM server with Bun.spawn orchestration", async () => {
		const proc = createFakeProcess(4321);
		const manager = await import("../../src/mitm/manager.ts");
		manager.__setMitmTimingsForTests({ startTimeoutMs: 1, stopGraceMs: 1 });
		manager.__setMitmSpawnForTests(() => proc as never);

		const result = await manager.startMitm("secret-api-key", "sudo-pass");

		expect(generateCert).toHaveBeenCalledTimes(1);
		expect(installCert).toHaveBeenCalledWith("sudo-pass", certPath);
		expect(addDNSEntry).toHaveBeenCalledWith("sudo-pass");
		expect(result).toEqual({ running: true, pid: 4321 });
		expect(fs.existsSync(pidFile)).toBe(true);
	});

	it("stops the in-memory MITM process and clears state", async () => {
		fs.writeFileSync(certPath, "cert");
		const proc = createFakeProcess(9876);
		proc.kill.mockImplementation((signal?: string) => {
			if (signal === "SIGTERM") {
				queueMicrotask(() => proc.resolveExit(0));
			}
		});

		const manager = await import("../../src/mitm/manager.ts");
		manager.__setMitmTimingsForTests({ startTimeoutMs: 1, stopGraceMs: 1 });
		manager.__setMitmSpawnForTests(() => proc as never);
		await manager.startMitm("secret-api-key", "sudo-pass");
		manager.setCachedPassword("sudo-pass");

		const result = await manager.stopMitm("sudo-pass");

		expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
		expect(removeDNSEntry).toHaveBeenCalledWith("sudo-pass");
		expect(result).toEqual({ running: false, pid: null });
		expect(manager.getCachedPassword()).toBeNull();
		expect(fs.existsSync(pidFile)).toBe(false);
	});

	it("reports running status from the pid file fallback", async () => {
		fs.writeFileSync(certPath, "cert");
		fs.writeFileSync(pidFile, String(process.pid));
		const manager = await import("../../src/mitm/manager.ts");

		const status = await manager.getMitmStatus();

		expect(status.running).toBe(true);
		expect(status.pid).toBe(process.pid);
		expect(status.certExists).toBe(true);
	});
});
