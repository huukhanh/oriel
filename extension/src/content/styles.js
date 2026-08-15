/**
 * Getting a skin's CSS onto the page, and off it again.
 *
 * Two mechanisms, in order of preference:
 *
 *   1. `scripting.insertCSS` from the background. The stylesheet belongs to the
 *      browser, not the document — a page cannot enumerate it, cannot delete
 *      it, and a framework that rewrites `<head>` on every render cannot lose
 *      it. This is the right answer and it is what runs on Chromium.
 *   2. A `<style>` element we own. Used where the API is missing, and it has to
 *      defend itself: a page that clears `document.head` would otherwise take
 *      the skin with it, so the element is re-attached if it disappears.
 *
 * Removal matters as much as insertion. On a single-page app a skin whose rules
 * stop matching must come off cleanly, and `removeCSS` only works when handed
 * byte-identical text to what was inserted — hence the sheet text is kept.
 *
 * @module content/styles
 */

import { PAGE } from "../shared/protocol.js";

export function createStyleHost(send) {
    /** @type {Map<string, {text: string, element: Element|null, viaBrowser: boolean}>} */
    const sheets = new Map();
    let guard = null;

    async function add(key, text) {
        if (!text) return;
        const existing = sheets.get(key);
        if (existing && existing.text === text) return;
        if (existing) await remove(key);

        const viaBrowser = await tryBrowser(text);
        const element = viaBrowser ? null : injectElement(key, text);
        sheets.set(key, { text, element, viaBrowser });
        if (!viaBrowser) ensureGuard();
    }

    async function remove(key) {
        const sheet = sheets.get(key);
        if (!sheet) return;
        sheets.delete(key);
        if (sheet.element) sheet.element.remove();
        else await send(PAGE.REMOVE_CSS, { css: sheet.text }).catch(() => {});
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

    function injectElement(key, text) {
        const style = document.createElement("style");
        style.textContent = text;
        style.setAttribute("data-oriel", key);
        // `documentElement` rather than `head`: at document_start there may not
        // be a head yet, and a stylesheet that waits for one has already lost
        // the race it exists to win.
        (document.head ?? document.documentElement).appendChild(style);
        return style;
    }

    /**
     * Some sites replace the whole head after hydration. Watching for our own
     * elements going missing costs one observer for the rare case, and skipping
     * it produces a skin that works until the page finishes loading.
     */
    function ensureGuard() {
        if (guard) return;
        guard = new MutationObserver(() => {
            for (const [key, sheet] of sheets) {
                if (sheet.element && !sheet.element.isConnected) {
                    sheet.element = injectElement(key, sheet.text);
                }
            }
        });
        guard.observe(document.documentElement, { childList: true, subtree: true });
    }

    function stopGuard() {
        guard?.disconnect();
        guard = null;
    }

    function anyElements() {
        for (const sheet of sheets.values()) if (sheet.element) return true;
        return false;
    }

    return { add, remove, removeAll, get size() { return sheets.size; } };
}
