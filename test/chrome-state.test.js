/**
 * `formatUrl` is security-sensitive: everything it returns as `origin` is
 * shown at full trust in the address bar, so the tests here are mostly about
 * what it refuses to call an origin.
 */
import { describe, it, expect } from "vitest";
import { createState, formatUrl, nextActiveAfterClose, orderToolbarItems } from "../browser/chrome/state.js";

describe("formatUrl", () => {
    it("splits an https URL into origin and rest", () => {
        const result = formatUrl("https://example.com/path?q=1#frag");
        expect(result.origin).toBe("https://example.com");
        expect(result.rest).toBe("/path?q=1#frag");
        expect(result.secure).toBe(true);
        expect(result.punycodeWarning).toBe(false);
    });

    it("flags http as insecure", () => {
        const result = formatUrl("http://example.com/");
        expect(result.origin).toBe("http://example.com");
        expect(result.secure).toBe(false);
    });

    it("handles about:blank without throwing", () => {
        const result = formatUrl("about:blank");
        expect(result.origin).toBe("about:blank");
        expect(result.rest).toBe("");
        expect(result.secure).toBe(false);
    });

    it("handles a bare data: URL without throwing, and never claims a host", () => {
        const result = formatUrl("data:text/html,<h1>hi</h1>");
        expect(result.origin).toBe("data:");
        expect(result.rest).toContain("<h1>hi</h1>");
        expect(result.secure).toBe(false);
    });

    it("handles a file: URL without throwing", () => {
        const result = formatUrl("file:///Users/x/y.html");
        expect(result.origin).toBe("file://");
        expect(result.rest).toBe("/Users/x/y.html");
    });

    it("handles a malformed string without throwing", () => {
        expect(() => formatUrl("not a url at all")).not.toThrow();
        const result = formatUrl("not a url at all");
        expect(result.origin).toBe("");
        expect(result.rest).toBe("not a url at all");
        expect(result.secure).toBe(false);
    });

    it("handles empty, non-string and whitespace input without throwing", () => {
        expect(() => formatUrl("")).not.toThrow();
        expect(() => formatUrl(undefined)).not.toThrow();
        expect(() => formatUrl(null)).not.toThrow();
        expect(formatUrl(undefined).origin).toBe("");
    });

    it("never lets a path segment that looks like a domain become the origin", () => {
        const result = formatUrl("https://safe.test/https://evil.test/");
        expect(result.origin).toBe("https://safe.test");
        expect(result.rest).toBe("/https://evil.test/");
        expect(result.origin).not.toContain("evil.test");
    });

    it("flags an IDN homograph host and shows only its raw punycode form", () => {
        // Cyrillic а (U+0430) in place of Latin a.
        const result = formatUrl("https://аpple.com/account");
        expect(result.punycodeWarning).toBe(true);
        expect(result.origin.startsWith("https://xn--")).toBe(true);
        // The Unicode lookalike must never appear anywhere in what gets shown.
        expect(result.origin).not.toContain("а");
        expect(result.display).not.toContain("а");
    });

    it("does not flag an ordinary ASCII host", () => {
        expect(formatUrl("https://apple.com/").punycodeWarning).toBe(false);
    });
});

describe("nextActiveAfterClose", () => {
    const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }];

    it("prefers the right-hand neighbour", () => {
        expect(nextActiveAfterClose(tabs, "a", "a")).toBe("b");
    });

    it("falls back to the left neighbour when closing the last tab", () => {
        expect(nextActiveAfterClose(tabs, "c", "c")).toBe("b");
    });

    it("returns null when the last remaining tab is closed", () => {
        expect(nextActiveAfterClose([{ id: "solo" }], "solo", "solo")).toBeNull();
    });

    it("leaves the active id alone when a background tab closes", () => {
        expect(nextActiveAfterClose(tabs, "b", "a")).toBe("a");
    });

    it("is a no-op if the closed id is not in the list", () => {
        expect(nextActiveAfterClose(tabs, "ghost", "a")).toBe("a");
    });
});

describe("orderToolbarItems", () => {
    it("orders by declared position", () => {
        const items = [{ id: "z", position: 2 }, { id: "a", position: 1 }];
        expect(orderToolbarItems(items).map((i) => i.id)).toEqual(["a", "z"]);
    });

    it("places items without a position after those with one", () => {
        const items = [{ id: "no-position" }, { id: "positioned", position: 0 }];
        expect(orderToolbarItems(items).map((i) => i.id)).toEqual(["positioned", "no-position"]);
    });

    it("is stable: equal positions keep insertion order", () => {
        const items = [
            { id: "first", position: 1 },
            { id: "second", position: 1 },
            { id: "third", position: 1 }
        ];
        expect(orderToolbarItems(items).map((i) => i.id)).toEqual(["first", "second", "third"]);
    });

    it("is stable for items with no position at all", () => {
        const items = [{ id: "first" }, { id: "second" }, { id: "third" }];
        expect(orderToolbarItems(items).map((i) => i.id)).toEqual(["first", "second", "third"]);
    });

    it("does not mutate its input", () => {
        const items = [{ id: "b", position: 2 }, { id: "a", position: 1 }];
        const copy = items.map((i) => ({ ...i }));
        orderToolbarItems(items);
        expect(items).toEqual(copy);
    });
});

describe("createState", () => {
    it("starts from documented defaults, overridable by the caller", () => {
        const state = createState({ activeId: "x" });
        expect(state.get().tabs).toEqual([]);
        expect(state.get().activeId).toBe("x");
    });

    it("applies events immutably and notifies subscribers", () => {
        const state = createState();
        const seen = [];
        state.subscribe((s) => seen.push(s));

        const before = state.get();
        state.apply({ type: "tabs", tabs: [{ id: "1" }], activeId: "1" });

        expect(state.get()).not.toBe(before);
        expect(state.get().tabs).toEqual([{ id: "1" }]);
        expect(seen).toHaveLength(1);
    });

    it("unsubscribe stops further notifications", () => {
        const state = createState();
        let calls = 0;
        const unsubscribe = state.subscribe(() => (calls += 1));
        unsubscribe();
        state.apply({ type: "activate", id: "x" });
        expect(calls).toBe(0);
    });

    it("closing the active tab hands focus to a neighbour via the same rule as nextActiveAfterClose", () => {
        const state = createState({ tabs: [{ id: "a" }, { id: "b" }], activeId: "a" });
        state.apply({ type: "tab-closed", id: "a" });
        expect(state.get().activeId).toBe("b");
        expect(state.get().tabs.map((t) => t.id)).toEqual(["b"]);
    });

    it("ignores an unknown event type rather than throwing", () => {
        const state = createState();
        expect(() => state.apply({ type: "not-a-real-event" })).not.toThrow();
    });
});
