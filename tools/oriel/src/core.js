/**
 * The single seam between this CLI and extension/src/core/. Everything else
 * in this tool calls `loadCore()` and uses the result — never imports
 * extension/src/core/* directly — so that when those modules land (or
 * change), nothing outside this file has to.
 *
 * Each of the five modules is imported dynamically and independently. One
 * that is missing, incomplete, or throws while loading falls back to the
 * matching export in core-fallback.js, and prints a one-time warning. A
 * module that imports fine is used as-is, in full, even while its siblings
 * are still falling back.
 *
 * @module core
 */

import { pathToFileURL } from "node:url";
import path from "node:path";
import * as fallback from "./core-fallback.js";
import { log } from "./log.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
export const EXTENSION_CORE_DIR = path.join(REPO_ROOT, "extension/src/core");

const MODULES = {
    target: ["compileTargets", "ruleFromString", "describeTargets"],
    usercss: ["parseUserCss", "isUserCss"],
    domops: ["validateOps"],
    vars: ["normalizeVars", "defaultValues"],
    types: ["SkinParseError", "RUN_AT", "RULE_KINDS", "VAR_TYPES"]
};

let warnedOnce = false;
function warnFallback(name, reason) {
    if (warnedOnce) return;
    warnedOnce = true;
    log.warn(`extension/src/core/${name}.js not usable yet (${reason}) — using oriel-cli's built-in validator. Re-run once it lands.`);
}

async function tryLoad(name, exports) {
    const file = path.join(EXTENSION_CORE_DIR, `${name}.js`);
    try {
        const mod = await import(pathToFileURL(file).href);
        for (const key of exports) {
            if (!(key in mod)) throw new Error(`missing export "${key}"`);
        }
        return mod;
    } catch (err) {
        warnFallback(name, err.code === "ERR_MODULE_NOT_FOUND" ? "not written yet" : err.message);
        return null;
    }
}

/**
 * A single-rule compiler, built on top of whichever `compileTargets` got
 * loaded. The real module and the fallback disagree on how a bad rule is
 * reported — the real one never throws and collects `errors`, the fallback
 * throws on the first bad rule — so this is the one place that difference is
 * absorbed. Every caller in this CLI gets the throwing contract.
 */
function makeCompileRule(compileTargets) {
    return (rule) => {
        const compiled = compileTargets({ include: [rule], exclude: [] });
        if (compiled.errors && compiled.errors.length) {
            throw new Error(compiled.errors[0].message);
        }
        return compiled;
    };
}

async function build() {
    const core = { usingFallback: new Set() };
    for (const [name, exports] of Object.entries(MODULES)) {
        const mod = await tryLoad(name, exports);
        if (!mod) core.usingFallback.add(name);
        for (const key of exports) core[key] = mod ? mod[key] : fallback[key];
    }
    core.compileRule = makeCompileRule(core.compileTargets);
    return core;
}

let corePromise;
/** Cached: every command in one process run shares one resolution. */
export function loadCore() {
    corePromise ??= build();
    return corePromise;
}
