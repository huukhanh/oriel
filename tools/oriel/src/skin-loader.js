/**
 * Reads a skin off disk — a `skin.json` bundle directory or a single
 * `*.user.css` file — into one normalized shape that check/dev/bundle/publish
 * all share, collecting diagnostics with real line numbers as it goes rather
 * than throwing on the first problem. Only a fatal parse (invalid JSON, a
 * malformed UserCSS header) short-circuits; everything else is a diagnostic
 * and loading continues so `check` can report more than one problem per run.
 *
 * @module skin-loader
 */

import { readFile, readdir, stat, access } from "node:fs/promises";
import path from "node:path";
import { lineAt, lineFromJsonError, indexJsonLines } from "./textpos.js";

const VAR_REF = /\/\*\[\[([a-zA-Z0-9_-]+)\]\]\*\//g;
const JS_WORLDS = ["isolated", "main"];

function relOf(p) {
    const r = path.relative(process.cwd(), p);
    return r === "" ? path.basename(p) : r;
}

async function fileExists(p) {
    try { await access(p); return true; } catch { return false; }
}

/** Locates the skin.json or *.user.css that a path (file or dir) names. */
export async function findSkinEntry(inputPath) {
    const resolved = path.resolve(inputPath);
    const st = await stat(resolved).catch(() => null);
    if (!st) throw new Error(`no such file or directory: ${inputPath}`);

    if (st.isFile()) {
        const kind = resolved.endsWith(".json") ? "bundle" : "usercss";
        return { kind, mainPath: resolved, dir: path.dirname(resolved) };
    }

    const entries = await readdir(resolved);
    if (entries.includes("skin.json")) {
        return { kind: "bundle", mainPath: path.join(resolved, "skin.json"), dir: resolved };
    }
    const userCssFiles = entries.filter((f) => f.endsWith(".user.css"));
    if (userCssFiles.length === 1) {
        return { kind: "usercss", mainPath: path.join(resolved, userCssFiles[0]), dir: resolved };
    }
    if (userCssFiles.length > 1) {
        throw new Error(`${inputPath}: more than one *.user.css file — pass the file itself`);
    }
    throw new Error(`${inputPath}: no skin.json and no *.user.css file`);
}

function toRuleList(arr, core) {
    return (arr ?? []).map((item) => (typeof item === "string" ? core.ruleFromString(item) : item));
}

function resolveTargets(raw, core) {
    if (!raw) return undefined;
    return { include: toRuleList(raw.matches, core), exclude: toRuleList(raw.excludes, core) };
}

function hasRules(targets) {
    return Boolean(targets && ((targets.include && targets.include.length) || (targets.exclude && targets.exclude.length)));
}

/** Reads a css/dom/js entry that may be a bare path, `{text}`, or `{[pathKey]}`. */
async function resolveTextSource(item, dir, pathKey, files, pushFn, field) {
    let sourcePath = null;
    let text;
    if (typeof item === "string") {
        sourcePath = path.resolve(dir, item);
    } else if (item && typeof item === "object" && typeof item.text === "string") {
        text = item.text;
    } else if (item && typeof item === "object" && typeof item[pathKey] === "string") {
        sourcePath = path.resolve(dir, item[pathKey]);
    } else {
        pushFn(`must be a path string, {${pathKey}}, or {text}`, field);
        return null;
    }
    if (sourcePath) {
        files.add(sourcePath);
        try {
            text = await readFile(sourcePath, "utf8");
        } catch {
            pushFn(`referenced file does not exist: ${path.relative(dir, sourcePath)}`, field);
            return null;
        }
    }
    return { text, sourcePath };
}

function scanCssVarRefs(localText, declared, filePath, diagnostics, lineOf) {
    VAR_REF.lastIndex = 0;
    let m;
    while ((m = VAR_REF.exec(localText))) {
        if (!declared.has(m[1])) {
            diagnostics.push({
                path: filePath,
                line: lineOf(m.index),
                message: `CSS references var "${m[1]}" which is not declared`,
                severity: "error"
            });
        }
    }
}

function compileEachRule(core, rules, onError) {
    for (const rule of rules) {
        try {
            core.compileRule(rule);
        } catch (err) {
            onError(err, rule);
        }
    }
}

/**
 * `core.normalizeVars` (real or fallback) validates a var's shape but not
 * whether its own default fits its own min/max/options — see
 * core-fallback.js's comment on `normalizeVars`. This is checked here,
 * once, on the normalized array, regardless of which produced it.
 *
 * @returns {{message:string, field:string}[]}
 */
function checkVarBounds(vars) {
    const errors = [];
    (vars ?? []).forEach((v, i) => {
        if (!v || !v.key) return;
        const field = `vars[${i}]`;
        if (v.type === "number" || v.type === "range") {
            const def = Number(v.default);
            if (Number.isFinite(v.min) && def < v.min) {
                errors.push({ message: `${field}: default ${v.default} is below min ${v.min}`, field });
            } else if (Number.isFinite(v.max) && def > v.max) {
                errors.push({ message: `${field}: default ${v.default} is above max ${v.max}`, field });
            }
        }
        if ((v.type === "select" || v.type === "image") && Array.isArray(v.options) && v.options.length) {
            if (!v.options.some((o) => o.key === v.default)) {
                errors.push({ message: `${field}: default "${v.default}" is not one of the declared options`, field });
            }
        }
    });
    return errors;
}

function emptyLoaded(kind, entry, diagnostics, files) {
    return {
        kind, dir: entry.dir, mainPath: entry.mainPath, id: undefined, name: undefined, version: undefined,
        namespace: undefined, description: undefined, author: undefined, license: undefined,
        homepageURL: undefined, updateURL: undefined,
        targets: { include: [], exclude: [] }, sheets: [], dom: null, js: [], vars: [], assets: {},
        diagnostics, files, broken: true
    };
}

async function loadBundle(entry, core) {
    const diagnostics = [];
    const files = new Set([entry.mainPath]);
    const mainRel = relOf(entry.mainPath);
    const rawText = await readFile(entry.mainPath, "utf8");

    let doc;
    try {
        doc = JSON.parse(rawText);
    } catch (err) {
        diagnostics.push({ path: mainRel, line: lineFromJsonError(err, rawText), message: `invalid JSON: ${err.message}`, severity: "error" });
        return emptyLoaded("bundle", entry, diagnostics, files);
    }

    const index = indexJsonLines(rawText);
    const push = (message, field, severity = "error") =>
        diagnostics.push({ path: mainRel, line: index.get(field) ?? 1, message, severity });

    if (!doc.name) push("missing \"name\"", "name");

    const include = toRuleList(doc.matches, core);
    const exclude = toRuleList(doc.excludes, core);
    if (include.length === 0) push("missing or empty targets (\"matches\" is empty)", "matches");
    compileEachRule(core, include, (err, rule) => {
        const i = include.indexOf(rule);
        push(err.message, `matches[${i}]`);
    });
    compileEachRule(core, exclude, (err, rule) => {
        const i = exclude.indexOf(rule);
        push(err.message, `excludes[${i}]`);
    });

    const sheets = [];
    if (doc.css !== undefined && !Array.isArray(doc.css)) {
        push("\"css\" must be an array", "css");
    } else {
        for (let i = 0; i < (doc.css ?? []).length; i++) {
            const field = `css[${i}]`;
            const item = doc.css[i];
            const res = await resolveTextSource(item, entry.dir, "path", files, push, field);
            if (!res) continue;
            sheets.push({ text: res.text, sourcePath: res.sourcePath, field, targets: resolveTargets(item && item.targets, core) });
        }
    }

    let dom = null;
    if (doc.dom !== undefined) {
        if (Array.isArray(doc.dom)) {
            const { errors: opErrs } = core.validateOps(doc.dom);
            for (const e of opErrs) push(e.message, e.field);
            dom = { ops: doc.dom, sourcePath: null };
        } else {
            const res = await resolveTextSource(doc.dom, entry.dir, "path", files, push, "dom");
            if (res) {
                try {
                    const ops = JSON.parse(res.text);
                    const { errors: opErrors } = core.validateOps(ops);
                    if (res.sourcePath) {
                        const domRel = relOf(res.sourcePath);
                        const domIndex = indexJsonLines(res.text);
                        for (const e of opErrors) {
                            // `e.field` is `dom[i]...`, but a standalone dom.json file has
                            // no wrapping "dom" key of its own — its line index is rooted
                            // at the array, so the prefix has to come off before lookup.
                            const localField = e.field.replace(/^dom/, "");
                            diagnostics.push({ path: domRel, line: domIndex.get(localField) ?? 1, message: e.message, severity: "error" });
                        }
                    } else {
                        for (const e of opErrors) push(e.message, "dom");
                    }
                    dom = { ops, sourcePath: res.sourcePath };
                } catch (err) {
                    const domPath = res.sourcePath ? relOf(res.sourcePath) : mainRel;
                    const line = res.sourcePath ? lineFromJsonError(err, res.text) : (index.get("dom") ?? 1);
                    diagnostics.push({ path: domPath, line, message: `invalid JSON: ${err.message}`, severity: "error" });
                }
            }
        }
    }

    const js = [];
    if (doc.js !== undefined && !Array.isArray(doc.js)) {
        push("\"js\" must be an array", "js");
    } else {
        for (let i = 0; i < (doc.js ?? []).length; i++) {
            const field = `js[${i}]`;
            const item = doc.js[i];
            const res = await resolveTextSource(item, entry.dir, "file", files, push, field);
            if (!res) continue;
            const world = (item && item.world) ?? "isolated";
            if (!JS_WORLDS.includes(world)) push(`unknown world "${world}"`, `${field}.world`);
            const runAt = (item && item.runAt) ?? "document_end";
            if (core.RUN_AT && !core.RUN_AT.includes(runAt)) push(`unknown runAt "${runAt}"`, `${field}.runAt`);
            js.push({ text: res.text, world, runAt, sourcePath: res.sourcePath });
        }
    }

    const { vars, errors: varErrors } = core.normalizeVars(doc.vars ?? []);
    for (const e of varErrors) push(e.message, e.field);
    for (const e of checkVarBounds(vars)) push(e.message, e.field);

    const assets = {};
    for (const [name, assetPath] of Object.entries(doc.assets ?? {})) {
        const abs = path.resolve(entry.dir, assetPath);
        files.add(abs);
        if (await fileExists(abs)) assets[name] = abs;
        else push(`referenced file does not exist: ${assetPath}`, `assets.${name}`);
    }

    const declared = new Set(vars.filter((v) => v && v.key).map((v) => v.key));
    for (const sheet of sheets) {
        const lineOf = sheet.sourcePath
            ? (offset) => lineAt(sheet.text, offset)
            : () => index.get(sheet.field) ?? 1;
        scanCssVarRefs(sheet.text, declared, sheet.sourcePath ? relOf(sheet.sourcePath) : mainRel, diagnostics, lineOf);
    }

    return {
        kind: "bundle", dir: entry.dir, mainPath: entry.mainPath,
        id: doc.id, name: doc.name, version: doc.version, namespace: doc.namespace,
        description: doc.description, author: doc.author, license: doc.license,
        homepageURL: doc.homepageURL, updateURL: doc.updateURL,
        targets: { include, exclude }, sheets, dom, js, vars, assets,
        diagnostics, files, broken: false
    };
}

/**
 * `core.parseUserCss` never throws (real or fallback — see core-fallback.js)
 * and returns everything already broken into `errors`/`warnings`, so this is
 * mostly assembly: compile the rules it found, validate the vars, validate
 * any dom/js it collected from `@oriel-dom`/`@oriel-js`, and locate each
 * section's CSS back in the original file for line numbers.
 */
async function loadUserCss(entry, core) {
    const diagnostics = [];
    const files = new Set([entry.mainPath]);
    const mainRel = relOf(entry.mainPath);
    const text = await readFile(entry.mainPath, "utf8");

    if (!core.isUserCss(text)) {
        diagnostics.push({ path: mainRel, line: 1, message: "does not look like UserCSS (no ==UserStyle== block)", severity: "error" });
        return emptyLoaded("usercss", entry, diagnostics, files);
    }

    const parsed = core.parseUserCss(text);
    const push = (message, line, severity = "error") => diagnostics.push({ path: mainRel, line: line ?? 1, message, severity });

    for (const e of parsed.errors ?? []) push(e.message, e.line, "error");
    for (const w of parsed.warnings ?? []) {
        const m = /^line (\d+):\s*(.*)$/.exec(w);
        push(m ? m[2] : w, m ? Number(m[1]) : 1, "warning");
    }

    const include = parsed.targets?.include ?? [];
    const exclude = parsed.targets?.exclude ?? [];
    compileEachRule(core, include, (err) => push(err.message, 1));
    compileEachRule(core, exclude, (err) => push(err.message, 1));
    for (const section of parsed.sections) {
        compileEachRule(core, section.rules, (err) => push(err.message, 1));
    }
    const totalIncludeCount = include.length + parsed.sections.reduce((n, s) => n + s.rules.length, 0);
    if (totalIncludeCount === 0) {
        push("missing or empty targets (no @-moz-document section and no @oriel-match)", 1);
    }

    const { vars, errors: varErrors } = core.normalizeVars(parsed.vars);
    // parseUserCss doesn't carry a source line per var, only per parse error —
    // these land against the file as a whole rather than a specific line.
    for (const e of varErrors) push(e.message, 1);
    for (const e of checkVarBounds(vars)) push(e.message, 1);

    let dom = null;
    if (parsed.dom && parsed.dom.length) {
        const { errors: opErrors } = core.validateOps(parsed.dom);
        for (const e of opErrors) push(e.message, 1);
        dom = { ops: parsed.dom, sourcePath: null };
    }

    const js = (parsed.js ?? []).map((unit) => {
        const world = unit.world === "main" ? "main" : "isolated";
        const runAt = core.RUN_AT && core.RUN_AT.includes(unit.runAt) ? unit.runAt : "document_end";
        return { text: unit.text ?? "", world, runAt, sourcePath: null };
    });

    const declared = new Set(vars.filter((v) => v && v.key).map((v) => v.key));
    const sheets = [];
    let searchFrom = 0;
    for (const section of parsed.sections) {
        const offset = text.indexOf(section.css, searchFrom);
        const base = offset === -1 ? 0 : offset;
        if (offset !== -1) searchFrom = offset + section.css.length;
        scanCssVarRefs(section.css, declared, mainRel, diagnostics, (localOffset) => lineAt(text, base + localOffset));
        sheets.push({
            text: section.css,
            sourcePath: null,
            targets: section.rules.length ? { include: section.rules, exclude: [] } : undefined
        });
    }

    return {
        kind: "usercss", dir: entry.dir, mainPath: entry.mainPath,
        id: undefined, name: parsed.name || undefined, version: parsed.version, namespace: parsed.namespace || undefined,
        description: parsed.description || undefined, author: parsed.author || undefined, license: parsed.license || undefined,
        homepageURL: parsed.homepageURL || undefined, updateURL: parsed.updateURL || undefined,
        targets: { include: [...include, ...parsed.sections.flatMap((s) => s.rules)], exclude },
        sheets, dom, js, vars,
        assets: {},
        diagnostics, files, broken: false
    };
}

export async function loadSkin(inputPath, core) {
    const entry = await findSkinEntry(inputPath);
    return entry.kind === "bundle" ? loadBundle(entry, core) : loadUserCss(entry, core);
}

function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "skin";
}

/** `id`, or the derived form from §2: namespace + name. */
export function resolveId(loaded) {
    if (loaded.id) return loaded.id;
    return slugify(loaded.namespace ? `${loaded.namespace}-${loaded.name}` : (loaded.name ?? "skin"));
}

/** The canonical bundle shape — what the extension receives, regardless of source format. */
export function buildWireSkin(loaded) {
    const wire = {
        format: 1,
        id: resolveId(loaded),
        name: loaded.name ?? "Untitled skin",
        version: loaded.version ?? "0.0.0"
    };
    for (const key of ["namespace", "description", "author", "license", "homepageURL", "updateURL"]) {
        if (loaded[key]) wire[key] = loaded[key];
    }
    wire.matches = loaded.targets.include;
    wire.excludes = loaded.targets.exclude;
    wire.css = loaded.sheets.map((s) => (hasRules(s.targets) ? { text: s.text, targets: s.targets } : { text: s.text }));
    wire.dom = loaded.dom ? loaded.dom.ops : [];
    wire.js = loaded.js.map((j) => ({ text: j.text, world: j.world, runAt: j.runAt }));
    wire.vars = loaded.vars;
    if (Object.keys(loaded.assets).length) wire.assets = loaded.assets;
    return wire;
}

export function hasErrors(diagnostics) {
    return diagnostics.some((d) => d.severity !== "warning");
}

export function sourceFiles(loaded) {
    return [...loaded.files].map((f) => relOf(f)).sort();
}

export { relOf, fileExists };
