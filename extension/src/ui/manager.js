/**
 * The manager page: four tabs, one detail view, and all of the state the pure
 * views refuse to hold.
 *
 * Two things here are deliberate and easy to undo by accident.
 *
 * Var changes do **not** re-render. The form is already showing what the user
 * did; re-rendering it mid-drag would fight the slider and lose the live feel
 * that is the point of the feature.
 *
 * Focus survives a render. The search field re-renders the list on every
 * keystroke, so the shell restores focus and the caret by `data-focus-key`
 * afterwards — without it, typing a second character is impossible.
 *
 * @module ui/manager
 */

import { createRpc } from "./rpc.js";
import { clear, UI_EVENT } from "./dom.js";
import {
    renderSkinList,
    renderSkinDetail,
    renderImport,
    renderLog,
    renderSettings,
    renderCaps,
    renderEmpty
} from "./views.js";
import { UI, EVENT, DEFAULT_SETTINGS } from "../shared/protocol.js";

const api = globalThis.chrome || globalThis.browser || {};
const rpc = createRpc(api.runtime || { sendMessage: () => Promise.reject(new Error("No extension runtime")) });

const TABS = [
    { id: "skins", label: "Skins" },
    { id: "add", label: "Add" },
    { id: "log", label: "Log" },
    { id: "settings", label: "Settings" }
];

const state = {
    tab: "skins",
    skinId: null,
    skins: [],
    settings: { ...DEFAULT_SETTINGS },
    caps: {},
    filter: "",
    detail: null,
    imports: { text: "", locator: "", preview: null, result: null, busy: false },
    log: { entries: [], filter: "" }
};

const main = () => document.getElementById("main");
const tabbar = () => document.getElementById("tabs");
const statusLine = () => document.getElementById("status");

function setStatus(message, kind = "") {
    const node = statusLine();
    if (!node) return;
    node.textContent = message || "";
    node.className = kind ? `o-status ${kind}` : "o-status";
}

function report(error) {
    setStatus(error && error.message ? error.message : String(error), "is-error");
}

/* ---------------------------------------------------------------- routing */

function readHash() {
    const hash = location.hash.replace(/^#/, "");
    if (hash.startsWith("skin/")) return { tab: "skins", skinId: decodeURIComponent(hash.slice(5)) };
    const tab = TABS.some((entry) => entry.id === hash) ? hash : "skins";
    return { tab, skinId: null };
}

function go({ tab, id }) {
    location.hash = id ? `#skin/${encodeURIComponent(id)}` : `#${tab || "skins"}`;
}

async function route() {
    const next = readHash();
    const changed = next.skinId !== state.skinId;
    state.tab = next.tab;
    state.skinId = next.skinId;
    if (state.skinId && changed) await loadDetail(state.skinId);
    if (state.tab === "log") await loadLog();
    render();
}

/* ------------------------------------------------------------------- data */

async function refresh() {
    try {
        const reply = await rpc.send(UI.LIST, {});
        state.skins = (reply && reply.skins) || [];
        state.settings = { ...DEFAULT_SETTINGS, ...((reply && reply.settings) || {}) };
        state.caps = (reply && reply.caps) || {};
        setStatus("");
    } catch (error) {
        report(error);
    }
}

async function loadDetail(id) {
    try {
        const [got, exported, log] = await Promise.all([
            rpc.send(UI.GET, { id }),
            // The only way to get a skin's text back out: InstalledSkin does
            // not carry its source, and the editor cannot open empty.
            rpc.send(UI.EXPORT, { id }).catch(() => null),
            rpc.send(UI.LOG_READ, { skinId: id, limit: 10 }).catch(() => null)
        ]);
        const installed = got && got.installed;
        state.detail = installed
            ? { ...installed, text: (exported && exported.text) || "", log: (log && log.entries) || [], errors: [] }
            : null;
    } catch (error) {
        state.detail = null;
        report(error);
    }
}

async function loadLog() {
    try {
        const reply = await rpc.send(UI.LOG_READ, state.log.filter ? { skinId: state.log.filter } : {});
        state.log.entries = (reply && reply.entries) || [];
    } catch (error) {
        report(error);
    }
}

/* -------------------------------------------------------------- rendering */

function renderTabs() {
    const bar = clear(tabbar());
    for (const tab of TABS) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `o-tab${state.tab === tab.id && !state.skinId ? " is-active" : ""}`;
        button.textContent = tab.label;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(state.tab === tab.id && !state.skinId));
        button.addEventListener("click", () => go({ tab: tab.id }));
        bar.appendChild(button);
    }
}

function currentView() {
    if (state.skinId) {
        if (!state.detail) return renderEmpty({ title: "Loading…" }, document);
        return renderSkinDetail(
            {
                installed: state.detail,
                caps: state.caps,
                onSave: saveSource,
                onValues: saveValues,
                onRemove: removeSkin,
                onUpdate: updateSkin
            },
            document
        );
    }

    if (state.tab === "add") {
        return renderImport(
            {
                state: state.imports,
                onPasteSubmit: importText,
                onUrlSubmit: importUrl,
                onPreview: previewUrl
            },
            document
        );
    }

    if (state.tab === "log") {
        return renderLog({ entries: state.log.entries, skins: state.skins, filter: state.log.filter }, document);
    }

    if (state.tab === "settings") {
        const wrap = document.createElement("div");
        wrap.appendChild(renderSettings({ settings: state.settings, onChange: changeSetting }, document));
        wrap.appendChild(renderCaps({ caps: state.caps }, document));
        return wrap;
    }

    return renderSkinList(
        { skins: state.skins, filter: state.filter, onToggle: setEnabled, onOpen: (id) => go({ id }), onReorder: reorder },
        document
    );
}

function render() {
    const focus = document.activeElement;
    const key = focus && focus.dataset ? focus.dataset.focusKey : null;
    const caret = focus && typeof focus.selectionStart === "number" ? focus.selectionStart : null;

    renderTabs();
    clear(main()).appendChild(currentView());

    if (!key) return;
    const restored = main().querySelector(`[data-focus-key="${key}"]`);
    if (!restored) return;
    restored.focus();
    if (caret !== null && typeof restored.setSelectionRange === "function") {
        restored.setSelectionRange(caret, caret);
    }
}

/* ------------------------------------------------------------------ verbs */

async function setEnabled(id, enabled) {
    const summary = state.skins.find((item) => item.id === id);
    if (summary) summary.enabled = enabled;
    try {
        await rpc.send(UI.SET_ENABLED, { id, enabled });
    } catch (error) {
        if (summary) summary.enabled = !enabled;
        report(error);
        render();
    }
}

async function reorder(ids) {
    const position = new Map(ids.map((id, index) => [id, index]));
    for (const summary of state.skins) summary.order = position.get(summary.id) ?? summary.order;
    render();
    try {
        await rpc.send(UI.REORDER, { ids });
    } catch (error) {
        report(error);
        await refresh();
        render();
    }
}

async function saveValues(values) {
    if (!state.detail) return;
    state.detail.values = values;
    try {
        await rpc.send(UI.SET_VALUES, { id: state.detail.skin.id, values });
        setStatus("Saved");
    } catch (error) {
        report(error);
    }
}

async function saveSource(text, id) {
    state.detail.text = text;
    try {
        const reply = await rpc.send(UI.SAVE_SOURCE, { id, source: text });
        state.detail.errors = (reply && reply.errors) || [];
        if (reply && reply.ok) {
            setStatus("Saved");
            await refresh();
            await loadDetail(id);
            state.detail.text = text;
        }
    } catch (error) {
        report(error);
    }
    render();
}

async function removeSkin(id) {
    try {
        await rpc.send(UI.REMOVE, { id });
        state.detail = null;
        await refresh();
        go({ tab: "skins" });
    } catch (error) {
        report(error);
    }
}

async function updateSkin(id) {
    setStatus("Checking…");
    try {
        const reply = await rpc.send(UI.CHECK_UPDATES, { ids: [id] });
        const result = ((reply && reply.results) || [])[0];
        if (!result || result.status !== "available") {
            setStatus(result && result.message ? result.message : "No update available");
            return;
        }
        const applied = await rpc.send(UI.APPLY_UPDATE, { id });
        setStatus(applied && applied.ok ? `Updated to v${result.version}` : "Update failed", applied && applied.ok ? "" : "is-error");
        await refresh();
        await loadDetail(id);
        render();
    } catch (error) {
        report(error);
    }
}

async function importText(text) {
    state.imports.text = text;
    state.imports.busy = true;
    render();
    try {
        state.imports.result = await rpc.send(UI.IMPORT_TEXT, { text });
        if (state.imports.result && state.imports.result.ok) state.imports.text = "";
        await refresh();
    } catch (error) {
        state.imports.result = { ok: false, errors: [{ message: String(error.message || error) }], warnings: [] };
    }
    state.imports.busy = false;
    render();
}

async function importUrl(locator) {
    state.imports.locator = locator;
    state.imports.busy = true;
    render();
    try {
        state.imports.result = await rpc.send(UI.IMPORT_URL, { locator });
        await refresh();
    } catch (error) {
        state.imports.result = { ok: false, errors: [{ message: String(error.message || error) }], warnings: [] };
    }
    state.imports.busy = false;
    render();
}

async function previewUrl(locator) {
    if (!locator.trim()) {
        state.imports.preview = null;
        render();
        return;
    }
    try {
        state.imports.preview = await rpc.send(UI.PREVIEW_URL, { locator });
    } catch (error) {
        state.imports.preview = { ok: false, candidates: [], describe: String(error.message || error) };
    }
    render();
}

async function changeSetting(key, value) {
    state.settings[key] = value;
    try {
        const reply = await rpc.send(UI.SETTINGS, { patch: { [key]: value } });
        if (reply && reply.settings) state.settings = { ...DEFAULT_SETTINGS, ...reply.settings };
        setStatus("Saved");
    } catch (error) {
        report(error);
    }
}

async function exportSkin(id) {
    try {
        const reply = await rpc.send(UI.EXPORT, { id });
        const blob = new Blob([reply.text], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = reply.filename || `${id}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        setStatus(`Exported ${anchor.download}`);
    } catch (error) {
        report(error);
    }
}

/* ----------------------------------------------------------------- wiring */

function onUiEvent(name, handler) {
    document.addEventListener(name, (event) => handler(event.detail || {}));
}

onUiEvent(UI_EVENT.FILTER, ({ value }) => {
    state.filter = value || "";
    render();
});
onUiEvent(UI_EVENT.NAVIGATE, ({ tab, id }) => go({ tab, id }));
onUiEvent(UI_EVENT.EXPORT, ({ id }) => exportSkin(id));
onUiEvent(UI_EVENT.LOG_FILTER, async ({ skinId }) => {
    state.log.filter = skinId || "";
    await loadLog();
    render();
});
onUiEvent(UI_EVENT.LOG_CLEAR, async ({ skinId }) => {
    try {
        await rpc.send(UI.LOG_CLEAR, skinId ? { skinId } : {});
        await loadLog();
        render();
    } catch (error) {
        report(error);
    }
});
onUiEvent(UI_EVENT.REQUEST_USER_SCRIPTS, async () => {
    try {
        const reply = await rpc.send(UI.REQUEST_USER_SCRIPTS, { enable: true });
        if (reply && reply.caps) state.caps = reply.caps;
        render();
    } catch (error) {
        report(error);
    }
});
// Kept off the render path on purpose: the Add screen must not lose a caret
// while someone is typing into it.
onUiEvent(UI_EVENT.IMPORT_STATE, (patch) => Object.assign(state.imports, patch));

rpc.on(EVENT.CHANGED, async () => {
    await refresh();
    if (state.skinId) await loadDetail(state.skinId);
    render();
});
rpc.on(EVENT.LOGGED, (message) => {
    if (!message.entry) return;
    state.log.entries = [message.entry, ...state.log.entries].slice(0, 500);
    if (state.tab === "log" && !state.skinId) render();
});

globalThis.addEventListener("hashchange", route);

/** A URL the popup handed over: open the Add tab prefilled for that site. */
function seedFromQuery() {
    const site = new URL(location.href).searchParams.get("for");
    if (site) state.imports.locator = site;
}

seedFromQuery();
refresh().then(route);
