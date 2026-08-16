/**
 * Deciding what applies to a URL, and getting the CSS there early.
 *
 * The hot path runs on every page load in every frame, and the answer is
 * usually "nothing". So it is ordered cheapest-first: one cached index read,
 * then rule matching on summaries, and only then a storage read for the bodies
 * of whatever survived.
 *
 * @module background/apply
 */

import { api, call, has } from "../shared/api.js";
import { matchesTargets } from "../core/target.js";
import { resolveForPage } from "../core/skin.js";
import { readIndex, readSkins, readSettings } from "./store.js";

/**
 * Bumped whenever anything that could change what a page should show changes.
 * The content script keeps the last revision it applied and ignores a reply
 * that arrives out of order — two navigations in flight at once is normal on a
 * single-page app, and applying the older answer second is a real bug.
 */
let revision = 1;

export function bumpRevision() {
    revision += 1;
    return revision;
}

export function currentRevision() {
    return revision;
}

/**
 * @param {string} url
 * @param {{ topFrame?: boolean }} [options]
 * @returns {Promise<{revision: number, skins: import("../shared/protocol.js").AppliedSkin[]}>}
 */
export async function skinsForUrl(url, options = {}) {
    const settings = await readSettings();
    if (!settings.enabled) return { revision, skins: [] };
    if (!options.topFrame && !settings.allowFrames) return { revision, skins: [] };
    if (!isSkinnable(url)) return { revision, skins: [] };

    const index = await readIndex();
    const candidates = index.filter(
        (entry) => entry.enabled && (options.topFrame || entry.allFrames) && matchesTargets(entry.rules, url)
    );
    if (!candidates.length) return { revision, skins: [] };

    const bodies = await readSkins(candidates.map((entry) => entry.id));
    const skins = bodies
        .sort((a, b) => a.order - b.order)
        .map((installed) => resolveForPage(installed, url))
        .filter(Boolean);

    return { revision, skins };
}

/**
 * Pages Oriel refuses to touch. The browser would block most of these anyway,
 * but a skin that appears to install and then does nothing on `about:blank` is
 * a support question, and one that could run on another extension's pages is a
 * privilege-escalation bug.
 */
export function isSkinnable(url) {
    if (typeof url !== "string" || !url) return false;
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    const blocked = [
        "chrome:",
        "chrome-extension:",
        "moz-extension:",
        "safari-web-extension:",
        "edge:",
        "about:",
        "devtools:",
        "view-source:"
    ];
    if (blocked.includes(parsed.protocol)) return false;
    // The browser's own extension gallery. Every browser blocks script
    // injection there; failing early keeps the reason visible.
    if (/^(chrome\.google\.com|chromewebstore\.google\.com|addons\.mozilla\.org)$/.test(parsed.host)) return false;
    return true;
}

/**
 * Inject a resolved skin's CSS with the browser's own API, which puts it out of
 * reach of the page: a site cannot delete a stylesheet it cannot see. Falls
 * back to telling the content script to do it itself where the API is missing.
 *
 * @returns {Promise<boolean>} whether the browser did it
 */
export async function insertCss(tabId, frameId, css) {
    if (!has("scripting", "insertCSS") || tabId === undefined) return false;
    try {
        await call(api.scripting, "insertCSS", {
            target: { tabId, frameIds: frameId === undefined ? undefined : [frameId] },
            css,
            origin: "AUTHOR"
        });
        return true;
    } catch {
        return false;
    }
}

export async function removeCss(tabId, frameId, css) {
    if (!has("scripting", "removeCSS") || tabId === undefined) return false;
    try {
        await call(api.scripting, "removeCSS", {
            target: { tabId, frameIds: frameId === undefined ? undefined : [frameId] },
            css,
            origin: "AUTHOR"
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * Push CSS as the navigation commits, ahead of the content script's first
 * message. Worth a paint on a slow connection, and free where `webNavigation`
 * exists. Where it does not — Safari, as far as we can tell — the content
 * script path covers it and this never runs.
 */
/**
 * There used to be an early CSS push here, on `webNavigation.onCommitted`, to
 * beat the content script's first message by a paint. It is gone, and the
 * reason is worth keeping.
 *
 * `removeCSS` matches on the exact text that was inserted. The early push sent
 * one concatenated stylesheet and the content script sends one per sheet, so
 * nothing could ever remove what the early push had inserted — a skin came off
 * the page's attribute list on a single-page route change but stayed on the
 * page. Making the two paths agree would mean the background tracking what it
 * pushed per frame and reconciling it against what the content script did.
 *
 * That is real complexity for an optimisation that cannot help where it
 * matters: Safari, the platform this product is aimed at, has no
 * `webNavigation` at all, so the early push never ran there. It bought nothing
 * on the target and broke teardown everywhere else.
 */
export function watchNavigation() {
    if (!has("webNavigation", "onCommitted")) return false;

    // A single-page app changing route. The content script cannot see the
    // page's own `pushState` — separate worlds — so this is the fast path for
    // telling it, and its poll is the slow one. See content/main.js.
    if (has("webNavigation", "onHistoryStateUpdated")) {
        api.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
            if (!isSkinnable(details.url) || details.tabId === undefined) return;
            try {
                await call(api.tabs, "sendMessage", details.tabId, { type: "event.changed", reason: "navigate" });
            } catch {
                // No content script in that frame yet. The poll will catch up.
            }
        });
    }
    return true;
}

/**
 * Tell every open tab that something changed. Used when a var moves — the
 * whole appeal of the settings form is that a slider changes the page while you
 * are looking at it, and a reload would destroy that.
 */
export async function broadcast(message) {
    if (!has("tabs", "query")) return;
    let tabs = [];
    try {
        tabs = (await call(api.tabs, "query", {})) ?? [];
    } catch {
        return;
    }
    await Promise.all(
        tabs.map(async (tab) => {
            if (tab.id === undefined) return;
            try {
                await call(api.tabs, "sendMessage", tab.id, message);
            } catch {
                // No content script in that tab. Normal, and not worth a log line.
            }
        })
    );
}
