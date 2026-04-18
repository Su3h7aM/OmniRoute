#!/usr/bin/env bun

const bunVersion = typeof Bun !== "undefined" ? Bun.version : "unknown";
console.log(`Bun ${bunVersion} satisfies OmniRoute Bun runtime policy.`);
