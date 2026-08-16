/**
 * Everything persistent. One module so the storage shape has one owner.
 *
 * Layout (see KEY in shared/protocol.js):
 *
 *   index        one array, holding every skin's summary *and its raw target
 *                rules*. This is the hot read: answering "does anything apply
 *                to this URL?" must cost exactly one `storage.get`, because it
 *                happens at document_start on every page load and the answer is
 *                usually "no".
 *   skin:<id>    the body — CSS, DOM ops, script. Read only when something matched.
 *   values:<id>  the user's var choices, kept apart from the body so an update
 *                can replace the body without touching them.
 *   store:<id>   per-skin storage for skin JS.
 *   settings, log, caps
 *
 * @module background/store
 */

import { storage } from "../shared/api.js";
import { KEY, DEFAULT_SETTINGS } from "../shared/protocol.js";
import { summarize, unionTargets } from "../../../engine/core/skin.js";

/**
 * The index is read on every page load, so it is cached in memory and
 * invalidated on write. On a browser that evicts the background context the
 * cache simply starts cold again, which is correct and needs no special case.
 *
 * @type {IndexEntry[]|null}
 */
let cachedIndex = null;

/**
 * @typedef {import("../shared/protocol.js").SkinSummary & {
 *   rules: import("../../../engine/core/types.js").Targets,
 *   runAt: string,
 *   allFrames: boolean
 * }} IndexEntry
 */

export async function readIndex() {
    if (cachedIndex) return cachedIndex;
    const data = await storage.get(KEY.INDEX);
    cachedIndex = Array.isArray(data[KEY.INDEX]) ? data[KEY.INDEX] : [];
    return cachedIndex;
}

async function writeIndex(entries) {
    entries.sort((a, b) => a.order - b.order);
    cachedIndex = entries;
    await storage.set({ [KEY.INDEX]: entries });
}

export function invalidate() {
    cachedIndex = null;
}

/** @returns {Promise<import("../../../engine/core/types.js").InstalledSkin|null>} */
export async function readSkin(id) {
    const data = await storage.get([KEY.body(id), KEY.values(id)]);
    const skin = data[KEY.body(id)];
    if (!skin) return null;
    const entry = (await readIndex()).find((e) => e.id === id);
    return {
        skin,
        enabled: entry ? entry.enabled : true,
        order: entry ? entry.order : 0,
        values: data[KEY.values(id)] ?? {},
        installedAt: skin.installedAt ?? 0,
        updatedAt: skin.updatedAt ?? 0
    };
}

/** Read several bodies in one round trip. Order follows `ids`. */
export async function readSkins(ids) {
    if (!ids.length) return [];
    const keys = ids.flatMap((id) => [KEY.body(id), KEY.values(id)]);
    const data = await storage.get(keys);
    const index = await readIndex();
    return ids
        .map((id) => {
            const skin = data[KEY.body(id)];
            if (!skin) return null;
            const entry = index.find((e) => e.id === id);
            return {
                skin,
                enabled: entry ? entry.enabled : true,
                order: entry ? entry.order : 0,
                values: data[KEY.values(id)] ?? {},
                installedAt: skin.installedAt ?? 0,
                updatedAt: skin.updatedAt ?? 0
            };
        })
        .filter(Boolean);
}

/**
 * Install or replace. Var values survive a replacement — a user who spent time
 * tuning a skin's colours should not lose them because the author shipped a
 * patch release.
 *
 * @param {import("../../../engine/core/types.js").Skin} skin
 * @param {{enabled?: boolean, values?: object}} [state]
 */
export async function putSkin(skin, state = {}) {
    const index = await readIndex();
    const existing = index.find((e) => e.id === skin.id);
    const now = Date.now();

    const body = {
        ...skin,
        installedAt: existing ? existing.installedAt ?? now : now,
        updatedAt: now
    };

    const values = state.values ?? (await storage.get(KEY.values(skin.id)))[KEY.values(skin.id)] ?? {};
    const installed = {
        skin: body,
        enabled: state.enabled ?? existing?.enabled ?? true,
        order: existing?.order ?? nextOrder(index),
        values,
        installedAt: body.installedAt,
        updatedAt: now
    };

    const entry = {
        ...summarize(installed),
        rules: unionTargets(skin),
        runAt: skin.runAt,
        allFrames: skin.allFrames,
        installedAt: body.installedAt,
        updatedAt: now
    };

    await storage.set({ [KEY.body(skin.id)]: body, [KEY.values(skin.id)]: values });
    await writeIndex([...index.filter((e) => e.id !== skin.id), entry]);
    return installed;
}

function nextOrder(index) {
    return index.reduce((max, e) => Math.max(max, e.order ?? 0), -1) + 1;
}

export async function removeSkin(id) {
    const index = await readIndex();
    await storage.remove([KEY.body(id), KEY.values(id), KEY.store(id)]);
    await writeIndex(index.filter((e) => e.id !== id));
}

export async function setEnabled(id, enabled) {
    const index = await readIndex();
    const entry = index.find((e) => e.id === id);
    if (!entry) return false;
    entry.enabled = Boolean(enabled);
    await writeIndex(index);
    return true;
}

export async function setValues(id, values) {
    await storage.set({ [KEY.values(id)]: values });
    return true;
}

export async function readValues(id) {
    return (await storage.get(KEY.values(id)))[KEY.values(id)] ?? {};
}

/**
 * Order decides who wins a CSS conflict, so it is user-visible and must be
 * stable. Ids not mentioned keep their relative position after the ones that are.
 */
export async function reorder(ids) {
    const index = await readIndex();
    const rank = new Map(ids.map((id, i) => [id, i]));
    let tail = ids.length;
    for (const entry of index) {
        entry.order = rank.has(entry.id) ? rank.get(entry.id) : tail++;
    }
    await writeIndex(index);
}

export async function readSettings() {
    const data = await storage.get(KEY.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...(data[KEY.SETTINGS] ?? {}) };
}

export async function writeSettings(patch) {
    const settings = { ...(await readSettings()), ...patch };
    await storage.set({ [KEY.SETTINGS]: settings });
    return settings;
}

// --- the log ---------------------------------------------------------------

/**
 * A ring buffer, because the alternative on a phone is an array that grows
 * until storage fills up and every write starts failing for reasons the user
 * cannot see. Writes are batched: skin JS can log in a loop, and one
 * `storage.set` per line would be the slowest thing in the extension.
 */
let pending = [];
let flushTimer = null;

export function log(entry) {
    pending.push({ at: Date.now(), ...entry });
    if (flushTimer) return;
    flushTimer = setTimeout(flushLog, 400);
}

export async function flushLog() {
    flushTimer = null;
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    const { logLimit } = await readSettings();
    const data = await storage.get(KEY.LOG);
    const entries = [...(data[KEY.LOG] ?? []), ...batch];
    await storage.set({ [KEY.LOG]: entries.slice(-Math.max(50, logLimit)) });
}

export async function readLog({ skinId, limit = 200 } = {}) {
    await flushLog();
    const data = await storage.get(KEY.LOG);
    const entries = data[KEY.LOG] ?? [];
    const filtered = skinId ? entries.filter((e) => e.skinId === skinId) : entries;
    return filtered.slice(-limit).reverse();
}

export async function clearLog(skinId) {
    pending = pending.filter((e) => skinId && e.skinId !== skinId);
    if (!skinId) {
        await storage.set({ [KEY.LOG]: [] });
        return;
    }
    const data = await storage.get(KEY.LOG);
    await storage.set({ [KEY.LOG]: (data[KEY.LOG] ?? []).filter((e) => e.skinId !== skinId) });
}

// --- per-skin storage for skin JS -----------------------------------------

export async function skinStorage(id, op, key, value) {
    const bag = (await storage.get(KEY.store(id)))[KEY.store(id)] ?? {};
    if (op === "get") return key === undefined ? bag : bag[key];
    if (op === "keys") return Object.keys(bag);
    if (op === "set") bag[key] = value;
    else if (op === "delete") delete bag[key];
    else if (op === "clear") for (const k of Object.keys(bag)) delete bag[k];
    else return undefined;
    await storage.set({ [KEY.store(id)]: bag });
    return true;
}
