/**
 * Wiring for the chrome document: a Host in, DOM events out.
 *
 * Everything with a decision in it — what a URL looks like, which tab gets
 * focus next, how toolbar items order — lives in `state.js` and `views.js`,
 * both of which take no host and no document-global. This file's only job is
 * to turn host calls into `state.apply()` and `state` into a render, which is
 * why `mount` takes a `host` argument instead of reaching for one: it is
 * exercised in tests against `createTestHost` (see `engine/host/test-host.js`)
 * the same way it runs against the real bridge.
 *
 * @module browser/chrome/chrome
 */

import { createState } from "./state.js";
import { renderChrome } from "./views.js";
import { clear } from "../ui/dom.js";

const NEW_TAB_URL = "about:blank";

/**
 * @param {import("../../engine/host/contract.js").Host} host
 * @param {Element} root
 * @param {Document} document
 * @returns {{destroy: () => void}}
 */
export function mount(host, root, document) {
    const tabs = host?.namespaces?.tabs;
    const page = host?.namespaces?.page;
    const native = host?.namespaces?.native;
    const bus = host?.namespaces?.bus;

    const state = createState();
    const handlers = buildHandlers(state, { tabs, page, native, bus });

    function render() {
        clear(root);
        root.appendChild(renderChrome(state.get(), handlers, document));
    }

    state.subscribe(render);
    render();

    async function refreshTabs() {
        if (!tabs) return;
        const [list, current] = await Promise.all([tabs.list(), tabs.current()]);
        state.apply({ type: "tabs", tabs: list ?? [], activeId: current?.id ?? null });
    }

    // `tabs.onChanged` is how the host tells this document a tab opened,
    // closed, activated or navigated elsewhere — the tab strip never polls.
    const subscription = tabs?.onChanged ? tabs.onChanged(refreshTabs) : null;
    refreshTabs();

    return {
        destroy() {
            subscription?.stop();
        }
    };
}

function buildHandlers(state, { tabs, page, native, bus }) {
    return {
        onTabSelect(id) {
            state.apply({ type: "activate", id });
            tabs?.activate(id);
        },
        onTabClose(id) {
            state.apply({ type: "tab-closed", id });
            tabs?.close(id);
        },
        onTabNew() {
            tabs?.open(NEW_TAB_URL, { background: false });
        },
        onAddressFocus() {
            state.apply({ type: "address", address: { editing: true } });
        },
        onAddressSubmit(value) {
            state.apply({ type: "address", address: { editing: false, url: value } });
            // docs/BROWSER-API.md §2.2-2.3 has no "load this URL in the current
            // tab" call — `tabs.open` always opens a new one. Until a
            // `tabs.navigate` (or similar) exists, this is the closest
            // documented action; see the report for this gap.
            tabs?.open(value, { background: false });
        },
        onStop() {
            page?.stop();
        },
        onReload() {
            page?.reload({ cache: true });
        },
        onToolbarAction(action) {
            routeToolbarAction(action, { tabs, page, native, bus });
        }
    };
}

async function shareCurrentTab(tabs, native) {
    const current = tabs ? await tabs.current() : null;
    if (current) native.share({ url: current.url, title: current.title });
}

function routeToolbarAction(action, { tabs, page, native, bus }) {
    switch (action) {
        case "back":
            page?.back();
            return;
        case "forward":
            page?.forward();
            return;
        case "share":
            if (native?.share) shareCurrentTab(tabs, native);
            return;
        default:
            // "tabs" (an overview), "menu", and every skin-added toolbar item
            // id have no dedicated capability in docs/BROWSER-API.md §2.3.
            // `bus` is the documented channel for exactly this: something a
            // skin, or the rest of the chrome, can listen for.
            bus?.emit("chrome:action", { action });
    }
}

function autoboot() {
    if (typeof document === "undefined") return;
    const root = document.getElementById("chrome-root");
    const host = globalThis.__oriel?.host;
    if (root && host) mount(host, root, document);
}

autoboot();
