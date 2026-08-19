import { describe, it, expect, vi } from "vitest";
import { createBridge, createAppleHost, HANDLER, REPLY_GLOBAL } from "../hosts/apple/bridge.js";
import { HostCapabilityError } from "../engine/host/contract.js";

/**
 * The other end of this bridge is Swift, which nobody here can compile or run.
 * So the contract it has to satisfy is pinned from this side: the exact message
 * shape, both reply mechanisms, what a timeout looks like, and the difference
 * between "that failed" and "the native side has not built that yet".
 *
 * If the Swift and these tests disagree, one of them is wrong and this file is
 * the cheaper one to check.
 */

/** A message handler with no return channel — the older WKScriptMessageHandler. */
function callbackHandler() {
    const sent = [];
    return { sent, postMessage: (message) => void sent.push(message) };
}

/** A message handler that answers with a promise — WKScriptMessageHandlerWithReply. */
function replyingHandler(respond) {
    const sent = [];
    return {
        sent,
        postMessage: (message) => {
            sent.push(message);
            return Promise.resolve(respond(message));
        }
    };
}

const scope = () => ({});

describe("the wire format", () => {
    it("sends id, namespace, method and args, and nothing else", async () => {
        const handler = callbackHandler();
        const bridge = createBridge({ messageHandler: handler, scope: scope() });
        bridge.send("tabs", "open", ["https://example.com", { background: true }]);

        expect(handler.sent).toHaveLength(1);
        expect(Object.keys(handler.sent[0]).sort()).toEqual(["args", "id", "method", "namespace"]);
        expect(handler.sent[0]).toMatchObject({
            namespace: "tabs",
            method: "open",
            args: ["https://example.com", { background: true }]
        });
    });

    it("gives every call a distinct id", () => {
        const handler = callbackHandler();
        const bridge = createBridge({ messageHandler: handler, scope: scope() });
        bridge.send("page", "reload", []);
        bridge.send("page", "back", []);
        expect(handler.sent[0].id).not.toBe(handler.sent[1].id);
    });
});

describe("the replying handler", () => {
    it("takes the promise and skips the bookkeeping", async () => {
        const handler = replyingHandler(() => ({ ok: true, value: [{ id: 1, url: "https://a.test/" }] }));
        const bridge = createBridge({ messageHandler: handler, scope: scope() });

        await expect(bridge.send("tabs", "list", [])).resolves.toEqual([{ id: 1, url: "https://a.test/" }]);
        expect(bridge.pendingCount).toBe(0);
    });

    it("turns a reported failure into a rejection", async () => {
        const handler = replyingHandler(() => ({ ok: false, error: "no such tab" }));
        const bridge = createBridge({ messageHandler: handler, scope: scope() });
        await expect(bridge.send("tabs", "close", [99])).rejects.toThrow("no such tab");
    });
});

describe("the callback handler", () => {
    it("resolves when Swift calls back by id", async () => {
        const handler = callbackHandler();
        const host = scope();
        const bridge = createBridge({ messageHandler: handler, scope: host });

        const promise = bridge.send("native", "safeArea", []);
        expect(bridge.pendingCount).toBe(1);

        // Exactly what Swift does: evaluateJavaScript("__orielReply(1, true, …)").
        host[REPLY_GLOBAL](handler.sent[0].id, true, { ok: true, value: { bottom: 34 } });

        await expect(promise).resolves.toEqual({ bottom: 34 });
        expect(bridge.pendingCount).toBe(0);
    });

    it("installs the reply global unconditionally", () => {
        // Which mechanism the Swift used is not knowable from here, and is not
        // worth a coordination round trip with someone who has a Mac.
        const host = scope();
        createBridge({ messageHandler: replyingHandler(() => ({})), scope: host });
        expect(typeof host[REPLY_GLOBAL]).toBe("function");
    });

    it("ignores a reply for a call that already finished", () => {
        const host = scope();
        const bridge = createBridge({ messageHandler: callbackHandler(), scope: host });
        expect(host[REPLY_GLOBAL](999, true, "late")).toBe(false);
        expect(bridge.pendingCount).toBe(0);
    });

    it("times out with a message naming the call", async () => {
        const timers = [];
        const bridge = createBridge({
            messageHandler: callbackHandler(),
            scope: scope(),
            setTimer: (ms, fn) => timers.push(fn)
        });

        const promise = bridge.send("tabs", "list", []);
        timers.forEach((fn) => fn());

        // A browser whose UI silently stops is unfalsifiable from a bug report.
        await expect(promise).rejects.toThrow("did not answer tabs.list");
        expect(bridge.pendingCount).toBe(0);
    });
});

describe("when there is no bridge at all", () => {
    it("rejects rather than throwing synchronously", async () => {
        const bridge = createBridge({ messageHandler: null, scope: scope() });
        expect(bridge.available).toBe(false);
        await expect(bridge.send("tabs", "list", [])).rejects.toThrow(/not available/);
    });

    it("finds the handler on webkit.messageHandlers by default", () => {
        const handler = callbackHandler();
        const previous = globalThis.webkit;
        globalThis.webkit = { messageHandlers: { [HANDLER]: handler } };
        try {
            expect(createBridge({ scope: scope() }).available).toBe(true);
        } finally {
            globalThis.webkit = previous;
        }
    });
});

describe("unsupported is not failure", () => {
    it("marks a not-yet-built native method so the engine can degrade", async () => {
        // Swift implements namespaces incrementally. A skin asking for
        // something still marked TODO should see a missing capability, not a
        // bug it will try to work around.
        const handler = replyingHandler(() => ({ ok: false, unsupported: true, error: "not implemented" }));
        const bridge = createBridge({ messageHandler: handler, scope: scope() });

        await expect(bridge.send("chrome", "theme", [{}])).rejects.toMatchObject({
            name: "HostUnsupportedError",
            unsupported: true
        });
    });
});

describe("the ios host", () => {
    function host(capabilities) {
        const handler = replyingHandler(() => ({ ok: true, value: "done" }));
        const bridge = createBridge({ messageHandler: handler, scope: scope() });
        return { ...createAppleHost(bridge, capabilities), handler };
    }

    it("forwards a namespaced call with its method name intact", async () => {
        const { host: h, handler } = host();
        await h.namespaces.tabs.open("https://a.test/");
        expect(handler.sent[0]).toMatchObject({ namespace: "tabs", method: "open", args: ["https://a.test/"] });
    });

    it("forwards a nested namespace under its dotted name", async () => {
        const { host: h, handler } = host();
        await h.namespaces.native.clipboard.write("hello");
        expect(handler.sent[0]).toMatchObject({ namespace: "native.clipboard", method: "write" });
    });

    it("offers the browser's own interface, which the extension host cannot", async () => {
        const { host: h, handler } = host();
        expect(h.can("chrome.toolbar")).toBe(true);
        await h.namespaces.chrome.toolbar.add({ id: "x", title: "X" });
        expect(handler.sent[0]).toMatchObject({ namespace: "chrome.toolbar", method: "add" });
    });

    it("declares only what the native side says it has built", () => {
        // The capability list comes from Swift, not from this file, so a
        // half-built namespace cannot claim to work.
        const { host: h } = host(["page.navigation", "tabs.list", "storage"]);
        expect(h.can("tabs.list")).toBe(true);
        expect(h.can("chrome.theme")).toBe(false);
        expect(() => h.require("chrome.theme")).toThrow(HostCapabilityError);
    });

    it("delivers a pushed event to every subscriber", () => {
        const { host: h, dispatch } = host();
        const seen = [];
        h.namespaces.tabs.onChanged((e) => seen.push(e));
        h.namespaces.tabs.onChanged((e) => seen.push(e));
        dispatch("tabs", { kind: "activated", id: 2 });
        expect(seen).toHaveLength(2);
    });

    it("stops delivering after a subscription is stopped", () => {
        const { host: h, dispatch } = host();
        const seen = [];
        const subscription = h.namespaces.tabs.onChanged((e) => seen.push(e));
        subscription.stop();
        dispatch("tabs", { kind: "closed", id: 1 });
        expect(seen).toEqual([]);
    });

    it("does not let one skin's listener stop another's, or reach Swift", () => {
        const { host: h, dispatch } = host();
        const seen = [];
        h.namespaces.tabs.onChanged(() => {
            throw new Error("a skin threw");
        });
        h.namespaces.tabs.onChanged((e) => seen.push(e));
        expect(() => dispatch("tabs", { kind: "created" })).not.toThrow();
        expect(seen).toHaveLength(1);
    });

    it("tells Swift what to watch before handing back a request subscription", () => {
        const { host: h, handler } = host();
        h.namespaces.net.on({ urls: ["*://ads.test/*"] }, () => {});
        expect(handler.sent[0]).toMatchObject({ namespace: "net", method: "watch" });
    });
});
