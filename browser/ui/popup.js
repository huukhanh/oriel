/**
 * The toolbar popup. It answers one question — what is affecting this page? —
 * and it has about a second to do it, so it asks for exactly two things and
 * renders whatever arrives.
 *
 * @module ui/popup
 */

import { createRpc } from "./rpc.js";
import { renderPopup, renderEmpty } from "./views.js";
import { clear } from "./dom.js";
import { UI, EVENT, DEFAULT_SETTINGS } from "../../hosts/extension/shared/protocol.js";

const api = globalThis.chrome || globalThis.browser || {};
const rpc = createRpc(api.runtime || { sendMessage: () => Promise.reject(new Error("No extension runtime")) });

const state = {
    url: "",
    matches: [],
    others: [],
    caps: {},
    settings: { ...DEFAULT_SETTINGS }
};

function root() {
    return document.getElementById("app");
}

/** Promise-or-callback, the same split `rpc.js` handles, for the one tabs call. */
function activeTabUrl() {
    const tabs = api.tabs;
    if (!tabs || !tabs.query) return Promise.resolve("");
    const query = { active: true, currentWindow: true };
    const first = (list) => (Array.isArray(list) && list[0] && list[0].url) || "";
    const returned = tabs.query(query);
    if (returned && typeof returned.then === "function") return returned.then(first, () => "");
    return new Promise((resolve) => tabs.query(query, (list) => resolve(first(list))));
}

function openManager({ tab, id, url }) {
    const target = new URL("manager.html", location.href);
    if (tab === "add" && url) target.searchParams.set("for", url);
    target.hash = id ? `#skin/${encodeURIComponent(id)}` : `#${tab || "skins"}`;
    if (api.tabs && api.tabs.create) api.tabs.create({ url: target.href });
    else globalThis.open(target.href, "_blank");
    globalThis.close();
}

async function setEnabled(id, enabled) {
    const summary = [...state.matches, ...state.others].find((item) => item.id === id);
    if (summary) summary.enabled = enabled; // optimistic: the switch must not lag a thumb
    try {
        await rpc.send(UI.SET_ENABLED, { id, enabled });
    } catch (error) {
        if (summary) summary.enabled = !enabled;
        paintError(error);
    }
}

function paint() {
    clear(root()).appendChild(
        renderPopup(
            {
                url: state.url,
                matches: state.matches,
                others: state.others,
                caps: state.caps,
                settings: state.settings,
                onToggle: setEnabled,
                onOpenManager: openManager
            },
            document
        )
    );
}

function paintError(error) {
    clear(root()).appendChild(
        renderEmpty(
            {
                title: "Oriel is not answering",
                body: error && error.message ? error.message : String(error),
                action: { label: "Try again", onClick: load }
            },
            document
        )
    );
}

async function load() {
    try {
        state.url = await activeTabUrl();
        const [site, list] = await Promise.all([
            rpc.send(UI.FOR_SITE, { url: state.url }),
            rpc.send(UI.LIST, {})
        ]);
        state.matches = (site && site.matches) || [];
        state.others = (site && site.others) || [];
        state.caps = (list && list.caps) || {};
        state.settings = { ...DEFAULT_SETTINGS, ...((list && list.settings) || {}) };
        paint();
    } catch (error) {
        paintError(error);
    }
}

rpc.on(EVENT.CHANGED, load);
load();
