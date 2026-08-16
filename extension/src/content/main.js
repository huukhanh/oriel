/**
 * The engine. Runs at document_start in every frame, on every page.
 *
 * On most pages nothing applies, so the whole file is arranged around making
 * that case cost one message and nothing else. When something does apply, the
 * order is: variables, then stylesheets, then DOM operations, then script —
 * because each step is more expensive and more likely to fail than the one
 * before it, and a skin whose script throws should still have restyled the page.
 *
 * @module content/main
 */

import { api, sendMessage } from "../shared/api.js";
import { PAGE, EVENT } from "../shared/protocol.js";
import { createRunner } from "../core/domops.js";
import { createStyleHost } from "./styles.js";
import { createOrielApi } from "./oriel-api.js";

/** Live skins, by id. */
const active = new Map();

/** The revision of the last reply applied. A stale reply arriving second would undo a fresh one. */
let appliedRevision = 0;

let currentUrl = location.href;
let caps = null;

const send = (type, payload = {}) => sendMessage({ type, ...payload });
const styles = createStyleHost(send);

/**
 * Whether this world can evaluate a string. Chromium says no — its extension
 * CSP applies to content scripts, so `new Function` throws here even though the
 * page's own CSP is irrelevant. Other engines say yes. Measuring beats
 * guessing, and the answer travels to the background so Settings can explain
 * itself.
 */
function probe() {
    let functionConstructor = false;
    try {
        functionConstructor = new Function("return 1")() === 1;
    } catch {
        functionConstructor = false;
    }
    return { functionConstructor };
}

async function hello(type = PAGE.HELLO) {
    const reply = await send(type, { url: location.href, top: window === window.top, probe: probe() });
    if (!reply || reply.error) return null;
    if (reply.caps) caps = reply.caps;
    if (typeof reply.revision === "number" && reply.revision < appliedRevision) return null;
    appliedRevision = reply.revision ?? appliedRevision;
    return reply;
}

async function applyAll(skins) {
    const wanted = new Map(skins.map((skin) => [skin.id, skin]));

    // Off first. A skin that no longer matches must be gone before the next one
    // paints, or the user sees two skins fighting for a frame.
    for (const id of [...active.keys()]) {
        if (!wanted.has(id)) await deactivate(id);
    }

    for (const skin of skins) {
        const existing = active.get(skin.id);
        if (existing && existing.rev === skin.rev) {
            await refreshVars(skin);
            continue;
        }
        if (existing) await deactivate(skin.id);
        await activate(skin);
    }
}

async function activate(skin) {
    const record = { rev: skin.rev, runner: null, oriel: null, sheetKeys: [] };
    active.set(skin.id, record);

    if (skin.varBlock) {
        const key = `${skin.id}:vars`;
        record.sheetKeys.push(key);
        await styles.add(key, skin.varBlock);
    }
    for (const sheet of skin.css) {
        const key = `${skin.id}:${sheet.id}`;
        record.sheetKeys.push(key);
        await styles.add(key, sheet.text);
    }

    if (skin.dom?.length) {
        try {
            record.runner = createRunner(skin.dom, {
                document,
                vars: skin.vars,
                viewportWidth: window.innerWidth,
                log: (message) => report(skin.id, "warn", message)
            });
            record.runner.start();
        } catch (error) {
            report(skin.id, "error", `Layout operations failed: ${error.message}`);
        }
    }

    if (skin.js?.length) await runScripts(skin, record);
    markApplied();
}

/**
 * A list of what is live, on the root element. It is how the end-to-end tests
 * know a skin has landed, and it is the first thing to look at when someone
 * reports that a skin "isn't working" — `document.documentElement.dataset` says
 * whether Oriel thinks it applied, which splits the problem in half.
 */
function markApplied() {
    const ids = [...active.keys()];
    if (ids.length) document.documentElement.setAttribute("data-oriel-applied", ids.join(" "));
    else document.documentElement.removeAttribute("data-oriel-applied");
}

/**
 * Skin JavaScript, where this browser allows it.
 *
 * `userScripts` is not handled here at all — in that mode the browser has
 * already registered and run the code itself, with correct document_start
 * timing that no message round trip could match. This path is the other one.
 */
async function runScripts(skin, record) {
    if (caps?.js === "userScripts") return;

    if (caps?.js !== "function") {
        report(
            skin.id,
            "warn",
            "This browser does not let extensions run code they downloaded, so this skin's JavaScript is suspended. Its CSS and layout changes still apply."
        );
        return;
    }

    const { api: oriel, emit, destroy } = createOrielApi({
        skin,
        send,
        addSheet: (text) => {
            const key = `${skin.id}:js:${record.sheetKeys.length}`;
            record.sheetKeys.push(key);
            styles.add(key, text);
            return { remove: () => styles.remove(key) };
        }
    });
    record.oriel = { emit, destroy };

    for (const unit of skin.js) {
        if (unit.world === "main") {
            report(skin.id, "warn", `"${unit.id}" asks to run in the page's own world, which is not available here.`);
            continue;
        }
        await atRunAt(unit.runAt);
        try {
            // Indirect construction, so a bundler cannot see a direct `Function`
            // reference and a reviewer can see exactly where user code enters.
            const factory = new Function("oriel", `"use strict";\n${unit.text}\n//# sourceURL=oriel/${skin.id}/${unit.id}.js`);
            factory(oriel);
        } catch (error) {
            report(skin.id, "error", error.stack || String(error));
        }
    }
}

function atRunAt(runAt) {
    if (runAt === "document_start" || document.readyState === "complete") return Promise.resolve();
    if (runAt === "document_end" && document.readyState !== "loading") return Promise.resolve();
    return new Promise((resolve) => {
        if (runAt === "document_idle") {
            if (document.readyState === "complete") resolve();
            else addEventListener("load", () => resolve(), { once: true });
            return;
        }
        if (document.readyState === "loading") {
            addEventListener("DOMContentLoaded", () => resolve(), { once: true });
        } else resolve();
    });
}

async function deactivate(id) {
    const record = active.get(id);
    if (!record) return;
    active.delete(id);
    record.oriel?.destroy();
    record.runner?.stop();
    record.runner?.undo();
    for (const key of record.sheetKeys) await styles.remove(key);
    // The user-script world holds its own cleanup handlers and has no reference
    // back here; a document event is the only channel that reaches it.
    dispatchEvent(new CustomEvent(`oriel:cleanup:${id}`));
    markApplied();
}

/** A var moved. Swap the `:root` block and tell the skin, without touching anything else. */
async function refreshVars(skin) {
    const record = active.get(skin.id);
    if (!record) return;
    record.rev = skin.rev;
    if (skin.varBlock) await styles.add(`${skin.id}:vars`, skin.varBlock);
    record.oriel?.emit("vars", skin.vars);
}

function report(skinId, level, message) {
    send(PAGE.LOG, { skinId, level, message }).catch(() => {});
}

// --- single-page apps ------------------------------------------------------

/**
 * Noticing that a single-page app changed route.
 *
 * The obvious approach — wrap `history.pushState` — does not work from a
 * content script, and the way it fails is quiet. A content script runs in an
 * isolated world with its own global scope, so the `pushState` it replaces is
 * not the one the page calls. Measured in Chromium: the patch installs, the
 * page navigates, and nothing fires. Any implementation that only does this
 * looks right and silently never tears a skin down.
 *
 * So there are three sources, and the first one to notice wins:
 *
 *   1. `popstate` and `hashchange`, which are real events and cross worlds.
 *   2. The background, via `webNavigation.onHistoryStateUpdated` — instant and
 *      free where it exists. Safari's support is unverified.
 *   3. A poll. Unfashionable, and the only thing guaranteed to work everywhere;
 *      one string comparison every 300ms is not a cost worth optimising away
 *      when the alternative is a skin that will not come off.
 *
 * The `history` patch is kept anyway, because it does work for the one caller
 * that shares this world: a skin's own JavaScript.
 */
function watchNavigation() {
    for (const name of ["pushState", "replaceState"]) {
        const original = history[name];
        if (typeof original !== "function") continue;
        history[name] = function (...args) {
            const result = original.apply(this, args);
            announce();
            return result;
        };
    }

    addEventListener("popstate", announce);
    addEventListener("hashchange", announce);

    // Deliberately not cleared: a page that has no skins now may match after
    // the next route change, so there is nothing to stop polling for.
    setInterval(announce, 300);
}

function announce() {
    if (location.href === currentUrl) return;
    currentUrl = location.href;
    queueMicrotask(reevaluate);
}

async function reevaluate() {
    const reply = await hello(PAGE.NAVIGATED);
    if (reply) await applyAll(reply.skins ?? []);
}

// --- messages from the background ------------------------------------------

api.runtime?.onMessage?.addListener((message) => {
    if (message?.type === EVENT.CHANGED) {
        reevaluate();
    } else if (message?.type === EVENT.VALUES) {
        // The values are authoritative but the substituted CSS is not here, so
        // ask for the resolved skin rather than trying to patch it locally.
        reevaluate();
    }
    return false;
});

// --- boot ------------------------------------------------------------------

(async function start() {
    watchNavigation();
    try {
        const reply = await hello();
        if (reply?.skins?.length) await applyAll(reply.skins);
    } catch {
        // The background may not be up yet on a cold start. The navigation
        // patch is already in place, so the next route change recovers, and a
        // failed handshake must never break the page.
    }
})();
