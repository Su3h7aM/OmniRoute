const DEFAULT_CURSOR_VERSION = "3.1.15";

export function getCursorVersion(): string {
	return (
		process.env.OMNIROUTE_CURSOR_CLIENT_VERSION?.trim() ||
		process.env.CURSOR_CLIENT_VERSION?.trim() ||
		DEFAULT_CURSOR_VERSION
	);
}

export function resetCursorVersionCache(): void {
	// Kept for tests and existing call sites. Cursor version is env/static now.
}

export { DEFAULT_CURSOR_VERSION };
