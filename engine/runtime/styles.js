/**
 * Getting a skin's CSS onto the page, and off it again.
 *
 * Three mechanisms, in order of preference:
 *
 *   1. `scripting.insertCSS`, done by the background. The stylesheet belongs to
 *      the browser, not the document — a page cannot enumerate it, cannot
 *      delete it, and a framework that rewrites `<head>` on every render cannot
 *      lose it. This is what runs on Chromium.
 *   2. A **constructed stylesheet** adopted by the document. No DOM node, so
 *      nothing for a page to remove, and — the reason it is here — it is not
 *      subject to the page's `style-src`.
 *   3. A `<style>` element. Last resort, and a compromised one: see below.
 *
 * The ordering is a measurement, not a preference. On a page sending
 * `style-src 'self'`, a `<style>` element inserted by script is **blocked** —
 * verified in both WebKit and Chromium — while a constructed stylesheet
 * applies. Since a large share of the sites worth reskinning send exactly that
 * header, an implementation that only had mechanism 3 would look correct
 * everywhere in testing and fail on the real web.
 *
 * Removal matters as much as insertion. On a single-page app a skin whose rules
 * stop matching must come off cleanly, and `removeCSS` only works when handed
 * byte-identical text to what was inserted — hence the sheet text is kept.
 *
 * @module runtime/styles
 */

import { PAGE } from "../../hosts/extension/shared/protocol.js";

/**
 * Constructed stylesheets need `CSSStyleSheet` to be constructible and
 * `adoptedStyleSheets` to be assignable. Safari has both from 16.4, Chromium
 * from 73, Firefox from 101. jsdom has neither, which is why the element path
 * still has to exist and still has to be tested.
 */
function canAdopt(document) {
    try {
        if (typeof CSSStyleSheet !== "function") return false;
        if (typeof new CSSStyleSheet().replaceSync !== "function") return false;
        return Array.isArray(document.adoptedStyleSheets);
    } catch {
        return false;
    }
}

export function createStyleHost(send, document = globalThis.document) {
    /** @type {Map<string, {text: string, mode: "browser"|"adopted"|"element", element?: Element, sheet?: CSSStyleSheet}>} */
    const sheets = new Map();
    const adoptable = canAdopt(document);
    /**
     * Every constructed sheet this host has ever adopted, including ones just
     * dropped from `sheets`. Without it, `syncAdopted` reads a sheet it is in
     * the middle of removing as belonging to the page, and keeps it forever.
     */
    const owned = new Set();

    let guard = null;
    /** Built before the document had a root element to hold them. */
    const pendingRoot = [];
    let rootObserver = null;

    async function add(key, text) {
        if (!text) return;
        const existing = sheets.get(key);
        if (existing && existing.text === text) return;

        // A constructed sheet can be rewritten where it sits, which keeps the
        // document's sheet order stable while a variable slider is moving.
        if (existing?.mode === "adopted") {
            existing.sheet.replaceSync(text);
            existing.text = text;
            return;
        }
        if (existing) await remove(key);

        if (await tryBrowser(text)) {
            sheets.set(key, { text, mode: "browser" });
            return;
        }
        if (adoptable) {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(text);
            owned.add(sheet);
            sheets.set(key, { text, mode: "adopted", sheet });
            syncAdopted();
            return;
        }
        sheets.set(key, { text, mode: "element", element: injectElement(key, text) });
        ensureGuard();
    }

    async function remove(key) {
        const sheet = sheets.get(key);
        if (!sheet) return;
        sheets.delete(key);

        if (sheet.mode === "element") {
            sheet.element.remove();
            const queued = pendingRoot.indexOf(sheet.element);
            if (queued !== -1) pendingRoot.splice(queued, 1);
        } else if (sheet.mode === "adopted") {
            syncAdopted();
            owned.delete(sheet.sheet);
        } else {
            await send(PAGE.REMOVE_CSS, { css: sheet.text }).catch(() => {});
        }

        if (!anyElements()) stopGuard();
    }

    async function removeAll() {
        for (const key of [...sheets.keys()]) await remove(key);
    }

    async function tryBrowser(text) {
        try {
            const reply = await send(PAGE.INSERT_CSS, { css: text });
            return Boolean(reply?.ok);
        } catch {
            return false;
        }
    }

    /**
     * Rewrite the document's adopted list from ours plus whatever else is
     * there. Filtering by identity rather than replacing wholesale: the page
     * may adopt its own sheets, and a framework losing them because a skin
     * loaded is a bug nobody would attribute to us.
     */
    function syncAdopted() {
        const ours = [...sheets.values()].filter((s) => s.mode === "adopted").map((s) => s.sheet);
        // Filtered against everything this host has ever adopted, not just what
        // it still holds — otherwise a sheet being removed right now reads as
        // the page's and is kept forever.
        const theirs = document.adoptedStyleSheets.filter((sheet) => !owned.has(sheet));
        // Ours last, so a skin outranks the page's own adopted styles at equal
        // specificity — which is the whole point of installing one.
        document.adoptedStyleSheets = [...theirs, ...ours];
    }

    function injectElement(key, text) {
        const style = document.createElement("style");
        style.textContent = text;
        style.setAttribute("data-oriel", key);
        if (!attach(style)) waitForRoot(style);
        return style;
    }

    /**
     * `documentElement` rather than `head`: at document_start there may not be
     * a head yet, and a stylesheet that waits for one has already lost the race
     * it exists to win.
     */
    function attach(style) {
        const root = document.head ?? document.documentElement;
        if (!root) return false;
        root.appendChild(style);
        return true;
    }

    /**
     * Earlier still, there is no root element either — measured in WebKit,
     * where a script injected at the earliest possible moment sees
     * `document.documentElement === null`. A content script at document_start
     * is specified to run after the root exists, so this should never fire; it
     * is here because "should never" is doing a lot of work in a sentence about
     * an engine nobody on this project can test on the target device.
     *
     * `document` itself can be observed before it has any children, which is
     * the one thing that still works this early.
     */
    function waitForRoot(style) {
        pendingRoot.push(style);
        if (rootObserver) return;
        rootObserver = new MutationObserver(() => {
            if (!(document.head ?? document.documentElement)) return;
            for (const queued of pendingRoot.splice(0)) attach(queued);
            rootObserver.disconnect();
            rootObserver = null;
        });
        rootObserver.observe(document, { childList: true, subtree: true });
    }

    /**
     * Some sites replace the whole head after hydration. Only the element path
     * needs this — a browser-injected or adopted stylesheet is not in the DOM
     * for the page to lose.
     */
    function ensureGuard() {
        if (guard) return;
        guard = new MutationObserver(() => {
            for (const [key, sheet] of sheets) {
                if (sheet.mode === "element" && !sheet.element.isConnected) {
                    sheet.element = injectElement(key, sheet.text);
                }
            }
        });
        guard.observe(document.documentElement ?? document, { childList: true, subtree: true });
    }

    function stopGuard() {
        guard?.disconnect();
        guard = null;
        if (!sheets.size) {
            rootObserver?.disconnect();
            rootObserver = null;
            pendingRoot.length = 0;
        }
    }

    function anyElements() {
        for (const sheet of sheets.values()) if (sheet.mode === "element") return true;
        return false;
    }

    return {
        add,
        remove,
        removeAll,
        get size() {
            return sheets.size;
        },
        /** Which mechanism a given sheet took. Reported in the log, and asserted in tests. */
        modeOf(key) {
            return sheets.get(key)?.mode ?? null;
        }
    };
}
