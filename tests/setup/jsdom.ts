import { afterEach } from "bun:test";
import { cleanup } from "@testing-library/react";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});

const win = dom.window as unknown as Window & typeof globalThis;

globalThis.window = win as typeof globalThis.window;
globalThis.document = win.document;
globalThis.navigator = win.navigator;
globalThis.HTMLElement = win.HTMLElement;
globalThis.Element = win.Element;
globalThis.Node = win.Node;
globalThis.Text = win.Text;
globalThis.Event = win.Event;
globalThis.EventTarget = win.EventTarget;
globalThis.CustomEvent = win.CustomEvent;
globalThis.DOMParser = win.DOMParser;
globalThis.getComputedStyle = win.getComputedStyle.bind(win);
globalThis.MutationObserver = win.MutationObserver;
globalThis.customElements = win.customElements;
globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
  setTimeout(() => callback(Date.now()), 16) as unknown as number;
globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);

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

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
});
