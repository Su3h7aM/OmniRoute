import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const distDir = process.env.NEXT_DIST_DIR || ".next";

/** @type {import('next').NextConfig} */
const nextConfig = {
	distDir,
	output: "standalone",
	outputFileTracingExcludes: {
		// Planning/task docs are not runtime assets and can break standalone copies
		// when broad fs/path tracing pulls the whole repository into the NFT graph.
		"/*": [
			"./.git/**/*",
			"./_tasks/**/*",
			"./_references/**/*",
			"./_ideia/**/*",
			"./_mono_repo/**/*",
			"./coverage/**/*",
			"./test-results/**/*",
			"./playwright-report/**/*",
			"./app.__qa_backup/**/*",
			"./tests/**/*",
			"./next.config.*",
		],
	},
	serverExternalPackages: [
		"pino",
		"pino-pretty",
		"thread-stream",
		"better-sqlite3",
		"keytar",
		"wreq-js",
		"zod",
		"child_process",
		"fs",
		"path",
		"os",
		"crypto",
		"net",
		"tls",
		"http",
		"https",
		"stream",
		"buffer",
		"util",
	],
	transpilePackages: ["@omniroute/open-sse"],
	allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.*"],
	typescript: {
		// TODO: Re-enable after fixing all sub-component useTranslations scope issues
		ignoreBuildErrors: true,
	},
	images: {
		unoptimized: true,
	},

	async rewrites() {
		return [
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
			{
				source: "/v1/v1/:path*",
				destination: "/api/v1/:path*",
			},
			{
				source: "/v1/v1",
				destination: "/api/v1",
			},
			{
				source: "/codex/:path*",
				destination: "/api/v1/responses",
			},
			{
				source: "/v1/:path*",
				destination: "/api/v1/:path*",
			},
			{
				source: "/v1",
				destination: "/api/v1",
			},
		];
	},
};

export default withNextIntl(nextConfig);
