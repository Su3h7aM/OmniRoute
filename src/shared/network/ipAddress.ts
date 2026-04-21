function normalizeIpCandidate(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function isValidIpv4Part(part: string): boolean {
	if (!/^\d+$/.test(part)) return false;
	const numeric = Number(part);
	return Number.isInteger(numeric) && numeric >= 0 && numeric <= 255;
}

function isValidIpv4(value: string): boolean {
	const parts = value.split(".");
	if (parts.length !== 4) return false;
	return parts.every(isValidIpv4Part);
}

function isValidIpv6Segment(segment: string): boolean {
	if (segment.includes(".")) {
		return isValidIpv4(segment);
	}
	return /^[0-9a-fA-F]{1,4}$/.test(segment);
}

function isValidIpv6(value: string): boolean {
	if (!value.includes(":")) return false;
	if (value.includes(":::")) return false;

	const zoneIndex = value.indexOf("%");
	const address = zoneIndex === -1 ? value : value.slice(0, zoneIndex);
	if (!address) return false;

	const doubleColonCount = address.split("::").length - 1;
	if (doubleColonCount > 1) return false;

	const segments = address.split(":");
	let emptySegments = 0;
	for (const segment of segments) {
		if (segment === "") {
			emptySegments += 1;
			continue;
		}
		if (!isValidIpv6Segment(segment)) return false;
	}

	if (doubleColonCount === 0) {
		return emptySegments === 0 && segments.length >= 3 && segments.length <= 8;
	}

	return segments.length <= 8;
}

export function getIpVersion(value: string): 0 | 4 | 6 {
	const normalized = normalizeIpCandidate(value);
	if (!normalized) return 0;
	if (isValidIpv4(normalized)) return 4;
	if (isValidIpv6(normalized)) return 6;
	return 0;
}

export function isIpAddress(value: string): boolean {
	return getIpVersion(value) !== 0;
}
