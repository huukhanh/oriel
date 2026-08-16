/**
 * A host that performs nothing and records everything.
 *
 * The browser host is Swift and cannot be run here, so this is what the engine
 * is tested against: every call a skin makes lands in `calls`, and a test
 * asserts on that. It implements the full capability set on purpose — the point
 * is to exercise the engine's whole surface, not to model a restricted host.
 * For that, `defineHost` with a narrower capability list is the tool.
 *
 * @module engine/host/test-host
 */

import { defineHost, HOST_PROFILES } from "./contract.js";

/**
 * @param {object} [options]
 * @param {string[]} [options.capabilities]  Narrow the host, to test degradation.
 * @param {Record<string, any>} [options.responses]  Canned return values, by "namespace.method".
 */
export function createTestHost(options = {}) {
    const calls = [];
    const responses = options.responses ?? {};
    const storage = new Map();
    const listeners = new Map();

    const record = (method, args) => {
        calls.push({ method, args });
        return Object.hasOwn(responses, method) ? responses[method] : undefined;
    };

    /** Wrap a plain object so every method is recorded without writing it out N times. */
    const recorded = (namespace, methods) =>
        Object.fromEntries(
            methods.map((method) => [
                method,
                async (...args) => record(`${namespace}.${method}`, args)
            ])
        );

    const emit = (channel, data) => {
        for (const fn of listeners.get(channel) ?? []) fn(data);
    };

    const namespaces = {
        page: {
            ...recorded("page", [
                "reload",
                "stop",
                "back",
                "forward",
                "zoom",
                "evaluate",
                "snapshot",
                "readability",
                "find"
            ])
        },
        tabs: {
            ...recorded("tabs", ["list", "current", "open", "close", "activate", "move", "pin", "group"]),
            onChanged(fn) {
                record("tabs.onChanged", []);
                const list = listeners.get("tabs") ?? [];
                list.push(fn);
                listeners.set("tabs", list);
                return { stop: () => listeners.set("tabs", (listeners.get("tabs") ?? []).filter((f) => f !== fn)) };
            }
        },
        chrome: {
            ...recorded("chrome", ["css", "dom", "theme", "hide", "show"]),
            toolbar: recorded("chrome.toolbar", ["add", "remove"]),
            addressBar: recorded("chrome.addressBar", ["set"]),
            menu: recorded("chrome.menu", ["add", "remove"]),
            newTab: recorded("chrome.newTab", ["set"]),
            gesture: {
                on(name, fn) {
                    record("chrome.gesture.on", [name]);
                    const list = listeners.get(`gesture:${name}`) ?? [];
                    list.push(fn);
                    listeners.set(`gesture:${name}`, list);
                    return { stop: () => listeners.delete(`gesture:${name}`) };
                }
            }
        },
        net: {
            ...recorded("net", ["rules"]),
            on(filter, fn) {
                record("net.on", [filter]);
                const list = listeners.get("net") ?? [];
                list.push(fn);
                listeners.set("net", list);
                return { stop: () => listeners.set("net", []) };
            }
        },
        native: recorded("native", ["share", "download", "notify", "lock", "safeArea", "haptic"]),
        storage: {
            async get(key) {
                record("storage.get", [key]);
                return key === undefined ? Object.fromEntries(storage) : storage.get(key);
            },
            async set(key, value) {
                record("storage.set", [key, value]);
                storage.set(key, value);
                return true;
            },
            async remove(key) {
                record("storage.remove", [key]);
                storage.delete(key);
                return true;
            },
            async keys() {
                record("storage.keys", []);
                return [...storage.keys()];
            }
        },
        bus: {
            emit(channel, data) {
                record("bus.emit", [channel, data]);
                emit(`bus:${channel}`, data);
            },
            on(channel, fn) {
                record("bus.on", [channel]);
                const list = listeners.get(`bus:${channel}`) ?? [];
                list.push(fn);
                listeners.set(`bus:${channel}`, list);
                return { stop: () => listeners.set(`bus:${channel}`, []) };
            }
        },
        exports: recorded("exports", ["publish", "lookup"])
    };

    // `native.clipboard` is nested, and the recorder above only does one level.
    namespaces.native.clipboard = recorded("native.clipboard", ["read", "write"]);

    const host = defineHost({
        name: "test",
        version: "1",
        capabilities: options.capabilities ?? [...HOST_PROFILES.test],
        namespaces
    });

    return {
        host,
        calls,
        /** Every call to one method, for a focused assertion. */
        callsTo: (method) => calls.filter((call) => call.method === method),
        /** Drive a listener the engine registered, as the real host would. */
        fire: (channel, data) => emit(channel, data),
        storage,
        reset: () => {
            calls.length = 0;
            storage.clear();
            listeners.clear();
        }
    };
}
