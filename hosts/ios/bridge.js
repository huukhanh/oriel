/**
 * The JavaScript half of the browser's native bridge.
 *
 * Swift owns the tabs, the chrome and the device; this turns a call on the Host
 * contract into a message it can answer, and a reply back into a promise. It is
 * deliberately the *only* file that knows the wire format, because the other
 * end of that format is Swift — the one part of this project that nobody in the
 * development loop can compile, run or test.
 *
 * Two reply mechanisms are supported, and which one is live is decided at run
 * time rather than at build time. `WKScriptMessageHandlerWithReply` gives
 * `postMessage` a promise directly and is the better shape; the older handler
 * has no return channel at all, so Swift calls back into a global by id. Both
 * are real possibilities and the difference is not worth a coordination round
 * trip with a person who has a Mac.
 *
 * @module hosts/ios/bridge
 */

import { defineHost, HOST_PROFILES } from "../../engine/host/contract.js";

/** How long to wait for Swift before deciding it is not coming. */
const TIMEOUT_MS = 10_000;

/** The name Swift registers its message handler under. */
export const HANDLER = "oriel";

/** Where Swift delivers a reply when it has no return channel. */
export const REPLY_GLOBAL = "__orielReply";

/**
 * @param {object} [options]
 * @param {object} [options.messageHandler]  Defaults to `webkit.messageHandlers[HANDLER]`.
 * @param {object} [options.scope]           Where to hang the reply global. Defaults to `globalThis`.
 * @param {(ms: number, fn: Function) => any} [options.setTimer]
 */
export function createBridge(options = {}) {
    const handler =
        options.messageHandler ?? globalThis.webkit?.messageHandlers?.[HANDLER] ?? null;
    const scope = options.scope ?? globalThis;
    const setTimer = options.setTimer ?? ((ms, fn) => setTimeout(fn, ms));

    /** Outstanding calls, by id, for the callback path. */
    const pending = new Map();
    let nextId = 1;

    /**
     * Swift's way in when `postMessage` gave us nothing to await. Installed
     * unconditionally: it costs one property and removes a whole class of
     * "which mechanism did the Swift end up using" coordination.
     */
    scope[REPLY_GLOBAL] = (id, ok, value) => {
        const waiting = pending.get(id);
        if (!waiting) return false; // Late, or already timed out. Not an error.
        pending.delete(id);
        if (ok) waiting.resolve(value);
        else waiting.reject(toError(value));
        return true;
    };

    function send(namespace, method, args) {
        if (!handler) {
            return Promise.reject(new Error("Oriel's native bridge is not available on this page."));
        }

        const id = nextId++;
        const message = { id, namespace, method, args };

        let posted;
        try {
            posted = handler.postMessage(message);
        } catch (error) {
            return Promise.reject(error);
        }

        // The modern handler answers with a promise. Take it and skip the
        // bookkeeping entirely.
        if (posted && typeof posted.then === "function") {
            return posted.then(unwrap);
        }

        return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            setTimer(TIMEOUT_MS, () => {
                if (!pending.has(id)) return;
                pending.delete(id);
                // A browser whose UI silently stops responding is unfalsifiable
                // and unfixable from a bug report. Say which call died.
                reject(new Error(`The browser did not answer ${namespace}.${method}.`));
            });
        }).then(unwrap);
    }

    /**
     * Swift answers `{ ok, value }` or `{ ok: false, error, unsupported }`.
     * `unsupported` is distinct from a failure: it means the native side has
     * not implemented this yet, and the engine treats it as a missing
     * capability rather than a bug in the skin.
     */
    function unwrap(reply) {
        if (reply === undefined || reply === null) return undefined;
        if (typeof reply !== "object") return reply;
        if (reply.ok === false) throw toError(reply);
        return Object.hasOwn(reply, "value") ? reply.value : reply;
    }

    return {
        send,
        get available() {
            return Boolean(handler);
        },
        get pendingCount() {
            return pending.size;
        },
        /** Test seam: deliver a reply as Swift would. */
        deliver: (id, ok, value) => scope[REPLY_GLOBAL](id, ok, value)
    };
}

function toError(payload) {
    if (payload instanceof Error) return payload;
    const error = new Error(payload?.error ?? String(payload ?? "The browser reported a failure."));
    if (payload?.unsupported) {
        error.name = "HostUnsupportedError";
        error.unsupported = true;
    }
    return error;
}

/**
 * Namespaces whose methods are all plain request/response calls to Swift.
 * Listed rather than generated so that adding one is a visible change and a
 * typo in a method name cannot silently become a message Swift ignores.
 */
const FORWARDED = {
    page: ["reload", "stop", "back", "forward", "zoom", "evaluate", "snapshot", "readability", "find"],
    tabs: ["list", "current", "open", "close", "activate", "move", "pin", "group"],
    native: ["share", "download", "notify", "lock", "safeArea", "haptic"]
};

/**
 * Build the `ios` host on top of a bridge.
 *
 * `capabilities` comes from the native side rather than from this file: the
 * Swift implements the namespaces incrementally, and a capability list baked in
 * here would claim things that are still a `TODO(api:)` on the other side.
 *
 * @param {object} bridge  From {@link createBridge}.
 * @param {string[]} [capabilities]  What the native side reports it can do.
 */
export function createIosHost(bridge, capabilities = [...HOST_PROFILES.ios]) {
    const forward = (namespace, method) => (...args) => bridge.send(namespace, method, args);

    const namespaces = {};
    for (const [namespace, methods] of Object.entries(FORWARDED)) {
        namespaces[namespace] = Object.fromEntries(methods.map((m) => [m, forward(namespace, m)]));
    }

    // Nested, and so not covered by the flat loop above.
    namespaces.native.clipboard = {
        read: forward("native.clipboard", "read"),
        write: forward("native.clipboard", "write")
    };

    // Events come the other way: Swift pushes, and these hand out subscriptions.
    const subscribers = new Map();
    namespaces.tabs.onChanged = (fn) => subscribe("tabs", fn);

    namespaces.chrome = {
        css: forward("chrome", "css"),
        dom: forward("chrome", "dom"),
        theme: forward("chrome", "theme"),
        hide: forward("chrome", "hide"),
        show: forward("chrome", "show"),
        toolbar: { add: forward("chrome.toolbar", "add"), remove: forward("chrome.toolbar", "remove") },
        addressBar: { set: forward("chrome.addressBar", "set") },
        menu: { add: forward("chrome.menu", "add"), remove: forward("chrome.menu", "remove") },
        newTab: { set: forward("chrome.newTab", "set") },
        gesture: { on: (name, fn) => subscribe(`gesture:${name}`, fn) }
    };

    namespaces.net = {
        rules: forward("net", "rules"),
        on: (filter, fn) => {
            bridge.send("net", "watch", [filter]);
            return subscribe("net", fn);
        }
    };

    namespaces.storage = {
        get: forward("storage", "get"),
        set: forward("storage", "set"),
        remove: forward("storage", "remove"),
        keys: forward("storage", "keys")
    };

    namespaces.bus = {
        emit: forward("bus", "emit"),
        on: (channel, fn) => subscribe(`bus:${channel}`, fn)
    };

    namespaces.exports = {
        publish: forward("exports", "publish"),
        lookup: forward("exports", "lookup")
    };

    function subscribe(channel, fn) {
        const list = subscribers.get(channel) ?? [];
        list.push(fn);
        subscribers.set(channel, list);
        return {
            stop: () => subscribers.set(channel, (subscribers.get(channel) ?? []).filter((f) => f !== fn))
        };
    }

    /** Swift calls this to push an event. Exposed on the host, not on a global. */
    function dispatch(channel, data) {
        for (const fn of subscribers.get(channel) ?? []) {
            try {
                fn(data);
            } catch {
                // A skin's listener throwing must not stop the others, and must
                // never propagate back across the bridge into Swift.
            }
        }
    }

    const host = defineHost({
        name: "ios",
        version: "1",
        // Only declare what there is a namespace for; the contract enforces the
        // rest. A native side that reports a capability it has not built yet
        // fails here, at startup, instead of inside someone's skin.
        capabilities: capabilities.filter((c) => namespaces[c.split(".")[0]]),
        namespaces
    });

    return { host, dispatch };
}
