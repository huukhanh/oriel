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
    for (const e of varErrors) push(e.message, `vars${e.field}`);

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

async function loadUserCss(entry, core) {
    const diagnostics = [];
    const files = new Set([entry.mainPath]);
    const mainRel = relOf(entry.mainPath);
    const text = await readFile(entry.mainPath, "utf8");

    if (!core.isUserCss(text)) {
        diagnostics.push({ path: mainRel, line: 1, message: "does not look like UserCSS (no ==UserStyle== block)", severity: "error" });
        return emptyLoaded("usercss", entry, diagnostics, files);
    }

    let parsed;
    try {
        parsed = core.parseUserCss(text);
    } catch (err) {
        diagnostics.push({ path: mainRel, line: err.line ?? 1, message: err.message, severity: "error" });
        return emptyLoaded("usercss", entry, diagnostics, files);
    }

    const push = (message, line, severity = "error") => diagnostics.push({ path: mainRel, line: line ?? 1, message, severity });

    if (!parsed.meta.name) push("missing @name", 1);
    for (const w of parsed.warnings ?? []) push(w, 1, "warning");

    if (parsed.matchRule) {
        compileEachRule(core, [parsed.matchRule], (err) => push(err.message, 1));
    }
    for (const section of parsed.sections) {
        compileEachRule(core, section.targets.include, (err) => push(err.message, section.line));
    }
    const totalIncludeCount = (parsed.matchRule ? 1 : 0) + parsed.sections.reduce((n, s) => n + s.targets.include.length, 0);
    if (totalIncludeCount === 0) push("missing or empty targets (no @-moz-document section and no @match)", 1);

    const { vars, errors: varErrors } = core.normalizeVars(parsed.vars);
    for (const e of varErrors) {
        const m = /^\[(\d+)\]/.exec(e.field);
        const line = m ? (parsed.vars[Number(m[1])]?.line ?? 1) : 1;
        push(e.message, line);
    }

    const declared = new Set(vars.filter((v) => v && v.key).map((v) => v.key));
    const sheets = parsed.sections.map((section) => {
        scanCssVarRefs(section.css, declared, mainRel, diagnostics, (offset) => lineAt(text, section.cssStart + offset));
        return { text: section.css, sourcePath: null, targets: section.targets };
    });

    return {
        kind: "usercss", dir: entry.dir, mainPath: entry.mainPath,
        id: undefined, name: parsed.meta.name, version: parsed.meta.version, namespace: parsed.meta.namespace,
        description: parsed.meta.description, author: parsed.meta.author, license: parsed.meta.license,
        homepageURL: parsed.meta.homepageURL, updateURL: parsed.meta.updateURL,
        targets: {
            include: [...(parsed.matchRule ? [parsed.matchRule] : []), ...parsed.sections.flatMap((s) => s.targets.include)],
            exclude: []
        },
        sheets, dom: null, js: [], vars,
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
