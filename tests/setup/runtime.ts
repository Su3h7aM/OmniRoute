import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_RUNTIME_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-test-runtime-"));
const TEST_DATA_DIR = path.join(TEST_RUNTIME_ROOT, "data");
const TEST_HOME_DIR = path.join(TEST_RUNTIME_ROOT, "home");
const TEST_XDG_CONFIG_HOME = path.join(TEST_RUNTIME_ROOT, "xdg-config");

fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
fs.mkdirSync(TEST_HOME_DIR, { recursive: true });
fs.mkdirSync(TEST_XDG_CONFIG_HOME, { recursive: true });

if (!process.env.DATA_DIR) {
	process.env.DATA_DIR = TEST_DATA_DIR;
}
if (!process.env.HOME) {
	process.env.HOME = TEST_HOME_DIR;
}
if (!process.env.USERPROFILE) {
	process.env.USERPROFILE = TEST_HOME_DIR;
}
if (!process.env.XDG_CONFIG_HOME) {
	process.env.XDG_CONFIG_HOME = TEST_XDG_CONFIG_HOME;
}

process.once("exit", () => {
	try {
		if (globalThis.__omnirouteDb?.open) {
			globalThis.__omnirouteDb.close();
		}
	} catch {}

	try {
		fs.rmSync(TEST_RUNTIME_ROOT, { recursive: true, force: true });
	} catch {
		// Best effort cleanup.
	}
});
