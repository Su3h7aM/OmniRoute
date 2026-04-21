import { isIpAddress } from "@/shared/network/ipAddress";

/**
 * T07: Extract the real client IP from X-Forwarded-For header.
 * Skips invalid entries like "unknown" or empty strings.
 * Falls back to remoteAddress if no valid IP found.
 * Ref: sub2api PR #1135
 *
 * @param xForwardedFor - Value of the X-Forwarded-For header (may be CSV)
 * @param remoteAddress - Fallback from the raw socket (req.socket.remoteAddress)
 * @returns The first valid IP address found, or "unknown"
 */
function getFirstValidIp(value: string | null | undefined): string | null {
	if (!value) return null;

	for (const entry of value.split(",")) {
		const candidate = entry.trim();
		if (candidate && isIpAddress(candidate)) {
			return candidate;
		}
	}

	return null;
}

export function extractClientIp(
	xForwardedFor: string | null | undefined,
	remoteAddress: string | undefined
): string {
	return getFirstValidIp(xForwardedFor) ?? remoteAddress?.trim() ?? "unknown";
}

/**
 * Extract client IP from a Request or NextRequest object.
 * Checks X-Forwarded-For, X-Real-IP, CF-Connecting-IP, then socket.
 */
export function getClientIpFromRequest(req: {
	headers?: Headers | { get?: (n: string) => string | null };
	socket?: { remoteAddress?: string };
	ip?: string;
}): string {
	// Helper to get header value from either Headers object or plain object
	const getHeader = (name: string): string | null => {
		if (!req.headers) return null;
		if (typeof (req.headers as Headers).get === "function") {
			return (req.headers as Headers).get(name);
		}
		return null;
	};

	// Priority: CF-Connecting-IP (Cloudflare) > X-Forwarded-For > X-Real-IP > socket
	const cfIp = getFirstValidIp(getHeader("cf-connecting-ip"));
	if (cfIp) return cfIp;

	const xff = getHeader("x-forwarded-for");
	const realIp = getHeader("x-real-ip");
	const remoteAddress = req.ip ?? req.socket?.remoteAddress;

	return extractClientIp(xff ?? realIp, remoteAddress);
}
