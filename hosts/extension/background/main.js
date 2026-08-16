/**
 * The background worker: one message router and nothing else.
 *
 * Every handler is self-contained — it reads what it needs from storage,
 * answers, and keeps no state that could not be rebuilt. That is not tidiness,
 * it is a requirement: Safari evicts this context whenever it likes, and any
 * design that assumes it stays alive between two messages fails on a phone in
 * a way that is almost impossible to reproduce on a desktop.
 *
 * @module background/main
 */

import { api, has, call } from "../shared/api.js";
import { PAGE, UI, EVENT } from "../shared/protocol.js";
import * as store from "./store.js";
import * as apply from "./apply.js";
import * as caps from "./caps.js";
import * as install from "./install.js";
import * as updates from "./updates.js";
import { syncUserScripts } from "./userscripts.js";
import { summarize, exportSkin } from "../../../engine/core/skin.js";
import { stringifyUserCss } from "../../../engine/core/usercss.js";

const handlers = {
    // --- page ---------------------------------------------------------------

    async [PAGE.HELLO](payload, sender) {
        caps.reportContentProbe(payload.probe);
        const [{ revision, skins }, capabilities, settings] = await Promise.all([
            apply.skinsForUrl(payload.url, { topFrame: sender?.frameId === 0 || payload.top }),
            caps.caps(),
            store.readSettings()
        ]);
        return { revision, skins, caps: capabilities, settings };
    },

    async [PAGE.NAVIGATED](payload, sender) {
        return apply.skinsForUrl(payload.url, { topFrame: sender?.frameId === 0 || payload.top });
    },

    async [PAGE.INSERT_CSS](payload, sender) {
        const done = await apply.insertCss(sender?.tab?.id, sender?.frameId, payload.css);
        return { ok: done };
    },

    async [PAGE.REMOVE_CSS](payload, sender) {
        const done = await apply.removeCss(sender?.tab?.id, sender?.frameId, payload.css);
        return { ok: done };
    },

    async [PAGE.LOG](payload, sender) {
        store.log({
            skinId: payload.skinId,
            level: payload.level ?? "info",
            message: String(payload.message ?? "").slice(0, 2000),
            url: sender?.tab?.url ?? sender?.url
        });
        return { ok: true };
    },

    async [PAGE.STORAGE](payload) {
        const value = await store.skinStorage(payload.skinId, payload.op, payload.key, payload.value);
        return { ok: true, value };
    },

    /**
     * A skin's JS cannot fetch cross-origin from the page; the background can,
     * because the extension holds the host permission. The skin does not get to
     * choose the credentials mode — sending the user's cookies to a third party
     * on a skin's say-so is exactly the hole this indirection exists to close.
     */
    async [PAGE.FETCH](payload) {
        try {
            const response = await fetch(payload.url, {
                method: payload.init?.method ?? "GET",
                headers: payload.init?.headers,
                body: payload.init?.body,
                credentials: "omit",
                redirect: "follow"
            });
            const text = await response.text();
            return { ok: true, status: response.status, text: text.slice(0, 1024 * 1024) };
        } catch (error) {
            return { ok: false, error: error.message };
        }
    },

    async [PAGE.OPEN](payload) {
        if (!has("tabs", "create")) return { ok: false };
        await call(api.tabs, "create", { url: payload.url, active: payload.active !== false });
        return { ok: true };
    },

    // --- ui -----------------------------------------------------------------

    async [UI.LIST]() {
        const [index, settings, capabilities] = await Promise.all([
            store.readIndex(),
            store.readSettings(),
            caps.caps()
        ]);
        // The index carries compiled targeting the UI has no use for; strip it
        // so a hundred skins do not cross the message boundary as a megabyte.
        const skins = index.map(({ rules, ...summary }) => summary);
        return { skins, settings, caps: capabilities };
    },

    async [UI.GET](payload) {
        const installed = await store.readSkin(payload.id);
        if (!installed) return { installed: null };
        const source = exportSkin(installed, stringifyUserCss);
        return { installed, summary: summarize(installed), source: source.text, filename: source.filename };
    },

    async [UI.IMPORT_TEXT](payload) {
        const reply = await install.importFromText(payload.text, { name: payload.name, match: payload.match });
        if (reply.ok) await changed("install", reply.summary?.id);
        return reply;
    },

    async [UI.IMPORT_URL](payload) {
        const reply = await install.importFromLocator(payload.locator);
        if (reply.ok) await changed("install", reply.summary?.id);
        return reply;
    },

    async [UI.PREVIEW_URL](payload) {
        const { resolveLocator } = await import("../../../engine/core/source.js");
        const resolved = resolveLocator(payload.locator);
        return {
            ok: resolved.candidates.length > 0,
            kind: resolved.kind,
            describe: resolved.describe,
            candidates: resolved.candidates.slice(0, 5)
        };
    },

    async [UI.SAVE_SOURCE](payload) {
        const reply = await install.saveSource(payload.id, payload.source);
        if (reply.ok) await changed("edit", payload.id);
        return reply;
    },

    async [UI.SET_ENABLED](payload) {
        const ok = await store.setEnabled(payload.id, payload.enabled);
        if (ok) await changed("enable", payload.id);
        return { ok };
    },

    /**
     * Var changes go straight to open tabs. Re-injecting the whole skin would
     * lose scroll position and any state its script holds; sending the values
     * lets the content script update the `:root` block in place.
     */
    async [UI.SET_VALUES](payload) {
        await store.setValues(payload.id, payload.values);
        apply.bumpRevision();
        await apply.broadcast({ type: EVENT.VALUES, id: payload.id, values: payload.values });
        return { ok: true };
    },

    async [UI.REMOVE](payload) {
        await store.removeSkin(payload.id);
        await changed("remove", payload.id);
        return { ok: true };
    },

    async [UI.REORDER](payload) {
        await store.reorder(payload.ids);
        await changed("reorder");
        return { ok: true };
    },

    async [UI.CHECK_UPDATES](payload) {
        return { results: await updates.checkUpdates(payload?.ids) };
    },

    async [UI.APPLY_UPDATE](payload) {
        const reply = await updates.applyUpdate(payload.id);
        if (reply.ok) await changed("update", payload.id);
        return reply;
    },

    async [UI.EXPORT](payload) {
        const installed = await store.readSkin(payload.id);
        if (!installed) return { ok: false };
        return { ok: true, ...exportSkin(installed, stringifyUserCss) };
    },

    async [UI.FOR_SITE](payload) {
        const index = await store.readIndex();
        const { matchesTargets } = await import("../../../engine/core/target.js");
        const skinnable = apply.isSkinnable(payload.url);
        const matches = [];
        const others = [];
        for (const { rules, ...summary } of index) {
            (skinnable && matchesTargets(rules, payload.url) ? matches : others).push(summary);
        }
        return { matches, others, skinnable };
    },

    async [UI.SETTINGS](payload) {
        const settings = payload?.patch ? await store.writeSettings(payload.patch) : await store.readSettings();
        if (payload?.patch) await changed("settings");
        return { settings };
    },

    async [UI.LOG_READ](payload) {
        return { entries: await store.readLog(payload ?? {}) };
    },

    async [UI.LOG_CLEAR](payload) {
        await store.clearLog(payload?.skinId);
        return { ok: true };
    },

    async [UI.CAPS]() {
        return { caps: await caps.caps() };
    },

    async [UI.REQUEST_USER_SCRIPTS]() {
        const capabilities = await caps.requestUserScripts();
        await syncUserScripts(capabilities);
        return { caps: capabilities };
    },

    async [UI.DEV_WATCH](payload) {
        const settings = await store.writeSettings({ devServer: payload.url ?? "" });
        return { settings };
    }
};

/** One place that knows what has to happen after the skin set changes. */
async function changed(reason, id) {
    apply.bumpRevision();
    store.invalidate();
    await syncUserScripts(await caps.caps());
    await apply.broadcast({ type: EVENT.CHANGED, reason, id });
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handler = handlers[message?.type];
    if (!handler) return false;

    handler(message, sender).then(
        (reply) => sendResponse(reply ?? { ok: true }),
        (error) => sendResponse({ ok: false, error: String(error?.message ?? error) })
    );
    // Keeping the channel open for an async reply. Without this the sender gets
    // `undefined` and every await in the UI resolves to nothing.
    return true;
});

apply.watchNavigation();

// A UI page opening is the only scheduling signal we can rely on everywhere.
api.runtime.onInstalled?.addListener(() => {
    caps.caps().then((c) => syncUserScripts(c));
});

api.runtime.onStartup?.addListener(() => {
    caps.caps().then((c) => syncUserScripts(c));
});

export { handlers };
