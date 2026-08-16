/**
 * The chrome's view model. Pure — no DOM, no host calls, no timers.
 *
 * `createState` is a tiny event-sourced store: `chrome.js` turns host events
 * (`tabs.onChanged`, a navigation callback, a progress tick) into calls to
 * `apply`, and `views.js` is handed the result of `get()`. Keeping the
 * reducer here rather than in `chrome.js` is what makes the state machine
 * testable without a Host at all.
 *
 * @module browser/chrome/state
 */

const INITIAL = Object.freeze({
    tabs: [],
    activeId: null,
    address: Object.freeze({ url: "", editing: false, secure: false }),
    loading: false,
    progress: 0,
    canGoBack: false,
    canGoForward: false,
    toolbarItems: []
});

function reduce(state, event) {
    switch (event?.type) {
        case "tabs":
            // The host is the source of truth for the list; `activeId` only
            // moves if the host says so, so a locally-optimistic switch (see
            // "activate") is not clobbered by a tab list refresh that raced it.
            return {
                ...state,
                tabs: event.tabs ?? state.tabs,
                activeId: Object.hasOwn(event, "activeId") ? event.activeId : state.activeId
            };
        case "tab-closed":
            return {
                ...state,
                tabs: state.tabs.filter((tab) => tab.id !== event.id),
                activeId: nextActiveAfterClose(state.tabs, event.id, state.activeId)
            };
        case "activate":
            return { ...state, activeId: event.id };
        case "address":
            return { ...state, address: { ...state.address, ...event.address } };
        case "loading":
            return {
                ...state,
                loading: Boolean(event.loading),
                progress: event.progress ?? (event.loading ? state.progress : 0)
            };
        case "navigation":
            return {
                ...state,
                canGoBack: Boolean(event.canGoBack),
                canGoForward: Boolean(event.canGoForward)
            };
        case "toolbar":
            return { ...state, toolbarItems: event.items ?? [] };
        default:
            return state;
    }
}

/** @param {object} [initial] partial state to seed on top of the defaults */
export function createState(initial = {}) {
    let state = { ...INITIAL, ...initial };
    const subscribers = new Set();

    return {
        get: () => state,
        apply(event) {
            state = reduce(state, event);
            for (const fn of subscribers) fn(state);
        },
        subscribe(fn) {
            subscribers.add(fn);
            return () => subscribers.delete(fn);
        }
    };
}

/** A hostname label the WHATWG URL parser produced by ASCII-encoding a non-ASCII one. */
function isPunycodeLabel(label) {
    return label.startsWith("xn--");
}

/**
 * The scheme is the only part of a non-network URL (`about:`, `data:`,
 * `file:`, `blob:`, …) that is not attacker-reachable payload, so it is the
 * only part ever shown as if it were an origin. Everything else — the whole
 * rest of the string — is `rest`, dimmed, never elevated.
 */
function breakdownWithoutOrigin(parsed) {
    const trailer = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (parsed.protocol === "about:") return { origin: `about:${parsed.pathname}`, rest: "" };
    if (parsed.protocol === "file:") return { origin: "file://", rest: trailer };
    return { origin: parsed.protocol, rest: trailer };
}

/**
 * Split a URL into an `origin` safe to show at full trust and a `rest` that
 * must always render de-emphasised, never as if it were part of the host.
 *
 * `origin`/`rest` are derived from the parsed URL's own fields (`.origin`,
 * `.pathname`, `.search`, `.hash`), never by slicing the raw string — that is
 * what keeps `https://safe.test/https://evil.test/` from ever producing an
 * origin that contains "evil.test".
 *
 * @param {string} rawUrl
 * @returns {{origin: string, rest: string, secure: boolean, display: string, punycodeWarning: boolean}}
 */
export function formatUrl(rawUrl) {
    const raw = typeof rawUrl === "string" ? rawUrl : "";

    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        // Not a URL at all. There is no origin to trust, so none is claimed.
        return { origin: "", rest: raw, secure: false, display: raw, punycodeWarning: false };
    }

    const secure = parsed.protocol === "https:";

    if (parsed.origin && parsed.origin !== "null") {
        const rest = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        // The URL parser already ASCII-encodes any non-ASCII label to
        // punycode — `origin` below is that punycode form, never a decoded
        // Unicode one, so a homograph domain is never displayed as if it read
        // like the real thing. This flag is only the extra "look at this".
        const punycodeWarning = parsed.hostname.split(".").some(isPunycodeLabel);
        return { origin: parsed.origin, rest, secure, display: `${parsed.origin}${rest}`, punycodeWarning };
    }

    const { origin, rest } = breakdownWithoutOrigin(parsed);
    return { origin, rest, secure, display: `${origin}${rest}`, punycodeWarning: false };
}

/**
 * The tab to focus after closing `closedId`, preferring the right-hand
 * neighbour, falling back to the left, and `null` when nothing is left.
 *
 * Closing a tab that is not the active one never moves focus.
 *
 * @param {Array<{id: string}>} tabs the list as it was before the close
 * @param {string} closedId
 * @param {string|null} activeId
 * @returns {string|null}
 */
export function nextActiveAfterClose(tabs, closedId, activeId) {
    if (activeId !== closedId) return activeId;
    const index = tabs.findIndex((tab) => tab.id === closedId);
    if (index === -1) return activeId;
    if (tabs.length === 1) return null;
    return index < tabs.length - 1 ? tabs[index + 1].id : tabs[index - 1].id;
}

/**
 * Toolbar items ordered by declared `position` (ascending), items without one
 * placed after those that have one, ties broken by insertion order — so a
 * skin that adds two items with the same position always sees them land in
 * the order it added them, on every render.
 *
 * @param {Array<{position?: number}>} items
 */
export function orderToolbarItems(items = []) {
    return items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
            const byPosition = positionOf(a.item) - positionOf(b.item);
            return byPosition !== 0 ? byPosition : a.index - b.index;
        })
        .map(({ item }) => item);
}

function positionOf(item) {
    return typeof item?.position === "number" ? item.position : Number.POSITIVE_INFINITY;
}
