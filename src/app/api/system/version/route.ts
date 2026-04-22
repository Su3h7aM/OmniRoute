/**
 * GET /api/system/version — Returns current version and latest available on the registry.
 * POST /api/system/version — Deprecated; in-app auto-update is disabled.
 */
import { type NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import packageJson from "../../../../../package.json";
import { promisify } from "util";
import { isAuthenticated } from "@/shared/utils/apiAuth";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

async function getLatestRegistryVersion(): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync(
			"bun",
			["pm", "view", "omniroute", "version", "--json"],
			{ timeout: 10000 }
		);
		const parsed = JSON.parse(stdout.trim());
		return typeof parsed === "string" ? parsed : null;
	} catch {
		return null;
	}
}

function getCurrentVersion(): string {
	return packageJson.version || "unknown";
}

function isNewer(a: string | null, b: string): boolean {
	if (!a) return false;
	const parseVersion = (version: string) => version.split(".").map(Number);
	const [aMaj, aMin, aPat] = parseVersion(a);
	const [bMaj, bMin, bPat] = parseVersion(b);
	if (aMaj !== bMaj) return aMaj > bMaj;
	if (aMin !== bMin) return aMin > bMin;
	return aPat > bPat;
}

export async function GET(req: NextRequest) {
	if (!(await isAuthenticated(req))) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const current = getCurrentVersion();
	const latest = await getLatestRegistryVersion();

	return NextResponse.json({
		current,
		latest: latest ?? "unavailable",
		updateAvailable: isNewer(latest, current),
		manualUpdateRequired: true,
		updateMessage: "In-app auto-update is deprecated. Update this deployment externally.",
	});
}

export async function POST(req: NextRequest) {
	if (!(await isAuthenticated(req))) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const current = getCurrentVersion();
	const latest = await getLatestRegistryVersion();

	return NextResponse.json(
		{
			success: false,
			deprecated: true,
			manualUpdateRequired: true,
			current,
			latest,
			updateAvailable: isNewer(latest, current),
			error: "In-app auto-update is deprecated. Update this deployment externally.",
		},
		{ status: 410 }
	);
}
