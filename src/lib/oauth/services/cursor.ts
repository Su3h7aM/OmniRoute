import { getCursorUserAgent } from "@omniroute/open-sse/config/providerHeaderProfiles.ts";
import { CURSOR_CONFIG } from "../constants/oauth";

export class CursorService {
	config: typeof CURSOR_CONFIG;

	constructor() {
		this.config = CURSOR_CONFIG;
	}

	/**
	 * Generate Cursor checksum (jyh cipher)
	 * Algorithm: XOR timestamp bytes with rolling key (initial 165), then base64 encode
	 * Format: {encoded_timestamp},{machineId}
	 */
	generateChecksum(machineId: string) {
		const timestamp = Math.floor(Date.now() / 1000).toString();
		let key = 165;
		const encoded = [];

		for (let i = 0; i < timestamp.length; i++) {
			const charCode = timestamp.charCodeAt(i);
			encoded.push(charCode ^ key);
			key = (key + charCode) & 0xff; // Rolling key update
		}

		const base64Encoded = Buffer.from(encoded).toString("base64");
		return `${base64Encoded},${machineId}`;
	}

	/**
	 * Build request headers for Cursor API
	 */
	buildHeaders(accessToken: string, machineId: string, ghostMode = false) {
		const checksum = this.generateChecksum(machineId);

		return {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/connect+proto",
			"Connect-Protocol-Version": "1",
			"User-Agent": getCursorUserAgent(this.config.clientVersion),
			"x-cursor-client-version": this.config.clientVersion,
			"x-cursor-client-type": this.config.clientType,
			"x-cursor-client-os": this.detectOS(),
			"x-cursor-client-arch": this.detectArch(),
			"x-cursor-client-device-type": "desktop",
			"x-cursor-user-agent": getCursorUserAgent(this.config.clientVersion),
			"x-cursor-checksum": checksum,
			"x-ghost-mode": ghostMode ? "true" : "false",
		};
	}

	/**
	 * Detect OS for headers
	 */
	detectOS() {
		if (typeof process !== "undefined") {
			const platform = process.platform;
			if (platform === "win32") return "windows";
			if (platform === "darwin") return "macos";
			return "linux";
		}
		return "linux";
	}

	/**
	 * Detect architecture for headers
	 */
	detectArch() {
		if (typeof process !== "undefined") {
			const arch = process.arch;
			if (arch === "x64") return "x86_64";
			if (arch === "arm64") return "aarch64";
			return arch;
		}
		return "x86_64";
	}

	/**
	 * Validate a manually provided Cursor access token.
	 * Token will be validated when actually used for requests.
	 */
	async validateImportToken(accessToken: string, machineId?: string) {
		// Basic validation
		if (!accessToken || typeof accessToken !== "string") {
			throw new Error("Access token is required");
		}

		// Token format validation (Cursor tokens are typically long strings)
		if (accessToken.length < 50) {
			throw new Error("Invalid token format. Token appears too short.");
		}

		// Machine ID format validation.
		if (machineId) {
			const uuidRegex = /^[a-f0-9-]{32,}$/i;
			if (!uuidRegex.test(machineId.replace(/-/g, ""))) {
				throw new Error("Invalid machine ID format. Expected UUID format.");
			}
		}

		// Note: We don't validate against API because Cursor uses complex protobuf.
		// Token will be validated when used for actual requests.

		return {
			accessToken,
			machineId: machineId || null,
			expiresIn: 86400, // Cursor tokens typically last 24 hours
			authMethod: machineId ? "imported" : "cursor-agent",
		};
	}

	/**
	 * Extract user info from token if possible
	 * Cursor tokens may contain encoded user info
	 */
	extractUserInfo(accessToken: string) {
		try {
			// Try to decode as JWT
			const parts = accessToken.split(".");
			if (parts.length === 3) {
				let payload = parts[1];
				while (payload.length % 4) {
					payload += "=";
				}
				const decoded = JSON.parse(
					Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
				);
				return {
					email: decoded.email || decoded.sub,
					userId: decoded.sub || decoded.user_id,
				};
			}
		} catch {
			// Token is not a JWT, that's okay
		}

		return null;
	}
}
