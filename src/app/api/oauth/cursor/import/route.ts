import { NextResponse } from "next/server";
import { CursorService } from "@/lib/oauth/services/cursor";
import { createProviderConnection, isCloudEnabled, resolveProxyForProvider } from "@/models";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/lib/cloudSync";
import { cursorImportSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { runWithProxyContext } from "@omniroute/open-sse/utils/proxyFetch.ts";

/**
 * POST /api/oauth/cursor/import
 * Validate a manually provided Cursor access token.
 *
 * Request body:
 * - accessToken: string
 * - machineId: string
 */
export async function POST(request: Request) {
	let rawBody;
	try {
		rawBody = await request.json();
	} catch {
		return NextResponse.json(
			{
				error: {
					message: "Invalid request",
					details: [{ field: "body", message: "Invalid JSON body" }],
				},
			},
			{ status: 400 }
		);
	}

	try {
		const validation = validateBody(cursorImportSchema, rawBody);
		if (isValidationFailure(validation)) {
			return NextResponse.json({ error: validation.error }, { status: 400 });
		}
		const { accessToken, machineId } = validation.data;

		const cursorService = new CursorService();

		// Resolve proxy for this provider (provider-level → global → direct)
		const proxy = await resolveProxyForProvider("cursor");

		// Validate token by making API call (through proxy if configured)
		const tokenData = await runWithProxyContext(proxy, () =>
			cursorService.validateImportToken(accessToken.trim(), machineId?.trim())
		);

		// Try to extract user info from token.
		const userInfo = cursorService.extractUserInfo(tokenData.accessToken);

		// Save to database
		const connection: any = await createProviderConnection({
			provider: "cursor",
			authType: "oauth",
			accessToken: tokenData.accessToken,
			refreshToken: null, // Cursor doesn't have public refresh endpoint
			expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000).toISOString(),
			email: userInfo?.email || null,
			providerSpecificData: {
				machineId: tokenData.machineId,
				authMethod: "manual",
				provider: "Manual",
				userId: userInfo?.userId,
			},
			testStatus: "active",
		});

		// Auto sync to Cloud if enabled
		await syncToCloudIfEnabled();

		return NextResponse.json({
			success: true,
			connection: {
				id: connection.id,
				provider: connection.provider,
				email: connection.email,
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.log("Cursor token validation error:", error);
		return NextResponse.json({ error: message }, { status: 500 });
	}
}

/**
 * Sync to Cloud if enabled
 */
async function syncToCloudIfEnabled() {
	try {
		const cloudEnabled = await isCloudEnabled();
		if (!cloudEnabled) return;

		const machineId = await getConsistentMachineId();
		await syncToCloud(machineId);
	} catch (error) {
		console.log("Error syncing to cloud after Cursor token save:", error);
	}
}
