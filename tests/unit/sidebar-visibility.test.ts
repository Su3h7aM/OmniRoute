import { test } from "bun:test";
import assert from "node:assert/strict";

const sidebarVisibility = await import("../../src/shared/constants/sidebarVisibility.ts");

test("system sidebar items place logs before health", () => {
	const systemSection = sidebarVisibility.SIDEBAR_SECTIONS.find(
		(section) => section.id === "system"
	);

	assert.ok(systemSection, "expected system sidebar section to exist");
	assert.deepEqual(
		systemSection.items.map((item) => item.id),
		["logs", "health", "audit", "settings"]
	);
});

test("primary sidebar keeps the core routing pages", () => {
	const primarySection = sidebarVisibility.SIDEBAR_SECTIONS.find(
		(section) => section.id === "primary"
	);

	assert.ok(primarySection, "expected primary sidebar section to exist");
	assert.deepEqual(
		primarySection.items.map((item) => item.id),
		["home", "endpoints", "api-manager", "providers", "combos"]
	);
});

test("operations sidebar groups costs, analytics, cache, and limits", () => {
	const operationsSection = sidebarVisibility.SIDEBAR_SECTIONS.find(
		(section) => section.id === "operations"
	);

	assert.ok(operationsSection, "expected operations sidebar section to exist");
	assert.deepEqual(
		operationsSection.items.map((item) => item.id),
		["costs", "analytics", "cache", "limits"]
	);
});

test("capabilities sidebar includes media, memory, and skills", () => {
	const capabilitiesSection = sidebarVisibility.SIDEBAR_SECTIONS.find(
		(section) => section.id === "capabilities"
	);

	assert.ok(capabilitiesSection, "expected capabilities sidebar section to exist");
	assert.deepEqual(
		capabilitiesSection.items.map((item) => item.id),
		["media", "memory", "skills"]
	);
});
