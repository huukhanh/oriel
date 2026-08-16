/**
 * Each render function is a pure function from data to a DOM node, so a
 * fresh jsdom document per test exercises the document-passing contract
 * exactly the way the real chrome document and a Swift-driven WKWebView
 * would use it.
 */
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import {
    renderTabStrip,
    renderAddressBar,
    renderToolbar,
    renderProgress,
    renderChrome
} from "../browser/chrome/views.js";

function makeDocument() {
    return new JSDOM("<!doctype html><html><body></body></html>").window.document;
}

const XSS_TITLE = "<img src=x onerror=alert(1)>";

function tab(overrides = {}) {
    return { id: "t1", url: "https://example.com/", title: "Example", ...overrides };
}

describe("renderTabStrip", () => {
    it("renders one tab per fixture entry, with the active tab distinct", () => {
        const tabs = [tab({ id: "a", title: "First" }), tab({ id: "b", title: "Second" })];
        const node = renderTabStrip({ tabs, activeId: "b" }, makeDocument());

        const rendered = [...node.querySelectorAll('[data-chrome="tab"]')];
        expect(rendered).toHaveLength(2);

        const active = rendered.find((el) => el.dataset.tabId === "b");
        const inactive = rendered.find((el) => el.dataset.tabId === "a");
        expect(active.classList.contains("is-active")).toBe(true);
        expect(active.getAttribute("aria-selected")).toBe("true");
        expect(inactive.classList.contains("is-active")).toBe(false);
        expect(inactive.getAttribute("aria-selected")).toBe("false");
    });

    it("shows a tab count", () => {
        const tabs = [tab({ id: "a" }), tab({ id: "b" }), tab({ id: "c" })];
        const node = renderTabStrip({ tabs, activeId: "a" }, makeDocument());
        expect(node.querySelector('[data-chrome="tab-count"]').textContent).toBe("3");
    });

    it("shows an overflow affordance once there are many tabs", () => {
        const doc = makeDocument();
        const few = Array.from({ length: 3 }, (_, i) => tab({ id: `t${i}` }));
        const many = Array.from({ length: 10 }, (_, i) => tab({ id: `t${i}` }));

        expect(renderTabStrip({ tabs: few, activeId: "t0" }, doc).querySelector('[data-chrome="tab-overflow"]')).toBeNull();
        expect(renderTabStrip({ tabs: many, activeId: "t0" }, doc).querySelector('[data-chrome="tab-overflow"]')).not.toBeNull();
    });

    it("calls onSelect and onClose with the tab id, and a close does not also select", () => {
        const doc = makeDocument();
        let selected = null;
        let closed = null;
        const node = renderTabStrip(
            { tabs: [tab({ id: "a" })], activeId: "a", onSelect: (id) => (selected = id), onClose: (id) => (closed = id) },
            doc
        );
        node.querySelector('[data-chrome="tab-close"]').dispatchEvent(new doc.defaultView.Event("click", { bubbles: true }));
        expect(closed).toBe("a");
        expect(selected).toBeNull();

        node.querySelector('[data-chrome="tab"]').dispatchEvent(new doc.defaultView.Event("click", { bubbles: true }));
        expect(selected).toBe("a");
    });

    it("calls onNew from the + button", () => {
        const doc = makeDocument();
        let called = false;
        const node = renderTabStrip({ tabs: [], activeId: null, onNew: () => (called = true) }, doc);
        node.querySelector('[data-chrome="new-tab"]').dispatchEvent(new doc.defaultView.Event("click", { bubbles: true }));
        expect(called).toBe(true);
    });

    it("never lets a page's own title become markup", () => {
        const doc = makeDocument();
        const node = renderTabStrip({ tabs: [tab({ id: "x", title: XSS_TITLE })], activeId: "x" }, doc);
        const title = node.querySelector('[data-chrome="tab-title"]');
        expect(title.textContent).toBe(XSS_TITLE);
        expect(title.querySelector("img")).toBeNull();
        expect(node.querySelectorAll("img")).toHaveLength(0);
    });

    it("keeps the close button present regardless of title length", () => {
        const doc = makeDocument();
        const longTitle = "A very long page title that would overflow a phone-width tab many times over ".repeat(5);
        const node = renderTabStrip({ tabs: [tab({ id: "x", title: longTitle })], activeId: "x" }, doc);
        const tabEl = node.querySelector('[data-chrome="tab"]');
        const title = tabEl.querySelector('[data-chrome="tab-title"]');
        const close = tabEl.querySelector('[data-chrome="tab-close"]');
        expect(title.textContent).toBe(longTitle);
        expect(close).not.toBeNull();
        // The close button is a fixed-size sibling, not nested inside the
        // (growable) title — truncation is a CSS concern on `.chrome-tab-title`,
        // structurally the two can never compete for the same box.
        expect(close.parentElement).toBe(tabEl);
        expect(title.parentElement).toBe(tabEl);
    });
});

describe("renderAddressBar", () => {
    it("shows the origin and rest separately for a realistic URL", () => {
        const node = renderAddressBar({ url: "https://example.com/a/b?x=1", secure: true }, makeDocument());
        expect(node.querySelector('[data-chrome="address-origin"]').textContent).toBe("https://example.com");
        expect(node.querySelector('[data-chrome="address-rest"]').textContent).toBe("/a/b?x=1");
    });

    it("shows a lock for https and a warning for http", () => {
        const doc = makeDocument();
        const secure = renderAddressBar({ url: "https://example.com/", secure: true }, doc);
        expect(secure.classList.contains("is-secure")).toBe(true);
        expect(secure.querySelector('[data-chrome="address-lock"] svg')).not.toBeNull();

        const insecure = renderAddressBar({ url: "http://example.com/", secure: false }, doc);
        expect(insecure.classList.contains("is-insecure")).toBe(true);
        expect(insecure.querySelector('[data-chrome="address-lock"] svg')).not.toBeNull();
    });

    it("shows the full URL and an editable field once focused/editing", () => {
        const node = renderAddressBar({ url: "https://example.com/path", editing: true }, makeDocument());
        const input = node.querySelector('[data-chrome="address-input"]');
        expect(input).not.toBeNull();
        expect(input.value).toBe("https://example.com/path");
        expect(node.querySelector('[data-chrome="address-field"]')).toBeNull();
    });

    it("tapping the field (not editing) calls onFocus", () => {
        const doc = makeDocument();
        let focused = false;
        const node = renderAddressBar({ url: "https://example.com/", onFocus: () => (focused = true) }, doc);
        node.querySelector('[data-chrome="address-field"]').dispatchEvent(new doc.defaultView.Event("click", { bubbles: true }));
        expect(focused).toBe(true);
    });

    it("submitting the editable field calls onSubmit with the typed value", () => {
        const doc = makeDocument();
        let submitted = null;
        const node = renderAddressBar({ url: "https://example.com/", editing: true, onSubmit: (v) => (submitted = v) }, doc);
        const input = node.querySelector('[data-chrome="address-input"]');
        input.value = "https://other.example/";
        node.querySelector("form").dispatchEvent(new doc.defaultView.Event("submit", { bubbles: true, cancelable: true }));
        expect(submitted).toBe("https://other.example/");
    });

    it("the reload button swaps to stop while loading, and calls the right handler", () => {
        const doc = makeDocument();
        let stopped = false;
        let reloaded = false;
        const loading = renderAddressBar(
            { url: "https://example.com/", loading: true, onStop: () => (stopped = true), onReload: () => (reloaded = true) },
            doc
        );
        expect(loading.querySelector('[data-chrome="address-reload"]').getAttribute("aria-label")).toMatch(/stop/i);
        loading.querySelector('[data-chrome="address-reload"]').dispatchEvent(new doc.defaultView.Event("click", { bubbles: true }));
        expect(stopped).toBe(true);
        expect(reloaded).toBe(false);

        const idle = renderAddressBar(
            { url: "https://example.com/", loading: false, onStop: () => (stopped = true), onReload: () => (reloaded = true) },
            doc
        );
        expect(idle.querySelector('[data-chrome="address-reload"]').getAttribute("aria-label")).toMatch(/reload/i);
        idle.querySelector('[data-chrome="address-reload"]').dispatchEvent(new doc.defaultView.Event("click", { bubbles: true }));
        expect(reloaded).toBe(true);
    });

    it("flags a punycode/IDN homograph host distinctly", () => {
        const doc = makeDocument();
        const spoofed = renderAddressBar({ url: "https://аpple.com/", secure: true }, doc);
        expect(spoofed.querySelector('[data-chrome="address-punycode-warning"]')).not.toBeNull();

        const normal = renderAddressBar({ url: "https://apple.com/", secure: true }, doc);
        expect(normal.querySelector('[data-chrome="address-punycode-warning"]')).toBeNull();
    });

    it("never renders a page-controlled URL as markup", () => {
        const doc = makeDocument();
        const node = renderAddressBar({ url: `https://example.com/${XSS_TITLE}` }, doc);
        expect(node.querySelectorAll("img")).toHaveLength(0);
    });
});

describe("renderProgress", () => {
    it("is idle when there is no progress value", () => {
        const node = renderProgress({ progress: null }, makeDocument());
        expect(node.classList.contains("is-idle")).toBe(true);
    });

    it("reflects a determinate value while loading", () => {
        const node = renderProgress({ progress: 0.4 }, makeDocument());
        expect(node.classList.contains("is-active")).toBe(true);
        expect(node.getAttribute("aria-valuenow")).toBe("40");
    });
});

describe("renderToolbar", () => {
    it("renders back/forward disabled states visibly, not just non-functionally", () => {
        const doc = makeDocument();
        const node = renderToolbar({ canGoBack: false, canGoForward: true, tabCount: 1, items: [] }, doc);
        const back = node.querySelector('[data-chrome="back"]');
        const forward = node.querySelector('[data-chrome="forward"]');
        expect(back.disabled).toBe(true);
        expect(back.getAttribute("aria-disabled")).toBe("true");
        expect(forward.disabled).toBe(false);
    });

    it("a disabled back button does not fire onAction", () => {
        const doc = makeDocument();
        let action = null;
        const node = renderToolbar({ canGoBack: false, canGoForward: false, tabCount: 1, items: [], onAction: (a) => (action = a) }, doc);
        node.querySelector('[data-chrome="back"]').dispatchEvent(new doc.defaultView.Event("click", { bubbles: true }));
        expect(action).toBeNull();
    });

    it("routes share/tabs/menu clicks through onAction", () => {
        const doc = makeDocument();
        const seen = [];
        const node = renderToolbar(
            { canGoBack: true, canGoForward: true, tabCount: 4, items: [], onAction: (a) => seen.push(a) },
            doc
        );
        for (const name of ["back", "forward", "share", "tabs-button", "menu"]) {
            node.querySelector(`[data-chrome="${name}"]`).dispatchEvent(new doc.defaultView.Event("click", { bubbles: true }));
        }
        expect(seen).toEqual(["back", "forward", "share", "tabs", "menu"]);
    });

    it("shows the tab count", () => {
        const node = renderToolbar({ canGoBack: true, canGoForward: true, tabCount: 7, items: [] }, makeDocument());
        expect(node.querySelector('[data-chrome="tabs-button"]').textContent).toContain("7");
    });

    it("orders toolbar items stably by declared position", () => {
        const doc = makeDocument();
        const items = [
            { id: "z", title: "Z", position: 2 },
            { id: "a", title: "A", position: 1 },
            { id: "no-pos-first", title: "N1" },
            { id: "no-pos-second", title: "N2" }
        ];
        const node = renderToolbar({ canGoBack: true, canGoForward: true, tabCount: 1, items }, doc);
        const ids = [...node.querySelectorAll('[data-chrome="toolbar-item"]')].map((el) => el.dataset.itemId);
        expect(ids).toEqual(["a", "z", "no-pos-first", "no-pos-second"]);
    });

    it("calls onAction with a skin item's id when tapped", () => {
        const doc = makeDocument();
        let action = null;
        const node = renderToolbar(
            { canGoBack: true, canGoForward: true, tabCount: 1, items: [{ id: "reader-mode", title: "Reader" }], onAction: (a) => (action = a) },
            doc
        );
        node.querySelector('[data-chrome="toolbar-item"]').dispatchEvent(new doc.defaultView.Event("click", { bubbles: true }));
        expect(action).toBe("reader-mode");
    });

    it("never renders a skin's item title as markup", () => {
        const doc = makeDocument();
        const node = renderToolbar(
            { canGoBack: true, canGoForward: true, tabCount: 1, items: [{ id: "x", title: XSS_TITLE, icon: XSS_TITLE }] },
            doc
        );
        expect(node.querySelectorAll("img")).toHaveLength(0);
    });
});

describe("renderChrome", () => {
    it("composes without throwing on completely empty state", () => {
        expect(() => renderChrome({}, {}, makeDocument())).not.toThrow();
    });

    it("composes without throwing when handlers are omitted", () => {
        const state = { tabs: [tab()], activeId: "t1", address: { url: "https://example.com/" }, loading: true, progress: 0.5 };
        expect(() => renderChrome(state, undefined, makeDocument())).not.toThrow();
    });

    it("includes one instance of each region, wired to the same state", () => {
        const doc = makeDocument();
        const state = {
            tabs: [tab({ id: "a" }), tab({ id: "b" })],
            activeId: "b",
            address: { url: "https://example.com/", secure: true },
            loading: false,
            canGoBack: true,
            canGoForward: false,
            toolbarItems: []
        };
        const node = renderChrome(state, {}, doc);
        expect(node.querySelectorAll('[data-chrome="tab-strip"]')).toHaveLength(1);
        expect(node.querySelectorAll('[data-chrome="address-bar"]')).toHaveLength(1);
        expect(node.querySelectorAll('[data-chrome="toolbar"]')).toHaveLength(1);
        expect(node.querySelectorAll('[data-chrome="progress"]')).toHaveLength(1);
        expect(node.querySelectorAll('[data-chrome="tab"]')).toHaveLength(2);
        expect(node.querySelector('[data-chrome="back"]').disabled).toBe(false);
        expect(node.querySelector('[data-chrome="forward"]').disabled).toBe(true);
    });
});
