import { describe, expect, it } from "bun:test";

import { getIpVersion, isIpAddress } from "../../src/shared/network/ipAddress";

describe("ipAddress", () => {
	it("detects IPv4 addresses", () => {
		expect(getIpVersion("127.0.0.1")).toBe(4);
		expect(getIpVersion("255.255.255.255")).toBe(4);
		expect(getIpVersion("256.0.0.1")).toBe(0);
	});

	it("detects IPv6 addresses", () => {
		expect(getIpVersion("::1")).toBe(6);
		expect(getIpVersion("2001:db8::1")).toBe(6);
		expect(getIpVersion("[2001:db8::1]")).toBe(6);
		expect(getIpVersion("2001:::1")).toBe(0);
	});

	it("reports whether a value is an IP address", () => {
		expect(isIpAddress("10.0.0.1")).toBe(true);
		expect(isIpAddress("localhost")).toBe(false);
	});
});
