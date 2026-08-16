/**
 * What this browser will actually let Oriel do.
 *
 * The awkward truth this module exists to handle: a skin's JavaScript is code
 * the extension obtained at run time, and every browser restricts that
 * differently. Chromium blocks `eval` and `new Function` inside content
 * scripts outright — measured, not assumed — leaving the `userScripts` API as
 * the only route, and that API is hidden until the user flips a per-extension
 * switch. Other engines apply no such CSP to content scripts and the classic
 * `new Function` route works.
 *
 * So Oriel probes instead of guessing, and shows the result in Settings. The
 * alternative is a user whose skin silently does half of what it should, with
 * nothing anywhere to explain why.
 *
 * @module background/caps
 */

import { api, has, call, detectEngine, storage } from "../shared/api.js";
import { KEY } from "../shared/protocol.js";

/** @type {import("../shared/protocol.js").Caps|null} */
let cached = null;

/**
 * `new Function` cannot be probed from here — the background context has its
 * own CSP, and the answer that matters is the content script's. The content
 * script measures it on first contact and reports it; until then we assume the
 * pessimistic answer, so nothing claims to work before it has been seen to.
 */
let contentFunctionConstructor = null;

/** Called by the message handler with what the content script measured. */
export function reportContentProbe(probe) {
    if (typeof probe?.functionConstructor === "boolean" && probe.functionConstructor !== contentFunctionConstructor) {
        contentFunctionConstructor = probe.functionConstructor;
        cached = null;
    }
}

/** @returns {Promise<import("../shared/protocol.js").Caps>} */
export async function caps() {
    if (cached) return cached;

    const userScriptsApi = typeof api.userScripts !== "undefined";
    let userScriptsPermitted = false;
    if (userScriptsApi) {
        // Presence is not permission. On Chromium the namespace exists but
        // every call throws until the user enables it for this extension, and
        // the only reliable test is to make a harmless call.
        try {
            await call(api.userScripts, "getScripts", {});
            userScriptsPermitted = true;
        } catch {
            userScriptsPermitted = false;
        }
    }

    const functionConstructor = contentFunctionConstructor === true;

    cached = {
        js: userScriptsPermitted ? "userScripts" : functionConstructor ? "function" : "none",
        userScriptsApi,
        userScriptsPermitted,
        functionConstructor,
        // MAIN-world injection bypasses the *extension's* CSP but not the
        // page's, so it is a fallback for main-world skins rather than a
        // general answer.
        mainWorld: has("scripting", "executeScript") && Boolean(api.scripting?.ExecutionWorld?.MAIN),
        insertCss: has("scripting", "insertCSS"),
        webNavigation: has("webNavigation", "onCommitted"),
        registerContentScripts: has("scripting", "registerContentScripts"),
        engine: detectEngine(),
        probedAt: Date.now()
    };

    await storage.set({ [KEY.CAPS]: cached });
    return cached;
}

export function invalidate() {
    cached = null;
}

/**
 * Ask for the optional `userScripts` permission. Must be called from a user
 * gesture in a UI page. On Chromium granting the permission is still not
 * enough — the user has to enable "Allow user scripts" on the extension's own
 * page — so the caller has to be ready to explain that.
 */
export async function requestUserScripts() {
    if (!has("permissions", "request")) return caps();
    try {
        await call(api.permissions, "request", { permissions: ["userScripts"] });
    } catch {
        // A refusal is an answer, not an error.
    }
    invalidate();
    return caps();
}

/**
 * One sentence per capability, for the Settings panel. Written for someone who
 * has just watched their skin do nothing and wants to know whose fault it is.
 */
export function explain(c) {
    const lines = [];
    if (c.js === "userScripts") {
        lines.push({ level: "ok", text: "Skin JavaScript runs in a dedicated user-script world." });
    } else if (c.js === "function") {
        lines.push({ level: "ok", text: "Skin JavaScript runs in this extension's isolated world." });
    } else if (c.userScriptsApi && !c.userScriptsPermitted) {
        lines.push({
            level: "warn",
            text: "Skin JavaScript is off. This browser needs the user-scripts permission — turn it on below."
        });
    } else {
        lines.push({
            level: "warn",
            text: "This browser does not let extensions run code they downloaded, so skin JavaScript is suspended. CSS and layout changes still work."
        });
    }
    lines.push({
        level: c.insertCss ? "ok" : "info",
        text: c.insertCss
            ? "Stylesheets are injected by the browser, so pages cannot strip them."
            : "Stylesheets are injected into the page, which a hostile page could undo."
    });
    lines.push({
        level: "info",
        text: c.webNavigation
            ? "Single-page route changes are reported by the browser, so skins swap over immediately."
            : "Single-page route changes are noticed by polling, so a skin may take a moment to swap over."
    });
    return lines;
}
