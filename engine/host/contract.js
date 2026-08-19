/**
 * The seam between the skin engine and whatever is running it.
 *
 * The engine knows how to turn a skin into changes. A **Host** knows how to
 * make those changes happen: it owns storage, the network, the tabs, the
 * browser's own interface and the device. Three hosts exist — the browser, a
 * WebExtension kept for testing, and an in-process host for unit tests — and
 * the engine is written against this file rather than against any of them.
 *
 * The reason to draw the line here rather than anywhere else: the browser host
 * is Swift, and there is no Swift toolchain in this project's development loop.
 * Every decision on the JavaScript side of this seam is testable in Node; every
 * decision on the other side is not. So the Swift should be a transport and
 * nothing more, and this contract is what keeps it honest.
 *
 * Pure: no browser globals, no I/O.
 *
 * @module engine/host/contract
 */

/**
 * Every capability a host may offer, as dotted names.
 *
 * Names are the stable thing. Method sets are not — a host is allowed to grow
 * methods, and a skin that feature-detects one instead of asking `can()` will
 * break the first time a signature changes. Adding a name here is a format
 * change; removing one is a breaking change.
 */
export const CAPABILITIES = Object.freeze([
    // The document. Every host has these; they are what a skin is for.
    "page.css",
    "page.dom",
    "page.js",
    "page.evaluate.main",
    "page.navigation",
    "page.snapshot",
    "page.readability",

    // The browser's tabs.
    "tabs.list",
    "tabs.open",
    "tabs.close",
    "tabs.move",
    "tabs.group",
    "tabs.events",

    // The browser's own interface. The reason Oriel is a browser.
    "chrome.css",
    "chrome.dom",
    "chrome.theme",
    "chrome.toolbar",
    "chrome.menu",
    "chrome.gesture",
    "chrome.newTab",
    "chrome.visibility",

    // Requests.
    "net.rules",
    "net.intercept",
    "net.synthesize",

    // The device.
    "native.share",
    "native.clipboard",
    "native.haptic",
    "native.download",
    "native.notify",
    "native.lock",
    "native.safeArea",

    // Always present.
    "storage",
    "bus",
    "exports"
]);

const CAPABILITY_SET = new Set(CAPABILITIES);

/**
 * How a capability is granted, from docs/BROWSER-API.md §5.
 *
 * `free` needs nothing beyond installing. `declared` is listed in the manifest
 * and shown at install as a group. `prompted` is asked for at first use and is
 * revocable. The banding is by prefix so a new capability inherits the right
 * treatment instead of defaulting to the permissive one.
 */
const BANDS = [
    [/^native\./, "prompted"],
    [/^net\.synthesize$/, "prompted"],
    [/^net\./, "declared"],
    [/^tabs\./, "declared"],
    [/^chrome\./, "declared"],
    [/^page\./, "free"],
    [/^(storage|bus|exports)$/, "free"]
];

/** @returns {"free"|"declared"|"prompted"} */
export function bandOf(capability) {
    for (const [pattern, band] of BANDS) if (pattern.test(capability)) return band;
    // An unknown capability is treated as the most restricted thing it could
    // be. Failing open here would let a typo become a silent grant.
    return "prompted";
}

/** The declared permissions a skin needs, given the capabilities it uses. */
export function permissionsFor(capabilities) {
    const needed = new Set();
    for (const capability of capabilities) {
        if (bandOf(capability) === "free") continue;
        // Declared permissions are named by namespace — a skin asks for `tabs`,
        // not for each of the six things it might do with them. `native` is the
        // exception: those are prompted individually, because "read your
        // clipboard" and "make the phone buzz" are not the same question.
        needed.add(capability.startsWith("native.") ? capability : capability.split(".")[0]);
    }
    return [...needed].sort();
}

export class HostCapabilityError extends Error {
    constructor(capability, hostName) {
        super(`This host (${hostName}) cannot do "${capability}".`);
        this.name = "HostCapabilityError";
        this.capability = capability;
        this.host = hostName;
    }
}

/**
 * Validate and freeze a host implementation.
 *
 * A host declares what it can do and provides the methods to do it. The two are
 * checked against each other here, at construction, because the alternative is
 * a capability that reads as available and throws `undefined is not a function`
 * somewhere inside a stranger's skin.
 *
 * @param {object} spec
 * @param {string} spec.name          "apple" | "extension" | "test"
 * @param {string} spec.version
 * @param {string[]} spec.capabilities
 * @param {Record<string, object>} spec.namespaces  e.g. { page: {…}, tabs: {…} }
 */
export function defineHost(spec) {
    const problems = [];
    const name = spec?.name;
    if (!name) problems.push("a host needs a name");

    const capabilities = [...new Set(spec?.capabilities ?? [])];
    for (const capability of capabilities) {
        if (!CAPABILITY_SET.has(capability)) problems.push(`unknown capability "${capability}"`);
    }

    const namespaces = spec?.namespaces ?? {};
    for (const capability of capabilities) {
        const [namespace] = capability.split(".");
        if (!namespaces[namespace]) {
            problems.push(`declares "${capability}" but provides no "${namespace}" namespace`);
        }
    }

    if (problems.length) {
        throw new Error(`Invalid host "${name ?? "?"}": ${problems.join("; ")}`);
    }

    const declared = new Set(capabilities);
    return Object.freeze({
        name,
        version: spec.version ?? "0",
        capabilities: Object.freeze(capabilities.sort()),
        namespaces: Object.freeze(namespaces),
        can: (capability) => declared.has(capability),
        require(capability) {
            if (!declared.has(capability)) throw new HostCapabilityError(capability, name);
        }
    });
}

/**
 * The `oriel` namespaces to expose for a host, with anything it cannot do left
 * off entirely.
 *
 * Absent rather than stubbed, deliberately. A stub that rejects turns a
 * capability question into a runtime error inside skin code that had no way to
 * ask; a missing namespace is something `can()` and `typeof` both answer
 * honestly.
 */
export function exposeFor(host, { onDenied } = {}) {
    const exposed = {};
    for (const capability of host.capabilities) {
        const [namespace] = capability.split(".");
        if (!exposed[namespace]) exposed[namespace] = host.namespaces[namespace];
    }
    return Object.freeze({
        ...exposed,
        can: (capability) => {
            const allowed = host.can(capability);
            if (!allowed && onDenied) onDenied(capability);
            return allowed;
        }
    });
}

/** Capability sets the three hosts are expected to offer. Asserted in tests. */
export const HOST_PROFILES = Object.freeze({
    apple: Object.freeze([...CAPABILITIES]),
    extension: Object.freeze([
        "page.css",
        "page.dom",
        "page.js",
        "page.navigation",
        "tabs.list",
        "tabs.open",
        "tabs.close",
        "tabs.events",
        "net.rules",
        "storage",
        "bus",
        "exports"
    ]),
    test: Object.freeze([...CAPABILITIES])
});
