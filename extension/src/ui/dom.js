/**
 * The element builder every UI module uses.
 *
 * Two properties it exists to guarantee. A `document` is always passed in,
 * never reached for, so the views are pure functions a jsdom test can call.
 * And there is no way to set markup from a string: a skin's name, an author's
 * description, an error message and a log line are all third-party text
 * rendered on a page that holds extension privileges, so `textContent` has to
 * be not merely available but the only path.
 *
 * @module ui/dom
 */

/**
 * Keys assigned as properties rather than attributes. Attributes would work
 * for most of them, but `input.value` and `input.checked` do not track their
 * attributes after a user interaction, and a form that stops reflecting what
 * the user typed is the kind of bug that only shows up on a device.
 */
const PROPERTY_KEYS = new Set([
    "value",
    "checked",
    "disabled",
    "selected",
    "readOnly",
    "multiple",
    "htmlFor",
    "tabIndex",
    "draggable",
    "spellcheck",
    "open",
    "hidden",
    "indeterminate"
]);

const SVG_NS = "http://www.w3.org/2000/svg";

/** Icon paths, drawn on a 24×24 grid with a 2px stroke. Inline so no request leaves the page. */
const ICONS = {
    search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
    up: "M12 19V5M5 12l7-7 7 7",
    down: "M12 5v14M19 12l-7 7-7-7",
    warning: "M12 3 2 20h20L12 3zM12 9v5M12 17.5v.5",
    close: "M6 6l12 12M18 6L6 18",
    external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
    plus: "M12 5v14M5 12h14",
    trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
    download: "M12 4v11M7 11l5 5 5-5M4 20h16",
    refresh: "M20 11a8 8 0 1 0-1.6 5.4M20 5v6h-6",
    check: "M4 12.5 9.5 18 20 7",
    skin: "M4 6h16v12H4zM4 10h16M8 10v8"
};

/** The window an event or timer has to come from, so jsdom accepts it. */
function viewOf(node) {
    return (node && node.ownerDocument && node.ownerDocument.defaultView) || globalThis;
}

function parseSpec(spec) {
    const hash = spec.indexOf("#");
    const dot = spec.indexOf(".");
    const cut = Math.min(hash === -1 ? spec.length : hash, dot === -1 ? spec.length : dot);
    const tag = spec.slice(0, cut) || "div";
    const rest = spec.slice(cut);
    const classes = [];
    let id = "";
    for (const part of rest.split(/(?=[.#])/)) {
        if (part.startsWith(".")) classes.push(part.slice(1));
        else if (part.startsWith("#")) id = part.slice(1);
    }
    return { tag, classes, id };
}

function classString(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.filter(Boolean).join(" ");
    return Object.keys(value)
        .filter((key) => value[key])
        .join(" ");
}

function applyProps(element, props) {
    for (const [key, value] of Object.entries(props)) {
        if (value === undefined || value === null) continue;
        if (key === "text") {
            element.textContent = String(value);
        } else if (key === "class" || key === "className") {
            const merged = [element.className, classString(value)].filter(Boolean).join(" ");
            if (merged) element.className = merged;
        } else if (key === "style" && typeof value === "object") {
            for (const [prop, v] of Object.entries(value)) element.style.setProperty(prop, String(v));
        } else if (key === "data" && typeof value === "object") {
            for (const [prop, v] of Object.entries(value)) element.dataset[prop] = String(v);
        } else if (key.startsWith("on") && typeof value === "function") {
            element.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (PROPERTY_KEYS.has(key)) {
            element[key] = value;
        } else if (value === false) {
            continue;
        } else if (value === true) {
            element.setAttribute(key, "");
        } else {
            element.setAttribute(key, String(value));
        }
    }
}

/**
 * `h(document, "button.o-icon", { onclick }, ["Save"])`.
 *
 * The spec is a tag with optional `.class` and `#id`; a leading `.` means a
 * `div`. Children may be nodes, strings, or falsy values that are skipped, so
 * `cond && h(...)` reads naturally in a view.
 *
 * @param {Document} document
 * @param {string} spec
 * @param {Record<string, unknown>} [props]
 * @param {Array<Node|string|null|false|undefined>} [children]
 * @returns {HTMLElement}
 */
export function h(document, spec, props = {}, children = []) {
    const { tag, classes, id } = parseSpec(spec);
    const element = document.createElement(tag);
    if (classes.length) element.className = classes.join(" ");
    if (id) element.id = id;
    applyProps(element, props);
    append(element, children);
    return element;
}

/** `h` with the document already supplied. Every view starts with this. */
export function bind(document) {
    return (spec, props, children) => h(document, spec, props, children);
}

/** A text node. The only way text enters the tree, and it cannot carry markup. */
export function text(document, value) {
    return document.createTextNode(value === undefined || value === null ? "" : String(value));
}

/** Append children, skipping falsy entries and converting strings to text nodes. */
export function append(parent, children) {
    const list = Array.isArray(children) ? children : [children];
    for (const child of list) {
        if (child === null || child === undefined || child === false || child === "") continue;
        parent.appendChild(typeof child === "object" ? child : text(parent.ownerDocument, child));
    }
    return parent;
}

/** Remove every child. Used by the page shells when swapping views. */
export function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
}

/**
 * An inline SVG icon. Built node by node rather than parsed from a string,
 * for the same reason as everything else in this file.
 */
export function icon(document, name, { size = 20, label = "" } = {}) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "o-icon-svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    if (label) svg.setAttribute("aria-label", label);
    else svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ICONS[name] || ICONS.skin);
    svg.appendChild(path);
    return svg;
}

/**
 * The switch used for every on/off state in the product: skins in the popup,
 * skins in the manager, `checkbox` vars, and the settings toggles.
 *
 * A real `<input type="checkbox">` under a painted track, because the
 * alternative — a `<button role="switch">` — loses VoiceOver's form-control
 * gestures and cannot be driven by a `change` event in a test.
 */
export function switchControl(document, { checked = false, label = "", disabled = false, onChange } = {}) {
    const wrapper = h(document, "label.o-switch");
    const input = h(document, "input", {
        type: "checkbox",
        checked: Boolean(checked),
        disabled: Boolean(disabled),
        "aria-label": label || undefined
    });
    if (typeof onChange === "function") {
        input.addEventListener("change", () => onChange(input.checked));
    }
    wrapper.appendChild(input);
    wrapper.appendChild(h(document, "span.o-switch-track", {}, [h(document, "span.o-switch-thumb")]));
    return wrapper;
}

/**
 * A URL is only linked if it is http(s). Homepage and support URLs come out of
 * a skin's metadata, and a `javascript:` href on an extension page runs with
 * extension privileges — this is the one place a string from a skin would
 * otherwise become executable.
 *
 * @returns {string|null}
 */
export function safeUrl(value) {
    if (typeof value !== "string" || !value) return null;
    try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
    } catch {
        return null;
    }
}

/**
 * The UI's own events, dispatched from a rendered node and caught by the page
 * shell. They exist for the interactions the view signatures have no callback
 * for — searching, switching tab, exporting — and they are deliberately named
 * `oriel:*` so they can never collide with the `ui.*` message protocol.
 */
export function emit(node, name, detail = {}) {
    const view = viewOf(node);
    const Ctor = view.CustomEvent || globalThis.CustomEvent;
    node.dispatchEvent(new Ctor(name, { detail, bubbles: true }));
    return node;
}

/** Event names used by `emit`. Listed once so the shells and the views agree. */
export const UI_EVENT = {
    FILTER: "oriel:filter",
    NAVIGATE: "oriel:navigate",
    EXPORT: "oriel:export",
    LOG_FILTER: "oriel:log-filter",
    LOG_CLEAR: "oriel:log-clear",
    REQUEST_USER_SCRIPTS: "oriel:request-userscripts",
    IMPORT_STATE: "oriel:import-state"
};
