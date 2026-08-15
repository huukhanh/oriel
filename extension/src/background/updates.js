/**
 * Update checking.
 *
 * The rule that governs this file: **Oriel never silently installs code the
 * user has not seen change.** A check reports; the user applies. A skin is
 * arbitrary CSS and JavaScript running on the sites they care about, and an
 * auto-updater for that is a supply-chain hole with a friendly name.
 *
 * Checks go to `raw.githubusercontent.com`, never `api.github.com`: the
 * unauthenticated API allows 60 requests an hour per IP, and a user with
 * fifteen skins would burn that in four checks.
 *
 * @module background/updates
 */

import { isNewer } from "../core/version.js";
import { sniffFormat } from "../core/skin.js";
import { readIndex, readSkin, readSettings, log } from "./store.js";
import { importFromLocator } from "./install.js";

/** Enough of a fetched file to read its version, without holding the whole thing. */
const HEAD_BYTES = 8192;

/**
 * @param {string[]} [ids]
 * @returns {Promise<import("../shared/protocol.js").UpdateCheck[]>}
 */
export async function checkUpdates(ids) {
    const index = await readIndex();
    const targets = index.filter((entry) => (ids ? ids.includes(entry.id) : true));
    const results = [];

    for (const entry of targets) {
        if (!entry.updateURL) {
            results.push({ id: entry.id, status: "unversioned", message: "No update URL." });
            continue;
        }
        try {
            const remote = await remoteVersion(entry.updateURL);
            if (!remote) {
                results.push({ id: entry.id, status: "unversioned", message: "Could not read a version from that URL." });
            } else if (isNewer(remote, entry.version)) {
                results.push({ id: entry.id, status: "available", version: remote });
            } else {
                results.push({ id: entry.id, status: "none", version: remote });
            }
        } catch (error) {
            results.push({ id: entry.id, status: "error", message: error.message });
        }
    }

    await recordCheck();
    return results;
}

/**
 * Fetch just enough of the file to read its version. A `Range` request is a
 * courtesy that most static hosts honour and none mind; when it is ignored the
 * body is truncated here instead.
 */
async function remoteVersion(url) {
    const response = await fetch(url, {
        credentials: "omit",
        headers: { Range: `bytes=0-${HEAD_BYTES}`, Accept: "text/plain, application/json, */*" }
    });
    if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`);
    const text = (await response.text()).slice(0, HEAD_BYTES);

    if (sniffFormat(text) === "bundle") {
        try {
            return JSON.parse(text).version ?? null;
        } catch {
            // Truncated JSON. Fall through to the regex, which does not care.
        }
    }
    const match = /^[\s/*]*@version\s+(\S+)\s*$/m.exec(text) || /"version"\s*:\s*"([^"]+)"/.exec(text);
    return match ? match[1] : null;
}

/**
 * Install a checked update. Re-runs the whole import path rather than patching
 * the stored object, so a new version that changed format, gained a section, or
 * broke its own metadata is caught by the same parser that would have caught it
 * on a fresh install.
 */
export async function applyUpdate(id) {
    const existing = await readSkin(id);
    if (!existing) return { ok: false, errors: [{ message: "That skin is no longer installed." }], warnings: [] };
    if (!existing.skin.updateURL) {
        return { ok: false, errors: [{ message: "That skin has no update URL." }], warnings: [] };
    }

    const reply = await importFromLocator(existing.skin.updateURL);
    if (!reply.ok) return reply;

    // The import gave the incoming skin whatever id its own metadata implies.
    // It is an update to *this* skin, so it keeps this id, this enabled state
    // and these var values.
    if (reply.summary && reply.summary.id !== id) {
        const { putSkin, removeSkin } = await import("./store.js");
        const fresh = await readSkin(reply.summary.id);
        if (fresh) {
            await removeSkin(reply.summary.id);
            fresh.skin.id = id;
            await putSkin(fresh.skin, { enabled: existing.enabled, values: existing.values });
        }
    }

    log({ skinId: id, level: "info", message: `Updated to ${reply.summary?.version ?? "a new version"}` });
    return reply;
}

/**
 * Run a scheduled check if one is due. Called when a UI page opens rather than
 * from a timer: Safari on iOS gives no dependable background scheduling, and a
 * check that only happens while the user is looking at Oriel is both sufficient
 * and easier to reason about than one that fires unpredictably.
 */
export async function checkIfDue() {
    const settings = await readSettings();
    if (settings.updateCheck === "never") return null;

    const period = settings.updateCheck === "daily" ? 864e5 : 6048e5;
    const { lastUpdateCheck = 0 } = settings;
    if (Date.now() - lastUpdateCheck < period) return null;

    return checkUpdates();
}

async function recordCheck() {
    const { writeSettings } = await import("./store.js");
    await writeSettings({ lastUpdateCheck: Date.now() });
}
