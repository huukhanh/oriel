/**
 * The `oriel` object a skin's JavaScript receives, built natively.
 *
 * The same surface exists as generated source in core/wrapper.js, for the
 * `userScripts` world where nothing can be handed in. Keep the two in step —
 * `API_SURFACE` in that file is the list both are checked against, and the
 * failure mode when they drift is a skin that works on one browser and throws
 * on another.
 *
 * @module content/oriel-api
 */

import { PAGE } from "../shared/protocol.js";
import { applyOps } from "../core/domops.js";

/**
 * @param {object} spec
 * @param {import("../shared/protocol.js").AppliedSkin} spec.skin
 * @param {(type: string, payload: object) => Promise<any>} spec.send
 * @param {(text: string) => {remove(): void}} spec.addSheet
 */
export function createOrielApi({ skin, send, addSheet }) {
    const cleanups = [];
    const observers = [];
    const sheets = [];
    const listeners = new Map();

    const log = (level, message) => {
        if (message === undefined) {
            message = level;
            level = "info";
        }
        send(PAGE.LOG, { skinId: skin.id, level, message: format(message) }).catch(() => {});
    };

    const api = {
        id: skin.id,
        name: skin.name,
        vars: Object.freeze({ ...skin.vars }),

        log,

        css(text) {
            const handle = addSheet(text);
            sheets.push(handle);
            return handle;
        },

        dom(ops) {
            const result = applyOps(ops, { document, vars: skin.vars, log: (m) => log("warn", m) });
            cleanups.push(() => result.undo());
            return result;
        },

        /**
         * The thing every skin needs and every skin gets wrong. One observer,
         * disconnected on cleanup, and each node handed over exactly once even
         * though the page will re-add it under a different parent twice a
         * second.
         */
        watch(selector, fn) {
            const seen = new WeakSet();
            const sweep = () => {
                for (const node of document.querySelectorAll(selector)) {
                    if (seen.has(node)) continue;
                    seen.add(node);
                    try {
                        fn(node);
                    } catch (error) {
                        log("error", error);
                    }
                }
            };
            sweep();
            const observer = new MutationObserver(sweep);
            observer.observe(document.documentElement, { childList: true, subtree: true });
            observers.push(observer);
            return { stop: () => observer.disconnect(), refresh: sweep };
        },

        on(event, fn) {
            if (event === "cleanup") {
                cleanups.push(fn);
                return;
            }
            const list = listeners.get(event) ?? [];
            list.push(fn);
            listeners.set(event, list);
        },

        storage: {
            get: (key) => send(PAGE.STORAGE, { skinId: skin.id, op: "get", key }).then((r) => r?.value),
            set: (key, value) => send(PAGE.STORAGE, { skinId: skin.id, op: "set", key, value }).then(() => true),
            remove: (key) => send(PAGE.STORAGE, { skinId: skin.id, op: "delete", key }).then(() => true),
            keys: () => send(PAGE.STORAGE, { skinId: skin.id, op: "keys" }).then((r) => r?.value ?? [])
        },

        /** Cross-origin, without the page's cookies. See PAGE.FETCH in background/main.js. */
        fetch: (url, init) => send(PAGE.FETCH, { skinId: skin.id, url, init }),

        asset: (name) => skin.assets?.[name],

        open: (url, active) => send(PAGE.OPEN, { url, active })
    };

    /** Fired by the engine, not by skins. */
    function emit(event, detail) {
        for (const fn of listeners.get(event) ?? []) {
            try {
                fn(detail);
            } catch (error) {
                log("error", error);
            }
        }
    }

    function destroy() {
        emit("cleanup");
        for (const observer of observers) observer.disconnect();
        for (const sheet of sheets) sheet.remove?.();
        for (const fn of cleanups.reverse()) {
            try {
                fn();
            } catch (error) {
                log("error", error);
            }
        }
        cleanups.length = 0;
        observers.length = 0;
        sheets.length = 0;
        listeners.clear();
    }

    return { api, emit, destroy };
}

function format(value) {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
