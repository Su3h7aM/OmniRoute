import { afterEach, test } from "bun:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = path.join(process.cwd(), "next.config.mjs");
const originalNextDistDir = process.env.NEXT_DIST_DIR;

async function loadNextConfig(label) {
	return import(`${pathToFileURL(modulePath).href}?case=${label}-${Date.now()}`);
}

afterEach(() => {
	if (originalNextDistDir === undefined) {
		delete process.env.NEXT_DIST_DIR;
	} else {
		process.env.NEXT_DIST_DIR = originalNextDistDir;
	}
});

test("next config exposes standalone build settings and canonical rewrites", async () => {
	process.env.NEXT_DIST_DIR = ".next-task607";
	const { default: nextConfig } = await loadNextConfig("distdir");

	const rewrites = await nextConfig.rewrites();

	assert.equal(nextConfig.distDir, ".next-task607");
	assert.equal(nextConfig.output, "standalone");
	assert.equal(nextConfig.images.unoptimized, true);
	assert.deepEqual(nextConfig.transpilePackages, ["@omniroute/open-sse"]);
	assert.equal(nextConfig.turbopack.resolveAlias["@/mitm/manager"], "./src/mitm/manager.stub.ts");
	assert.deepEqual(rewrites.slice(0, 4), [
		{
			source: "/chat/completions",
			destination: "/api/v1/chat/completions",
		},
		{
			source: "/responses",
			destination: "/api/v1/responses",
		},
		{
			source: "/responses/:path*",
			destination: "/api/v1/responses/:path*",
		},
		{
			source: "/models",
			destination: "/api/v1/models",
		},
	]);
});
