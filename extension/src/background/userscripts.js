/**
 * Keeping the browser's user-script registry in step with the installed skins.
 *
 * This is the Chromium path and only the Chromium path. Chromium refuses to
 * evaluate a string in a content script — measured, see caps.js — so a skin's
 * JavaScript can only run through `chrome.userScripts`, which takes code at
 * registration time and runs it in a world of its own. Registration also means
 * the browser handles `document_start` timing itself, which no message-passing
 * scheme can match.
 *
 * Everywhere else this module is a no-op and the content script runs skin JS
 * directly.
 *
 * @module background/userscripts
 */

import { api, call } from "../shared/api.js";
import { wrapForUserScriptWorld, registrationId, parseRegistrationId } from "../core/wrapper.js";
import { originPatterns } from "../core/target.js";
import { unionTargets, withDefaults } from "../core/skin.js";
import { readIndex, readSkins, readSettings, log } from "./store.js";

let configured = false;

/**
 * @param {import("../shared/protocol.js").Caps} caps
 */
export async function syncUserScripts(caps) {
    if (!caps?.userScriptsPermitted) return { registered: 0, skipped: "unavailable" };

    await configureWorld();

    const desired = await desiredRegistrations();
    const existing = await currentRegistrations();

    const wanted = new Map(desired.map((script) => [script.id, script]));
    const have = new Map(existing.map((script) => [script.id, script]));

    const toRemove = [...have.keys()].filter((id) => !wanted.has(id));
    const toAdd = desired.filter((script) => !have.has(script.id));
    // Everything still wanted is re-registered rather than diffed: comparing
    // generated source strings costs more than replacing them, and a stale
    // registration is a skin that silently runs last week's code.
    const toUpdate = desired.filter((script) => have.has(script.id));

    try {
        if (toRemove.length) await call(api.userScripts, "unregister", { ids: toRemove });
        if (toAdd.length) await call(api.userScripts, "register", toAdd);
        if (toUpdate.length) await call(api.userScripts, "update", toUpdate);
    } catch (error) {
        log({ skinId: "", level: "error", message: `Could not register skin scripts: ${error.message}` });
        return { registered: 0, error: error.message };
    }

    return { registered: desired.length };
}

/**
 * The world a skin's JavaScript runs in. `messaging: true` is what makes
 * `oriel.log`, `oriel.storage` and `oriel.fetch` reachable from inside it; the
 * generated wrapper in core/wrapper.js is built on `runtime.sendMessage` and
 * does nothing useful without this.
 */
async function configureWorld() {
    if (configured) return;
    try {
        await call(api.userScripts, "configureWorld", { messaging: true });
        configured = true;
    } catch {
        // Older builds have no configureWorld; registration still works,
        // messaging does not, and the skin's own errors will say so.
    }
}

async function desiredRegistrations() {
    const settings = await readSettings();
    if (!settings.enabled) return [];

    const index = await readIndex();
    const withJs = index.filter((entry) => entry.enabled && entry.hasJs);
    if (!withJs.length) return [];

    const bodies = await readSkins(withJs.map((entry) => entry.id));
    const registrations = [];

    for (const installed of bodies) {
        const { skin } = installed;
        const matches = originPatterns(unionTargets(skin));
        if (!matches.length) continue;
        const vars = withDefaults(skin.vars, installed.values);

        for (const unit of skin.js) {
            registrations.push({
                id: registrationId(skin.id, unit.id),
                matches,
                allFrames: Boolean(skin.allFrames) && settings.allowFrames,
                runAt: unit.runAt,
                world: unit.world === "main" ? "MAIN" : "USER_SCRIPT",
                js: [
                    {
                        code: wrapForUserScriptWorld({
                            skinId: skin.id,
                            name: skin.name,
                            code: unit.text,
                            vars,
                            assets: skin.assets
                        })
                    }
                ]
            });
        }
    }
    return registrations;
}

/**
 * What the browser thinks is registered. Only Oriel's own entries are touched —
 * an id we did not mint is not ours to unregister, even though in practice
 * nothing else shares this extension.
 */
async function currentRegistrations() {
    try {
        const scripts = (await call(api.userScripts, "getScripts", {})) ?? [];
        return scripts.filter((script) => parseRegistrationId(script.id));
    } catch {
        return [];
    }
}

/** Used when the master switch goes off, so nothing is left running. */
export async function unregisterAll() {
    const existing = await currentRegistrations();
    if (!existing.length) return;
    try {
        await call(api.userScripts, "unregister", { ids: existing.map((script) => script.id) });
    } catch {
        // Nothing to do about it, and nothing depends on it having worked.
    }
}
