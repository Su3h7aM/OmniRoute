import { afterEach, jest } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import * as ReactTestUtils from "react-dom/test-utils";
import { cleanup } from "@testing-library/react";
import { createRequire } from "node:module";

const BunResponse = globalThis.Response;
const BunReadableStream = globalThis.ReadableStream;
const BunTransformStream = globalThis.TransformStream;
const BunTextEncoderStream = globalThis.TextEncoderStream;
const BunTextDecoderStream = globalThis.TextDecoderStream;
const BunHeaders = globalThis.Headers;
const BunRequest = globalThis.Request;
const BunAbortController = globalThis.AbortController;
const BunAbortSignal = globalThis.AbortSignal;
const Bunfetch = globalThis.fetch;

const require = createRequire(import.meta.url);
const reactCjs = require("react");

if (typeof reactCjs.act !== "function" && typeof ReactTestUtils.act === "function") {
	reactCjs.act = ReactTestUtils.act;
}

GlobalRegistrator.register({
	url: "http://localhost",
	html: "<!DOCTYPE html><html><head></head><body></body></html>",
});

if (!globalThis.requestAnimationFrame) {
	globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
		setTimeout(() => callback(Date.now()), 16) as unknown as number;
}

if (!globalThis.cancelAnimationFrame) {
	globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

if (!globalThis.matchMedia) {
	globalThis.matchMedia = ((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener() {},
		removeListener() {},
		addEventListener() {},
		removeEventListener() {},
		dispatchEvent() {
			return false;
		},
	})) as typeof globalThis.matchMedia;
}

if (!globalThis.ResizeObserver) {
	globalThis.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as typeof globalThis.ResizeObserver;
}

try {
	Object.defineProperty(Document.prototype, "compatMode", {
		configurable: true,
		get() {
			return "CSS1Compat";
		},
	});
} catch {
	// Best effort for libraries like KaTeX that warn on quirks mode.
}

Object.assign(globalThis, {
	IS_REACT_ACT_ENVIRONMENT: true,
});

Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: jest.fn().mockImplementation((query) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: jest.fn(),
		removeListener: jest.fn(),
		addEventListener: jest.fn(),
		removeEventListener: jest.fn(),
		dispatchEvent: jest.fn(),
	})),
});

if (BunResponse) globalThis.Response = BunResponse;
if (BunReadableStream) globalThis.ReadableStream = BunReadableStream;
if (BunTransformStream) globalThis.TransformStream = BunTransformStream;
if (BunTextEncoderStream) globalThis.TextEncoderStream = BunTextEncoderStream;
if (BunTextDecoderStream) globalThis.TextDecoderStream = BunTextDecoderStream;
if (BunHeaders) globalThis.Headers = BunHeaders;
if (BunRequest) globalThis.Request = BunRequest;
if (BunAbortController) globalThis.AbortController = BunAbortController;
if (BunAbortSignal) globalThis.AbortSignal = BunAbortSignal;
if (Bunfetch) globalThis.fetch = Bunfetch;

afterEach(() => {
	cleanup();
	document.body.innerHTML = "";
});
