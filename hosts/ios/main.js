/**
 * The browser's in-page entry point.
 *
 * Swift installs this as a `WKUserScript` at document start, in the page's own
 * content world, on every frame of every navigation. From here everything is
 * JavaScript: the bridge to native, the Host built on it, and — once
 * `engine/runtime` is host-agnostic — the skin engine itself.
 *
 * There is deliberately no message protocol, no service worker and no
 * capability probe. Those existed in the extension because the engine was a
 * guest in someone else's runtime. Here it is not.
 *
 * @module hosts/ios/main
 */

import { createBridge, createIosHost } from "./bridge.js";
import { exposeFor } from "../../engine/host/contract.js";

/**
 * Swift calls into this object by name. It is the only global Oriel creates,
 * and it is non-enumerable so that a page walking `window` does not trip over
 * it — a page should not be able to tell trivially that it is being skinned.
 */
export const GLOBAL = "__oriel";

/**
 * Where Swift declares what it has actually implemented, in a user script
 * injected before this one.
 *
 * This seam has to exist. The native side builds namespaces incrementally, and
 * a capability list baked into JavaScript would claim things that are still a
 * `TODO(api:)` on the other side — exactly the failure the Host contract exists
 * to prevent.
 */
export const CAPABILITIES_GLOBAL = "__orielCapabilities";

/**
 * @param {object} [options]
 * @param {object} [options.scope]  Defaults to `globalThis`. Injectable for tests.
 * @param {object} [options.messageHandler]
 * @param {string[]} [options.capabilities]  Overrides what the native side declared.
 */
export function boot(options = {}) {
    const scope = options.scope ?? globalThis;

    // Re-entry is normal: Swift injects into every frame, and a page that
    // creates an iframe of itself gets this file twice in the same realm.
    if (scope[GLOBAL]) return scope[GLOBAL];

    const declared = options.capabilities ?? scope[CAPABILITIES_GLOBAL];
    const bridge = createBridge({ messageHandler: options.messageHandler, scope });
    // No list at all means an old or misconfigured shell. Trusting the full
    // profile there would have every namespace claim to work and then answer
    // `unsupported`, which is the worst of both — a skin cannot branch on it.
    const { host, dispatch } = createIosHost(bridge, Array.isArray(declared) ? declared : []);

    const api = {
        version: typeof __ORIEL_VERSION__ === "string" ? __ORIEL_VERSION__ : "dev",
        host,
        oriel: exposeFor(host),

        /** Swift pushes events in through here: tab changes, gestures, requests. */
        dispatch,

        /**
         * A round trip Swift can make at startup to prove the injection landed.
         * Cheap, and the difference between "the bridge is broken" and "the user
         * script never ran" is otherwise very hard to tell apart on a device.
         */
        ping: () => ({ ok: true, version: api.version, capabilities: host.capabilities })
    };

    Object.defineProperty(scope, GLOBAL, { value: Object.freeze(api), enumerable: false, configurable: false });
    return api;
}

// TODO(engine): start the skin engine here once `engine/runtime` takes a Host
// and a skin source rather than the extension's message protocol. Until then
// this file establishes the bridge and nothing more — which is honest, and lets
// the Swift shell be built and its bridge verified on a device independently of
// the engine work.

if (typeof globalThis !== "undefined" && globalThis.webkit?.messageHandlers) boot();
