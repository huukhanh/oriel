/**
 * The one place the UI touches `runtime`.
 *
 * Everything above this file is a pure function of data, so this is also the
 * only place that can hang. It cannot be allowed to: on Safari the background
 * context is evicted aggressively and a request sent to a dead worker never
 * settles. Users report that as "the app is frozen", which is unfalsifiable
 * and unfixable. Every send therefore has a deadline and fails loudly.
 *
 * @module ui/rpc
 */

/** Long enough for a cold background start, short enough that a phone user has not given up. */
export const TIMEOUT_MS = 8000;

function isThenable(value) {
    return Boolean(value) && typeof value.then === "function";
}

/**
 * The wire envelope: `{ type, ...payload }`.
 *
 * shared/protocol.js documents each message as its payload object and does not
 * name an envelope, so this is a choice. Flat, because every background
 * dispatcher for a WebExtension switches on one discriminant, and a nested
 * `payload` makes the common case — `{ id }` — read as `{ payload: { id } }`.
 */
function envelope(type, payload) {
    return { type, ...(payload || {}) };
}

function timeoutError(type) {
    const error = new Error(
        `Oriel's background page did not answer "${type}" within ${TIMEOUT_MS / 1000}s. ` +
            "It may have been shut down; try again."
    );
    error.code = "timeout";
    error.type = type;
    return error;
}

/**
 * @param {object} runtime  `chrome.runtime` or `browser.runtime`.
 * @returns {{send: (type: string, payload?: object) => Promise<any>, on: (event: string, fn: Function) => () => void, dispose: () => void}}
 */
export function createRpc(runtime) {
    // Chrome resolves a promise from `sendMessage(msg)`; older callback-only
    // implementations return undefined and answer through a callback. Which
    // one this is cannot be known without sending, so it is discovered on the
    // first send and remembered — the discovery costs a duplicate delivery of
    // that first message on a callback-only browser, which is why every page
    // shell opens with a read (`ui.list`, `ui.caps`) and never a mutation.
    let mode = "unknown";

    function deliver(message) {
        return new Promise((resolve, reject) => {
            const onReply = (reply) => {
                const error = runtime.lastError;
                if (error) reject(new Error(error.message || String(error)));
                else resolve(reply);
            };

            if (mode !== "callback") {
                const returned = runtime.sendMessage(message);
                if (isThenable(returned)) {
                    mode = "promise";
                    returned.then(resolve, reject);
                    return;
                }
                mode = "callback";
            }
            runtime.sendMessage(message, onReply);
        });
    }

    function send(type, payload) {
        const message = envelope(type, payload);
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(timeoutError(type));
            }, TIMEOUT_MS);

            const finish = (fn) => (value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                fn(value);
            };

            try {
                deliver(message).then(finish(resolve), finish(reject));
            } catch (error) {
                finish(reject)(error);
            }
        });
    }

    /** One `onMessage` listener for the page, fanned out by type. */
    const subscribers = new Map();
    let listener = null;

    function ensureListener() {
        if (listener || !runtime.onMessage) return;
        listener = (message) => {
            if (!message || typeof message.type !== "string") return undefined;
            const fns = subscribers.get(message.type);
            if (fns) for (const fn of [...fns]) fn(message);
            // Never return true here: an unsolicited event has no reply, and
            // claiming one keeps the sender's port open until it times out.
            return undefined;
        };
        runtime.onMessage.addListener(listener);
    }

    function on(event, fn) {
        ensureListener();
        if (!subscribers.has(event)) subscribers.set(event, new Set());
        subscribers.get(event).add(fn);
        return () => subscribers.get(event)?.delete(fn);
    }

    function dispose() {
        if (listener && runtime.onMessage) runtime.onMessage.removeListener(listener);
        listener = null;
        subscribers.clear();
    }

    return { send, on, dispose };
}

/**
 * The same shape, backed by a plain object, so a page shell can be exercised
 * without a browser.
 *
 * `fixtures` maps a message type to either a reply or a function of the
 * payload returning one (or a promise, or a thrown error). An unknown type
 * rejects rather than resolving `undefined`, because a silent `undefined` is
 * how a missing background handler hides for a week.
 *
 * @param {Record<string, any>} [fixtures]
 */
export function createMockRpc(fixtures = {}) {
    const calls = [];
    const subscribers = new Map();

    async function send(type, payload = {}) {
        calls.push({ type, payload });
        if (!(type in fixtures)) {
            throw new Error(`createMockRpc: no fixture for "${type}"`);
        }
        const fixture = fixtures[type];
        return typeof fixture === "function" ? await fixture(payload) : fixture;
    }

    function on(event, fn) {
        if (!subscribers.has(event)) subscribers.set(event, new Set());
        subscribers.get(event).add(fn);
        return () => subscribers.get(event)?.delete(fn);
    }

    /** Fire a background event at the page, as `EVENT.CHANGED` would arrive. */
    function emit(event, message = {}) {
        for (const fn of [...(subscribers.get(event) || [])]) fn({ type: event, ...message });
    }

    return { send, on, emit, calls, dispose() { subscribers.clear(); } };
}
