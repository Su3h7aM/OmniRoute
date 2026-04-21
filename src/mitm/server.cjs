const fs = require("fs");
const path = require("path");
const dns = require("dns");
const { promisify } = require("util");
const os = require("os");
const { passthroughToTarget } = require("./upstream.cjs");
const { INTERCEPT_RESPONSE_HEADERS, interceptToRouter } = require("./intercept.cjs");

function getDataDir() {
	if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR.trim());
	return path.join(os.homedir(), ".omniroute");
}

const TARGET_HOST = "daily-cloudcode-pa.googleapis.com";
const LOCAL_PORT = 443;
const ROUTER_BASE_URL = (
	process.env.OMNIROUTE_BASE_URL ||
	process.env.BASE_URL ||
	"http://localhost:20128"
)
	.trim()
	.replace(/\/+$/, "");
const ROUTER_URL = `${ROUTER_BASE_URL}/v1/chat/completions`;
const API_KEY = process.env.ROUTER_API_KEY;
const DATA_DIR = getDataDir();
const DB_FILE = path.join(DATA_DIR, "db.json");
const SQLITE_FILE = path.join(DATA_DIR, "storage.sqlite");

let sqliteDb = null;

const ENABLE_FILE_LOG = false;
const CHAT_URL_PATTERNS = [":generateContent", ":streamGenerateContent"];
const LOG_DIR = path.join(__dirname, "../../logs/mitm");

if (ENABLE_FILE_LOG && !fs.existsSync(LOG_DIR)) {
	fs.mkdirSync(LOG_DIR, { recursive: true });
}

if (!API_KEY) {
	console.error("❌ ROUTER_API_KEY required");
	process.exit(1);
}

function safeLogPath(name) {
	const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 80);
	const resolved = path.resolve(LOG_DIR, safe);
	if (!resolved.startsWith(path.resolve(LOG_DIR) + path.sep)) {
		throw new Error("Path traversal attempt detected in log filename");
	}
	return resolved;
}

function saveRequestLog(url, bodyBuffer) {
	if (!ENABLE_FILE_LOG) return;
	try {
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const urlSlug = url.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 60);
		const filePath = safeLogPath(`${timestamp}_${urlSlug}.json`);
		const body = JSON.parse(bodyBuffer.toString());
		fs.writeFileSync(filePath, JSON.stringify(body, null, 2));
		console.log(`💾 Saved request: ${filePath}`);
	} catch {
		// Ignore
	}
}

let cachedTargetIP = null;
async function resolveTargetIP() {
	if (cachedTargetIP) return cachedTargetIP;
	const resolver = new dns.Resolver();
	resolver.setServers(["8.8.8.8"]);
	const resolve4 = promisify(resolver.resolve4.bind(resolver));
	const addresses = await resolve4(TARGET_HOST);
	cachedTargetIP = addresses[0];
	return cachedTargetIP;
}

function extractModel(bodyBuffer) {
	try {
		return JSON.parse(bodyBuffer.toString()).model || null;
	} catch {
		return null;
	}
}

function getSqliteDb() {
	if (sqliteDb) return sqliteDb;
	try {
		const { Database } = require("bun:sqlite");
		if (fs.existsSync(SQLITE_FILE)) {
			sqliteDb = new Database(SQLITE_FILE, { readonly: true, strict: true });
			return sqliteDb;
		}
	} catch {
		// bun:sqlite not available in this process
	}
	return null;
}

function getMappedModel(model) {
	if (!model) return null;

	try {
		const db = getSqliteDb();
		if (db) {
			const row = db
				.prepare(
					"SELECT value FROM key_value WHERE namespace = 'mitmAlias' AND key = 'antigravity'"
				)
				.get();
			if (row) {
				const mappings = JSON.parse(row.value);
				return mappings[model] || null;
			}
		}
	} catch {
		// Fall through to JSON fallback
	}

	try {
		if (fs.existsSync(DB_FILE)) {
			const db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
			return db.mitmAlias?.antigravity?.[model] || null;
		}
	} catch {
		// Ignore
	}

	return null;
}

function isTlsVerificationEnabled() {
	return process.env.MITM_DISABLE_TLS_VERIFY !== "1";
}

function createErrorResponse(message, status = 500) {
	return new Response(JSON.stringify({ error: { message, type: "mitm_error" } }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

async function passthrough(request, bodyBuffer) {
	try {
		return await passthroughToTarget({
			requestPath: new URL(request.url).pathname + new URL(request.url).search,
			method: request.method,
			headers: request.headers,
			bodyBuffer,
			targetHost: TARGET_HOST,
			resolveTargetIP,
			tlsRejectUnauthorized: isTlsVerificationEnabled(),
		});
	} catch (error) {
		console.error(`❌ Passthrough error: ${error.message}`);
		return new Response("Bad Gateway", { status: 502 });
	}
}

async function intercept(bodyBuffer, mappedModel) {
	try {
		const response = await interceptToRouter({
			bodyBuffer,
			mappedModel,
			routerUrl: ROUTER_URL,
			apiKey: API_KEY,
		});

		return new Response(response.body, {
			status: 200,
			headers: INTERCEPT_RESPONSE_HEADERS,
		});
	} catch (error) {
		console.error(`❌ ${error.message}`);
		return createErrorResponse(error.message);
	}
}

async function handleRequest(request) {
	const bodyBuffer = Buffer.from(await request.arrayBuffer());
	const requestUrl = new URL(request.url);

	if (bodyBuffer.length > 0) {
		saveRequestLog(requestUrl.pathname + requestUrl.search, bodyBuffer);
	}

	if (request.headers.get("x-omniroute-source") === "omniroute") {
		return passthrough(request, bodyBuffer);
	}

	const requestPath = requestUrl.pathname + requestUrl.search;
	const isChatRequest = CHAT_URL_PATTERNS.some((pattern) => requestPath.includes(pattern));
	if (!isChatRequest) {
		return passthrough(request, bodyBuffer);
	}

	const model = extractModel(bodyBuffer);
	const mappedModel = getMappedModel(model);
	if (!mappedModel) {
		return passthrough(request, bodyBuffer);
	}

	console.log(`🔀 ${model} → ${mappedModel}`);
	return intercept(bodyBuffer, mappedModel);
}

const server = Bun.serve({
	port: LOCAL_PORT,
	tls: {
		key: Bun.file(path.join(DATA_DIR, "mitm", "server.key")),
		cert: Bun.file(path.join(DATA_DIR, "mitm", "server.crt")),
	},
	fetch: handleRequest,
	error(error) {
		console.error(`❌ ${error.message}`);
		return createErrorResponse(error.message);
	},
});

console.log(`🚀 MITM ready on :${LOCAL_PORT} → ${ROUTER_URL}`);

process.on("SIGTERM", () => {
	server.stop(true);
	process.exit(0);
});
process.on("SIGINT", () => {
	server.stop(true);
	process.exit(0);
});
