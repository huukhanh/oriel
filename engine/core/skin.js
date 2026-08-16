/**
 * The funnel. Four input formats go in — a UserCSS file, a `skin.json` bundle,
 * a plain stylesheet, a Tampermonkey userscript — and one {@link Skin} comes
 * out. Nothing downstream of this module knows which format a skin arrived in,
 * which is the only reason the rest of the extension is a manageable size.
 *
 * Pure: no storage, no network, no DOM. `skinFromBundle` takes a `readFile`
 * function rather than fetching, so the same code path serves an install from
 * GitHub, an import from a local authoring server, and a unit test.
 *
 * @module core/skin
 */

import { SkinParseError, RUN_AT } from "./types.js";
import { ruleFromString, compileTargets, describeTargets } from "./target.js";
import { isUserCss, parseUserCss } from "./usercss.js";
import { isUserScript, parseUserScript } from "./userscript.js";
import { normalizeVars, defaultValues, coerceValue, cssVariableBlock, substituteCss } from "./vars.js";
import { validateOps } from "./domops.js";
import { matchesTargets } from "./target.js";

const FORMATS = ["bundle", "usercss", "userscript", "css"];

/**
 * What is this text? Cheap and order-sensitive: a userscript may legally
 * contain CSS, and a UserCSS file may legally contain the string `==UserScript==`
 * inside a comment, so the structural markers are checked before the loose ones.
 *
 * @param {string} text
 * @returns {"bundle"|"usercss"|"userscript"|"css"|"unknown"}
 */
export function sniffFormat(text) {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) return "unknown";

    if (trimmed.startsWith("{")) {
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return "bundle";
        } catch {
            // A file that starts with `{` and is not JSON is a stylesheet whose
            // first rule lost its selector. Fall through and let CSS have it.
        }
    }
    if (isUserCss(trimmed)) return "usercss";
    if (isUserScript(trimmed)) return "userscript";
    if (looksLikeCss(trimmed)) return "css";
    return "unknown";
}

function looksLikeCss(text) {
    return /(^|\n)\s*(@(media|supports|import|font-face|-moz-document|charset|layer)\b|[.#:\[a-zA-Z*][^\n{};]{0,200}\{)/.test(
        text
    );
}

/**
 * Parse pasted or fetched text into a skin.
 *
 * Never throws for content reasons: a failure comes back as `{ skin: null,
 * errors }` with line numbers, because the install screen has to show the user
 * where the problem is and a thrown exception loses that.
 *
 * @param {string} text
 * @param {import("./types.js").Source} [source]
 * @param {{name?: string, format?: string}} [hint]
 * @returns {{skin: import("./types.js").Skin|null, errors: import("./types.js").SkinError[], warnings: string[]}}
 */
export function skinFromText(text, source = { kind: "paste" }, hint = {}) {
    const format = hint.format ?? sniffFormat(text);
    try {
        switch (format) {
            case "bundle":
                return fromBundleObject(JSON.parse(text), source);
            case "usercss":
                return fromUserCss(text, source);
            case "userscript":
                return fromUserScript(text, source);
            case "css":
                return fromPlainCss(text, source, hint);
            default:
                return fail("This does not look like a skin: no metadata block, no CSS, no JSON.");
        }
    } catch (error) {
        if (error instanceof SkinParseError) {
            return { skin: null, errors: [{ message: error.message, line: error.line, field: error.field }], warnings: [] };
        }
        return fail(`Could not parse: ${error.message}`);
    }
}

/**
 * Parse a bundle manifest whose `css`/`dom`/`js` entries may be file paths.
 *
 * @param {object} manifest
 * @param {import("./types.js").Source} source
 * @param {(path: string) => Promise<string>} readFile  Resolves a path relative to the manifest.
 */
export async function skinFromBundle(manifest, source, readFile) {
    const missing = [];
    const load = async (entry, field) => {
        if (entry && typeof entry === "object" && typeof entry.text === "string") return entry.text;
        if (typeof entry === "string" && !looksInline(entry)) {
            try {
                return await readFile(entry);
            } catch (error) {
                missing.push({ message: `${field}: could not read "${entry}" (${error.message})`, field });
                return null;
            }
        }
        return typeof entry === "string" ? entry : null;
    };

    const inlined = { ...manifest };
    inlined.css = [];
    for (const [i, entry] of asArray(manifest.css).entries()) {
        const text = await load(entry, `css[${i}]`);
        if (text !== null) inlined.css.push(entry && entry.targets ? { text, targets: entry.targets } : text);
    }
    inlined.js = [];
    for (const [i, entry] of asArray(manifest.js).entries()) {
        const spec = typeof entry === "string" ? { file: entry } : entry;
        const text = await load(spec.text !== undefined ? { text: spec.text } : spec.file, `js[${i}]`);
        if (text !== null) inlined.js.push({ ...spec, text, file: undefined });
    }
    if (manifest.dom !== undefined) {
        if (typeof manifest.dom === "string" && !manifest.dom.trim().startsWith("[")) {
            const text = await load(manifest.dom, "dom");
            inlined.dom = text === null ? [] : safeJson(text, "dom", missing);
        } else if (typeof manifest.dom === "string") {
            inlined.dom = safeJson(manifest.dom, "dom", missing);
        }
    }

    const result = fromBundleObject(inlined, source);
    result.errors.push(...missing);
    if (missing.length) result.skin = result.skin && { ...result.skin };
    return result;
}

function safeJson(text, field, sink) {
    try {
        return JSON.parse(text);
    } catch (error) {
        sink.push({ message: `${field}: ${error.message}`, field });
        return [];
    }
}

function looksInline(value) {
    return /[\n{};]/.test(value) || value.length > 512;
}

// --- format adapters -------------------------------------------------------

function fromBundleObject(manifest, source) {
    const errors = [];
    const warnings = [];

    if (!manifest.name) errors.push({ message: "A skin needs a name.", field: "name" });

    const include = asArray(manifest.matches).map((r) => safeRule(r, "matches", errors)).filter(Boolean);
    const exclude = asArray(manifest.excludes).map((r) => safeRule(r, "excludes", errors)).filter(Boolean);

    const sheets = asArray(manifest.css).map((entry, i) => {
        const text = typeof entry === "string" ? entry : entry?.text ?? "";
        const targets = entry && typeof entry === "object" && entry.targets ? normalizeTargets(entry.targets, errors) : undefined;
        return { id: `css${i}`, text, targets };
    });

    const scripts = asArray(manifest.js).map((entry, i) => normalizeScript(entry, i, warnings));
    const { ops, errors: opErrors } = validateOps(asArray(manifest.dom));
    errors.push(...opErrors);

    const { vars, errors: varErrors } = normalizeVars(asArray(manifest.vars));
    errors.push(...varErrors);

    const skin = assemble(
        {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            namespace: manifest.namespace,
            description: manifest.description,
            author: manifest.author,
            license: manifest.license,
            homepageURL: manifest.homepageURL,
            supportURL: manifest.supportURL,
            updateURL: manifest.updateURL ?? manifest.downloadURL,
            targets: { include, exclude },
            css: sheets,
            dom: ops,
            js: scripts,
            vars,
            assets: manifest.assets && typeof manifest.assets === "object" ? manifest.assets : undefined,
            runAt: manifest.runAt,
            allFrames: manifest.allFrames
        },
        source,
        warnings
    );

    return finish(skin, errors, warnings);
}

function fromUserCss(text, source) {
    const parsed = parseUserCss(text);
    const errors = [...(parsed.errors ?? [])];
    const warnings = [...(parsed.warnings ?? [])];

    // Each @-moz-document section keeps its own scope. A style with three
    // sections is one skin with three separately-targeted stylesheets, not
    // three skins and not one over-broad one.
    const sheets = (parsed.sections ?? []).map((section, i) => ({
        id: `css${i}`,
        text: section.css,
        targets: section.rules?.length ? { include: section.rules, exclude: [] } : undefined
    }));

    const meta = parsed.meta ?? {};
    const skin = assemble(
        {
            id: meta.id,
            name: parsed.name ?? meta.name,
            version: parsed.version ?? meta.version,
            namespace: parsed.namespace ?? meta.namespace,
            description: parsed.description ?? meta.description,
            author: parsed.author ?? meta.author,
            license: parsed.license ?? meta.license,
            homepageURL: parsed.homepageURL ?? meta.homepageURL,
            supportURL: parsed.supportURL ?? meta.supportURL,
            updateURL: parsed.updateURL ?? meta.updateURL ?? meta.downloadURL,
            targets: parsed.targets ?? { include: [], exclude: [] },
            css: sheets,
            dom: parsed.dom ?? [],
            js: parsed.js ?? [],
            vars: parsed.vars ?? [],
            runAt: parsed.runAt,
            allFrames: parsed.allFrames
        },
        source,
        warnings
    );

    return finish(skin, errors, warnings);
}

function fromUserScript(text, source) {
    const parsed = parseUserScript(text);
    const errors = [...(parsed.errors ?? [])];
    const warnings = [...(parsed.warnings ?? [])];

    warnings.push(
        "Installed as a userscript. Oriel runs it where the browser allows user code; " +
            "on platforms that do not, it will be suspended and the skin's CSS still applies."
    );

    const skin = assemble(
        {
            name: parsed.name,
            version: parsed.version,
            namespace: parsed.namespace,
            description: parsed.description,
            author: parsed.author,
            license: parsed.license,
            homepageURL: parsed.homepageURL,
            supportURL: parsed.supportURL,
            updateURL: parsed.updateURL ?? parsed.downloadURL,
            targets: parsed.targets,
            css: [],
            dom: [],
            js: [{ id: "js0", text: parsed.body, world: parsed.world, runAt: parsed.runAt }],
            vars: [],
            runAt: parsed.runAt,
            allFrames: parsed.allFrames
        },
        source,
        warnings
    );

    return finish(skin, errors, warnings);
}

/**
 * A bare stylesheet. There is no metadata to read, so the scope has to come
 * from somewhere the user chose deliberately — the site they were on when they
 * pasted it, or an explicit hint. Guessing `<all_urls>` here would be the
 * single worst default in the product.
 */
function fromPlainCss(text, source, hint) {
    const errors = [];
    const warnings = ["Plain CSS has no metadata, so Oriel could not tell what site it is for."];
    const include = [];

    if (hint.match) include.push(safeRule(hint.match, "match", errors));
    else errors.push({ message: "Choose which sites this stylesheet applies to before installing.", field: "matches" });

    const skin = assemble(
        {
            name: hint.name || "Untitled stylesheet",
            version: "0.0.0",
            targets: { include: include.filter(Boolean), exclude: [] },
            css: [{ id: "css0", text }],
            dom: [],
            js: [],
            vars: []
        },
        source,
        warnings
    );

    return finish(skin, errors, warnings);
}

// --- assembly --------------------------------------------------------------

function assemble(partial, source, warnings) {
    const runAt = RUN_AT.includes(partial.runAt) ? partial.runAt : "document_start";
    const name = String(partial.name || "").trim() || "Untitled skin";

    return {
        format: 1,
        id: normalizeId(partial.id) || deriveId(partial.namespace, name),
        name,
        version: String(partial.version || "0.0.0").trim(),
        namespace: partial.namespace,
        description: partial.description,
        author: partial.author,
        license: partial.license,
        homepageURL: partial.homepageURL,
        supportURL: partial.supportURL,
        updateURL: partial.updateURL,
        targets: {
            include: partial.targets?.include ?? [],
            exclude: partial.targets?.exclude ?? []
        },
        css: partial.css ?? [],
        dom: partial.dom ?? [],
        js: (partial.js ?? []).map((unit, i) => ({
            id: unit.id ?? `js${i}`,
            text: unit.text ?? "",
            world: unit.world === "main" ? "main" : "isolated",
            runAt: RUN_AT.includes(unit.runAt) ? unit.runAt : runAt
        })),
        vars: partial.vars ?? [],
        assets: partial.assets,
        runAt,
        allFrames: Boolean(partial.allFrames),
        source,
        warnings
    };
}

/**
 * A skin with nothing in it, or with nowhere to apply, is not installable.
 * Both checks live here so every format gets them identically.
 */
function finish(skin, errors, warnings) {
    if (skin) {
        const compiled = compileTargets(skin.targets);
        for (const error of compiled.errors ?? []) errors.push(error);

        const sectionScoped = skin.css.some((sheet) => sheet.targets?.include?.length);
        if (!skin.targets.include.length && !sectionScoped) {
            errors.push({
                message: "This skin does not say which sites it applies to. Add a @match or an @-moz-document section.",
                field: "matches"
            });
        }
        if (!skin.css.length && !skin.dom.length && !skin.js.length) {
            errors.push({ message: "This skin is empty — no CSS, no DOM operations, no script.", field: "css" });
        }
    }
    return { skin: errors.length ? null : skin, errors, warnings, parsed: skin };
}

function fail(message) {
    return { skin: null, errors: [{ message }], warnings: [], parsed: null };
}

function safeRule(raw, field, errors) {
    try {
        return ruleFromString(raw);
    } catch (error) {
        errors.push({ message: `${field}: ${error.message}`, field });
        return null;
    }
}

function normalizeTargets(targets, errors) {
    return {
        include: asArray(targets.include).map((r) => safeRule(r, "targets.include", errors)).filter(Boolean),
        exclude: asArray(targets.exclude).map((r) => safeRule(r, "targets.exclude", errors)).filter(Boolean)
    };
}

function normalizeScript(entry, i, warnings) {
    const spec = typeof entry === "string" ? { text: entry } : entry ?? {};
    if (spec.world && !["main", "isolated"].includes(spec.world)) {
        warnings.push(`js[${i}]: unknown world "${spec.world}", running isolated.`);
    }
    return {
        id: spec.id ?? `js${i}`,
        text: spec.text ?? "",
        world: spec.world === "main" ? "main" : "isolated",
        runAt: RUN_AT.includes(spec.runAt) ? spec.runAt : "document_end"
    };
}

function asArray(value) {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

/** Slug rules from docs/SKIN-FORMAT.md §2. */
export function normalizeId(id) {
    if (typeof id !== "string") return "";
    const slug = id
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);
    return /^[a-z0-9]/.test(slug) ? slug : "";
}

/**
 * A stable id from namespace + name, so re-installing the same skin from a
 * different URL replaces it instead of producing a duplicate the user has to
 * reconcile by hand.
 */
export function deriveId(namespace, name) {
    const base = normalizeId(`${namespace ? `${namespace}-` : ""}${name}`) || "skin";
    return `${base}-${hash(`${namespace ?? ""} ${name}`)}`;
}

/** FNV-1a. Not a security primitive — it only has to be stable and short. */
function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36).padStart(7, "0").slice(0, 7);
}

// --- consumption -----------------------------------------------------------

/**
 * Everything the UI needs to draw a row, without loading the skin's body.
 *
 * @param {import("./types.js").InstalledSkin} installed
 * @returns {import("../shared/protocol.js").SkinSummary}
 */
export function summarize(installed) {
    const { skin } = installed;
    return {
        id: skin.id,
        name: skin.name,
        version: skin.version,
        author: skin.author,
        description: skin.description,
        enabled: installed.enabled !== false,
        order: installed.order ?? 0,
        targets: describeTargets(unionTargets(skin)),
        cssBytes: skin.css.reduce((n, sheet) => n + sheet.text.length, 0),
        hasJs: skin.js.length > 0,
        hasDom: skin.dom.length > 0,
        varCount: skin.vars.length,
        updateURL: skin.updateURL,
        homepageURL: skin.homepageURL,
        source: skin.source,
        warnings: skin.warnings ?? []
    };
}

/**
 * The skin's whole reach: its own rules plus every section's. Used for the
 * summary line and for deciding which origins to ask permission for.
 */
export function unionTargets(skin) {
    const include = [...skin.targets.include];
    const exclude = [...skin.targets.exclude];
    for (const sheet of skin.css) {
        if (sheet.targets?.include) include.push(...sheet.targets.include);
        if (sheet.targets?.exclude) exclude.push(...sheet.targets.exclude);
    }
    return { include, exclude };
}

/** Does this skin apply to this URL at all? Section scoping is checked later. */
export function skinMatches(skin, url) {
    return matchesTargets(unionTargets(skin), url);
}

/**
 * Reduce an installed skin to exactly what the content script needs for one
 * URL: the sheets whose own scope matches, with variables substituted, plus
 * the `:root` block that lets a var change without re-injecting anything.
 *
 * @param {import("./types.js").InstalledSkin} installed
 * @param {string} url
 * @returns {import("../shared/protocol.js").AppliedSkin|null}
 */
export function resolveForPage(installed, url) {
    const { skin } = installed;
    if (!skinMatches(skin, url)) return null;

    const values = withDefaults(skin.vars, installed.values);
    const css = [];
    for (const sheet of skin.css) {
        if (sheet.targets && !matchesTargets(sheet.targets, url)) continue;
        css.push({ id: sheet.id, text: substituteCss(sheet.text, skin.vars, values) });
    }

    // A skin whose only sheets are section-scoped and whose sections all miss
    // still counts as matching if it has DOM ops or script; otherwise it has
    // nothing to contribute and is left out so the page does no work.
    if (!css.length && !skin.dom.length && !skin.js.length) return null;

    return {
        id: skin.id,
        name: skin.name,
        rev: installed.updatedAt ?? 0,
        css,
        dom: skin.dom,
        js: skin.js,
        vars: values,
        varBlock: skin.vars.length ? cssVariableBlock(skin.vars, values) : "",
        runAt: skin.runAt,
        assets: skin.assets
    };
}

/** User choices layered over declared defaults, with anything invalid dropped. */
export function withDefaults(vars, values) {
    const result = defaultValues(vars);
    for (const v of vars) {
        if (values && Object.hasOwn(values, v.key)) result[v.key] = coerceValue(v, values[v.key]);
    }
    return result;
}

/**
 * A self-contained file the user can paste anywhere, including back into
 * Oriel. Bundles export as JSON with everything inlined; a single-section
 * UserCSS skin exports as UserCSS, because that is what its author will want
 * to commit.
 *
 * @param {import("./types.js").InstalledSkin} installed
 * @param {(skin: import("./types.js").Skin) => string} [toUserCss]
 */
export function exportSkin(installed, toUserCss) {
    const { skin } = installed;
    const simple = skin.js.length === 0 && skin.dom.length === 0;
    if (simple && toUserCss) {
        return { text: toUserCss(skin), filename: `${skin.id}.user.css` };
    }
    const manifest = {
        format: 1,
        id: skin.id,
        name: skin.name,
        version: skin.version,
        namespace: skin.namespace,
        description: skin.description,
        author: skin.author,
        license: skin.license,
        homepageURL: skin.homepageURL,
        supportURL: skin.supportURL,
        updateURL: skin.updateURL,
        matches: skin.targets.include,
        excludes: skin.targets.exclude,
        runAt: skin.runAt,
        allFrames: skin.allFrames,
        css: skin.css.map((s) => (s.targets ? { text: s.text, targets: s.targets } : { text: s.text })),
        dom: skin.dom,
        js: skin.js.map((u) => ({ text: u.text, world: u.world, runAt: u.runAt })),
        vars: skin.vars,
        assets: skin.assets
    };
    for (const key of Object.keys(manifest)) if (manifest[key] === undefined) delete manifest[key];
    return { text: JSON.stringify(manifest, null, 2) + "\n", filename: `${skin.id}.skin.json` };
}

export { FORMATS };
