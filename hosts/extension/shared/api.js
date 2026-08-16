/**
 * One handle on the extension APIs, and one promise convention.
 *
 * Three differences are papered over here and nowhere else:
 *
 *   - the namespace is `browser` on Firefox and Safari, `chrome` on Chromium;
 *   - Chromium's older surfaces are callback-only, Firefox's are promise-only,
 *     and Safari is promise-first but callback-tolerant;
 *   - an API that does not exist should read as "not available", not as a
 *     `TypeError` thrown from the middle of an unrelated feature.
 *
 * Everything else in the extension imports from here and assumes promises.
 *
 * @module shared/api
 */

/** @type {any} */
const raw = globalThis.browser ?? globalThis.chrome ?? {};

export const api = raw;

/** True when the namespace answers promises natively (Firefox, Safari). */
export const nativePromises = typeof globalThis.browser !== "undefined";

/**
 * Call an extension API and get a promise, whichever convention it follows.
 * The callback form is detected by *trying* the promise form first: a method
 * that ignores the missing callback returns undefined, and that is the signal.
 *
 * @param {object} receiver  e.g. `api.storage.local`
 * @param {string} method
 * @param {...any} args
 */
export function call(receiver, method, ...args) {
    if (!receiver || typeof receiver[method] !== "function") {
        return Promise.reject(new Error(`${method} is not available in this browser`));
    }
    let result;
    try {
        result = receiver[method](...args);
    } catch (error) {
        return Promise.reject(error);
    }
    if (result && typeof result.then === "function") return result;

    return new Promise((resolve, reject) => {
        try {
            receiver[method](...args, (value) => {
                const error = raw.runtime?.lastError;
                if (error) reject(new Error(error.message));
                else resolve(value);
            });
        } catch (error) {
            reject(error);
        }
    });
}

/** Is this API surface present at all? `has("scripting", "registerContentScripts")`. */
export function has(...path) {
    let node = raw;
    for (const step of path) {
        if (!node || typeof node[step] === "undefined") return false;
        node = node[step];
    }
    return true;
}

/** `runtime.lastError` as a rejected promise, or null. Chromium leaves it set. */
export function lastError() {
    const error = raw.runtime?.lastError;
    return error ? new Error(error.message) : null;
}

export const storage = {
    async get(keys) {
        return (await call(raw.storage?.local, "get", keys)) ?? {};
    },
    async set(items) {
        return call(raw.storage?.local, "set", items);
    },
    async remove(keys) {
        return call(raw.storage?.local, "remove", keys);
    }
};

/**
 * Send a message and never hang. On Safari the background context can be torn
 * down between the send and the reply; without a timeout the UI simply stops,
 * which users report as a freeze and nobody can diagnose.
 *
 * @param {any} message
 * @param {number} [timeoutMs]
 */
export function sendMessage(message, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error("The extension's background task did not answer. Try again.")),
            timeoutMs
        );
        const settle = (fn) => (value) => {
            clearTimeout(timer);
            fn(value);
        };
        try {
            const result = raw.runtime.sendMessage(message, (reply) => {
                const error = lastError();
                if (error) settle(reject)(error);
                else settle(resolve)(reply);
            });
            if (result && typeof result.then === "function") {
                result.then(settle(resolve), settle(reject));
            }
        } catch (error) {
            clearTimeout(timer);
            reject(error);
        }
    });
}

/** Which engine are we on? Only used to explain capabilities to the user. */
export function detectEngine() {
    const ua = globalThis.navigator?.userAgent ?? "";
    if (typeof globalThis.browser !== "undefined" && /Gecko\/|Firefox/.test(ua)) return "gecko";
    if (/Chrome|Chromium|Edg\//.test(ua)) return "chromium";
    if (/Safari|AppleWebKit/.test(ua)) return "webkit";
    return "unknown";
}
