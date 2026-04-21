import path from "path";
import fs from "fs";
import { resolveDataDir } from "@/lib/dataPaths";
import { addDNSEntry, removeDNSEntry } from "./dns/dnsConfig";
import { generateCert } from "./cert/generate";
import { installCert } from "./cert/install";

type MitmProcess = Pick<
	Bun.Subprocess<"ignore", "pipe", "pipe">,
	"pid" | "stdout" | "stderr" | "exited" | "kill" | "exitCode"
>;

const DEFAULT_MITM_START_TIMEOUT_MS = 2000;
const DEFAULT_MITM_STOP_GRACE_MS = 1000;

let mitmTimings = {
	startTimeoutMs: DEFAULT_MITM_START_TIMEOUT_MS,
	stopGraceMs: DEFAULT_MITM_STOP_GRACE_MS,
};

const PID_FILE = path.join(resolveDataDir(), "mitm", ".mitm.pid");
const MITM_SERVER_URL = new URL("./server.cjs", import.meta.url);
const MITM_SERVER_PATH =
	process.platform === "win32" && MITM_SERVER_URL.pathname.startsWith("/")
		? decodeURIComponent(MITM_SERVER_URL.pathname.slice(1))
		: decodeURIComponent(MITM_SERVER_URL.pathname);

function createMitmSpawn(apiKey: string): MitmProcess {
	return Bun.spawn([process.execPath, MITM_SERVER_PATH], {
		env: {
			...process.env,
			ROUTER_API_KEY: apiKey,
			NODE_ENV: "production",
		},
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
}

let spawnMitmProcess = (apiKey: string): MitmProcess => createMitmSpawn(apiKey);

let serverProcess: MitmProcess | null = null;
let serverPid: number | null = null;
let _cachedPassword: string | null = null;

export function getCachedPassword() {
	return _cachedPassword;
}

export function setCachedPassword(pwd: string | null | undefined) {
	_cachedPassword = pwd || null;
}

export function clearCachedPassword() {
	_cachedPassword = null;
}

function isProcessAlive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function readPidFile(): number | null {
	try {
		if (!fs.existsSync(PID_FILE)) return null;
		const savedPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
		return savedPid || null;
	} catch {
		return null;
	}
}

function removePidFile() {
	try {
		fs.unlinkSync(PID_FILE);
	} catch {
		// Ignore
	}
}

function writePidFile(pid: number) {
	fs.writeFileSync(PID_FILE, String(pid));
}

function setServerState(proc: MitmProcess | null) {
	serverProcess = proc;
	serverPid = proc?.pid ?? null;
}

function clearServerState(proc?: MitmProcess | null) {
	if (proc && serverProcess !== proc) return;
	setServerState(null);
	removePidFile();
}

function isServerProcessRunning() {
	return serverProcess !== null && serverProcess.exitCode == null;
}

async function pipeMitmLogs(
	stream: ReadableStream<Uint8Array> | undefined | null,
	logger: (message?: unknown, ...optionalParams: unknown[]) => void,
	prefix: string
) {
	if (!stream || typeof stream.getReader !== "function") return;

	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() || "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed) logger(`${prefix} ${trimmed}`);
			}
		}

		const trailing = buffer.trim();
		if (trailing) logger(`${prefix} ${trailing}`);
	} catch {
		// Ignore log piping failures
	}
}

function attachMitmProcessLogging(proc: MitmProcess) {
	void pipeMitmLogs(proc.stdout, console.log, "[MITM Server]");
	void pipeMitmLogs(proc.stderr, console.error, "[MITM Server Error]");
}

function monitorMitmProcess(proc: MitmProcess) {
	void proc.exited
		.then((code) => {
			if (serverProcess !== proc) return;
			console.log(`MITM server exited with code ${code}`);
			clearServerState(proc);
		})
		.catch(() => {
			clearServerState(proc);
		});
}

async function waitForMitmStartup(proc: MitmProcess): Promise<boolean> {
	return Promise.race([
		proc.exited.then(() => false).catch(() => false),
		Bun.sleep(mitmTimings.startTimeoutMs).then(() => true),
	]);
}

async function terminateProcess(proc: MitmProcess) {
	proc.kill("SIGTERM");
	const exited = await Promise.race([
		proc.exited.then(() => true).catch(() => true),
		Bun.sleep(mitmTimings.stopGraceMs).then(() => false),
	]);
	if (!exited) {
		proc.kill("SIGKILL");
		await proc.exited.catch(() => undefined);
	}
}

export async function getMitmStatus() {
	let running = isServerProcessRunning();
	let pid = serverPid;

	if (!running) {
		const savedPid = readPidFile();
		if (savedPid && isProcessAlive(savedPid)) {
			running = true;
			pid = savedPid;
		} else if (savedPid) {
			removePidFile();
		}
	}

	let dnsConfigured = false;
	try {
		const hostsContent = fs.readFileSync("/etc/hosts", "utf-8");
		dnsConfigured = /\bdaily-cloudcode-pa\.googleapis\.com\b/.test(hostsContent);
	} catch {
		// Ignore
	}

	const certDir = path.join(resolveDataDir(), "mitm");
	const certExists = fs.existsSync(path.join(certDir, "server.crt"));

	return { running, pid, dnsConfigured, certExists };
}

export async function startMitm(apiKey: string, sudoPassword: string) {
	if (isServerProcessRunning()) {
		throw new Error("MITM proxy is already running");
	}

	const certPath = path.join(resolveDataDir(), "mitm", "server.crt");
	if (!fs.existsSync(certPath)) {
		console.log("Generating SSL certificate...");
		await generateCert();
	}

	await installCert(sudoPassword, certPath);

	console.log("Adding DNS entry...");
	await addDNSEntry(sudoPassword);

	console.log("Starting MITM server...");
	const proc = spawnMitmProcess(apiKey);
	setServerState(proc);
	writePidFile(proc.pid);
	attachMitmProcessLogging(proc);
	monitorMitmProcess(proc);

	const started = await waitForMitmStartup(proc);
	if (!started) {
		clearServerState(proc);
		throw new Error("MITM server failed to start (port 443 may be in use)");
	}

	return {
		running: true,
		pid: proc.pid,
	};
}

export async function stopMitm(sudoPassword: string) {
	const proc = serverProcess;
	if (proc && isServerProcessRunning()) {
		console.log("Stopping MITM server...");
		await terminateProcess(proc);
		clearServerState(proc);
	} else {
		const savedPid = readPidFile();
		try {
			if (savedPid && isProcessAlive(savedPid)) {
				console.log(`Killing MITM server (PID: ${savedPid})...`);
				process.kill(savedPid, "SIGTERM");
				await Bun.sleep(mitmTimings.stopGraceMs);
				if (isProcessAlive(savedPid)) {
					process.kill(savedPid, "SIGKILL");
				}
			}
		} catch {
			// Ignore
		}
		clearServerState();
	}

	console.log("Removing DNS entry...");
	await removeDNSEntry(sudoPassword);
	clearCachedPassword();

	return {
		running: false,
		pid: null,
	};
}

export function __setMitmSpawnForTests(spawnImpl?: typeof spawnMitmProcess) {
	spawnMitmProcess = spawnImpl || ((apiKey: string) => createMitmSpawn(apiKey));
}

export function __setMitmTimingsForTests(next?: Partial<typeof mitmTimings>) {
	mitmTimings = {
		startTimeoutMs: next?.startTimeoutMs ?? DEFAULT_MITM_START_TIMEOUT_MS,
		stopGraceMs: next?.stopGraceMs ?? DEFAULT_MITM_STOP_GRACE_MS,
	};
}

export function __resetMitmManagerForTests() {
	clearServerState();
	clearCachedPassword();
	__setMitmSpawnForTests();
	__setMitmTimingsForTests();
}
