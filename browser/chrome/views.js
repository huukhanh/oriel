/**
 * The browser's own interface, as pure functions from state to a DOM node.
 *
 * No host calls, no globals, no fetching — a `document` comes in as an
 * argument like everywhere else in this codebase (see `browser/ui/dom.js`),
 * and every string that did not originate in this file (a tab's title, a
 * page's URL) reaches the DOM through `textContent`, never `innerHTML`. This
 * document runs with the browser's own privileges, and a page controls its
 * own title.
 *
 * `data-chrome` hooks — a public contract for skin authors calling
 * `oriel.chrome.dom()`. Renaming or removing one is a breaking change.
 *
 *   chrome                the root node `renderChrome` returns
 *   tab-strip              the scrollable tab row
 *   tab                    one tab
 *   tab-favicon            a tab's favicon slot
 *   tab-title              a tab's (truncating) title
 *   tab-close              a tab's close button
 *   tab-count              the tab count badge
 *   tab-overflow           shown once there are more tabs than fit
 *   new-tab                the "+" button
 *   address-bar             the address bar container
 *   address-field           the tappable origin/rest display (not editing)
 *   address-input           the editable text field (editing)
 *   address-origin          the origin span, full trust, full opacity
 *   address-rest            the de-emphasised remainder of the URL
 *   address-lock            the security indicator (lock / warning / neutral)
 *   address-punycode-warning shown only when the host is IDN-encoded
 *   address-reload          the stop/reload button
 *   progress                the determinate loading bar
 *   toolbar                 the toolbar container
 *   back                    the back button
 *   forward                 the forward button
 *   share                   the share button
 *   tabs-button             opens the tab strip / overview
 *   menu                    the menu button
 *   toolbar-slot             where `chrome.toolbar.add()` items render
 *   toolbar-item             one skin-added toolbar item
 *
 * @module browser/chrome/views
 */

import { bind } from "../ui/dom.js";
import { formatUrl, orderToolbarItems } from "./state.js";

/** More tabs than this fit on a phone screen without scrolling. */
const TAB_OVERFLOW_THRESHOLD = 6;

const SVG_NS = "http://www.w3.org/2000/svg";

/** Chrome-only icons, on the same 24×24 / 2px-stroke grid as `ui/dom.js`. */
const ICONS = {
    back: "M15 5l-7 7 7 7",
    forward: "M9 5l7 7-7 7",
    share: "M12 3v12M8 7l4-4 4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6",
    tabs: "M4 6h16v14H4zM4 10h16M7 3h10a1 1 0 0 1 1 1v2H6V4a1 1 0 0 1 1-1z",
    menu: "M4 7h16M4 12h16M4 17h16",
    lock: "M6 11V8a6 6 0 0 1 12 0v3M5 11h14v9H5z",
    warning: "M12 3 2 20h20L12 3zM12 9v5M12 17.5v.5",
    reload: "M20 11a8 8 0 1 0-1.6 5.4M20 5v6h-6",
    stop: "M6 6l12 12M18 6L6 18",
    plus: "M12 5v14M5 12h14"
};

function icon(document, name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ICONS[name] || "");
    svg.appendChild(path);
    return svg;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

/**
 * @param {{tabs: Array<{id:string,url:string,title?:string,loading?:boolean}>, activeId: string|null,
 *          onSelect?: (id:string)=>void, onClose?: (id:string)=>void, onNew?: ()=>void}} props
 * @param {Document} document
 */
export function renderTabStrip({ tabs = [], activeId = null, onSelect, onClose, onNew }, document) {
    const h = bind(document);
    const strip = h("div.chrome-tabstrip", { "data-chrome": "tab-strip", role: "tablist", "aria-label": "Tabs" });

    strip.appendChild(
        h("span.chrome-tab-count", {
            "data-chrome": "tab-count",
            text: String(tabs.length),
            "aria-label": `${tabs.length} tabs open`
        })
    );

    const scroller = h("div.chrome-tabs-scroll");
    for (const tab of tabs) scroller.appendChild(renderTab(h, document, tab, tab.id === activeId, onSelect, onClose));
    strip.appendChild(scroller);

    if (tabs.length > TAB_OVERFLOW_THRESHOLD) {
        const overflow = h("button.chrome-tab-overflow", {
            type: "button",
            "data-chrome": "tab-overflow",
            text: `+${tabs.length - TAB_OVERFLOW_THRESHOLD}`,
            "aria-label": "Scroll to the last tab"
        });
        overflow.addEventListener("click", () => {
            scroller.scrollLeft = scroller.scrollWidth;
        });
        strip.appendChild(overflow);
    }

    const add = h("button.chrome-tab-new", { type: "button", "data-chrome": "new-tab", "aria-label": "New tab" });
    add.appendChild(icon(document, "plus"));
    if (typeof onNew === "function") add.addEventListener("click", () => onNew());
    strip.appendChild(add);

    return strip;
}

function renderTab(h, document, tab, isActive, onSelect, onClose) {
    const title = tab.title || tab.url || "New tab";
    const el = h("button.chrome-tab", {
        type: "button",
        class: isActive ? "is-active" : "",
        role: "tab",
        "aria-selected": isActive ? "true" : "false",
        "data-chrome": "tab",
        data: { tabId: tab.id }
    });

    el.appendChild(h("span.chrome-tab-favicon", { "data-chrome": "tab-favicon", "aria-hidden": "true" }));
    // `text` (see ui/dom.js) sets textContent — a page's own title can never
    // become markup here, however it is spelled.
    el.appendChild(h("span.chrome-tab-title", { "data-chrome": "tab-title", text: title }));

    const close = h("button.chrome-tab-close", {
        type: "button",
        "data-chrome": "tab-close",
        "aria-label": `Close ${title}`
    });
    close.appendChild(icon(document, "stop"));
    close.addEventListener("click", (event) => {
        event.stopPropagation();
        if (typeof onClose === "function") onClose(tab.id);
    });
    el.appendChild(close);

    if (typeof onSelect === "function") el.addEventListener("click", () => onSelect(tab.id));
    return el;
}

function securityBand(origin, secure) {
    if (secure) return "secure";
    if (origin.startsWith("http:")) return "insecure";
    return "neutral";
}

/**
 * @param {{url: string, editing?: boolean, loading?: boolean, secure?: boolean,
 *          onSubmit?: (value:string)=>void, onFocus?: ()=>void, onStop?: ()=>void, onReload?: ()=>void}} props
 * @param {Document} document
 */
export function renderAddressBar({ url = "", editing = false, loading = false, secure = false, onSubmit, onFocus, onStop, onReload }, document) {
    const h = bind(document);
    const parts = formatUrl(url);
    const band = securityBand(parts.origin, secure);

    const bar = h("div.chrome-address-bar", { "data-chrome": "address-bar", class: `is-${band}` });

    const lock = h("span.chrome-address-lock", { "data-chrome": "address-lock" });
    if (band === "secure") lock.appendChild(icon(document, "lock"));
    else if (band === "insecure") lock.appendChild(icon(document, "warning"));
    bar.appendChild(lock);

    if (parts.punycodeWarning) {
        bar.appendChild(
            h("span.chrome-address-punycode", {
                "data-chrome": "address-punycode-warning",
                text: "IDN",
                title: "This address is an internationalised domain name, shown in its raw punycode form."
            })
        );
    }

    if (editing) {
        const input = h("input.chrome-address-input", {
            type: "text",
            "data-chrome": "address-input",
            value: parts.display,
            "aria-label": "Address"
        });
        const form = h("form.chrome-address-form");
        form.appendChild(input);
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (typeof onSubmit === "function") onSubmit(input.value);
        });
        bar.appendChild(form);
        try {
            input.focus();
            input.select();
        } catch {
            // jsdom without a real focus manager; harmless to skip.
        }
    } else {
        const field = h("button.chrome-address-field", { type: "button", "data-chrome": "address-field" }, [
            h("span.chrome-address-origin", { "data-chrome": "address-origin", text: parts.origin }),
            parts.rest && h("span.chrome-address-rest", { "data-chrome": "address-rest", text: parts.rest })
        ]);
        if (typeof onFocus === "function") field.addEventListener("click", () => onFocus());
        bar.appendChild(field);
    }

    const reload = h("button.chrome-address-reload", {
        type: "button",
        "data-chrome": "address-reload",
        "aria-label": loading ? "Stop loading" : "Reload"
    });
    reload.appendChild(icon(document, loading ? "stop" : "reload"));
    reload.addEventListener("click", () => {
        if (loading) {
            if (typeof onStop === "function") onStop();
        } else if (typeof onReload === "function") {
            onReload();
        }
    });
    bar.appendChild(reload);

    return bar;
}

/**
 * @param {{progress: number|null|undefined}} props a value in [0,1], or a
 *   falsy/null value meaning "not loading"
 * @param {Document} document
 */
export function renderProgress({ progress }, document) {
    const h = bind(document);
    const active = progress !== null && progress !== undefined && progress > 0 && progress < 1;
    const track = h("div.chrome-progress", {
        "data-chrome": "progress",
        role: "progressbar",
        "aria-hidden": active ? undefined : "true",
        class: active ? "is-active" : "is-idle",
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": active ? String(Math.round(clamp01(progress) * 100)) : undefined
    });
    const fill = h("div.chrome-progress-fill");
    fill.style.width = `${active ? clamp01(progress) * 100 : 0}%`;
    track.appendChild(fill);
    return track;
}

/**
 * @param {{canGoBack: boolean, canGoForward: boolean, tabCount: number,
 *          items: Array<{id:string,icon?:string,title?:string,position?:number}>,
 *          onAction?: (action:string)=>void}} props
 * @param {Document} document
 */
export function renderToolbar({ canGoBack = false, canGoForward = false, tabCount = 0, items = [], onAction }, document) {
    const h = bind(document);
    const fire = (action) => {
        if (typeof onAction === "function") onAction(action);
    };

    const toolbar = h("div.chrome-toolbar", { "data-chrome": "toolbar", role: "toolbar", "aria-label": "Browser" });

    const back = navButton(h, document, "back", "Back", !canGoBack);
    back.addEventListener("click", () => fire("back"));
    const forward = navButton(h, document, "forward", "Forward", !canGoForward);
    forward.addEventListener("click", () => fire("forward"));
    toolbar.append(back, forward);

    const slot = h("div.chrome-toolbar-slot", { "data-chrome": "toolbar-slot" });
    for (const item of orderToolbarItems(items)) slot.appendChild(renderToolbarItem(h, document, item, fire));
    toolbar.appendChild(slot);

    const share = navButton(h, document, "share", "Share", false);
    share.addEventListener("click", () => fire("share"));
    toolbar.appendChild(share);

    const tabsButton = h("button.chrome-btn", {
        type: "button",
        "data-chrome": "tabs-button",
        "aria-label": `Tabs, ${tabCount} open`
    });
    tabsButton.appendChild(icon(document, "tabs"));
    tabsButton.appendChild(h("span.chrome-tabs-badge", { text: String(tabCount) }));
    tabsButton.addEventListener("click", () => fire("tabs"));
    toolbar.appendChild(tabsButton);

    const menu = navButton(h, document, "menu", "Menu", false);
    menu.addEventListener("click", () => fire("menu"));
    toolbar.appendChild(menu);

    return toolbar;
}

function navButton(h, document, name, label, disabled) {
    const button = h("button.chrome-btn", {
        type: "button",
        "data-chrome": name,
        disabled,
        "aria-label": label,
        "aria-disabled": disabled ? "true" : undefined
    });
    button.appendChild(icon(document, name));
    return button;
}

function renderToolbarItem(h, document, item, fire) {
    // Icon and title are a skin's own text: textContent only, same as a tab
    // title. There is no supported way for a toolbar item to carry markup.
    const button = h("button.chrome-toolbar-item", {
        type: "button",
        "data-chrome": "toolbar-item",
        "aria-label": item.title || item.id,
        title: item.title,
        data: { itemId: item.id }
    });
    button.appendChild(h("span.chrome-toolbar-item-icon", { text: item.icon || "" }));
    button.addEventListener("click", () => fire(item.id));
    return button;
}

/**
 * Composes the whole chrome from one state shape (see `state.js`) and one
 * bag of handlers. Never throws on an empty/partial state — a cold start
 * before the host has answered anything renders the same shell.
 *
 * @param {object} state
 * @param {{onTabSelect?, onTabClose?, onTabNew?, onAddressSubmit?, onAddressFocus?,
 *          onStop?, onReload?, onToolbarAction?}} handlers
 * @param {Document} document
 */
export function renderChrome(state = {}, handlers = {}, document) {
    const h = bind(document);
    const tabs = state.tabs ?? [];
    const address = state.address ?? {};
    const loading = Boolean(state.loading);

    const root = h("div.chrome-root", { "data-chrome": "chrome" });

    root.appendChild(
        renderTabStrip(
            { tabs, activeId: state.activeId ?? null, onSelect: handlers.onTabSelect, onClose: handlers.onTabClose, onNew: handlers.onTabNew },
            document
        )
    );

    root.appendChild(
        renderAddressBar(
            {
                url: address.url || "",
                editing: Boolean(address.editing),
                loading,
                secure: Boolean(address.secure),
                onSubmit: handlers.onAddressSubmit,
                onFocus: handlers.onAddressFocus,
                onStop: handlers.onStop,
                onReload: handlers.onReload
            },
            document
        )
    );

    root.appendChild(renderProgress({ progress: loading ? (state.progress ?? 0) : null }, document));

    root.appendChild(
        renderToolbar(
            {
                canGoBack: Boolean(state.canGoBack),
                canGoForward: Boolean(state.canGoForward),
                tabCount: tabs.length,
                items: state.toolbarItems ?? [],
                onAction: handlers.onToolbarAction
            },
            document
        )
    );

    return root;
}
