/**
 * Minimal stand-ins for engine/core/*, used only when those modules
 * are missing or fail to import — see core.js. Kept honest against
 * docs/SKIN-FORMAT.md, but this is not the extension's own validator and
 * should never be the last word once the real modules exist.
 *
 * @module core-fallback
 */

export class SkinParseError extends Error {
    constructor(message, detail = {}) {
        super(message);
        this.name = "SkinParseError";
        this.line = detail.line;
        this.field = detail.field;
    }
}

export const RUN_AT = ["document_start", "document_end", "document_idle"];
export const RULE_KINDS = ["match", "glob", "regexp", "url", "url-prefix", "domain"];
export const VAR_TYPES = ["text", "color", "checkbox", "number", "range", "select", "image"];

// ---- targeting -------------------------------------------------------

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `*` only (Chrome match-pattern path grammar), anchored both ends. */
function wildcardStarOnly(pattern) {
    const body = pattern.split("*").map(escapeRegExp).join(".*");
    return new RegExp(`^${body}$`);
}

/** `*` and `?` (Tampermonkey/Greasemonkey glob grammar), anchored both ends. */
function wildcardStarQuestion(pattern) {
    let body = "";
    for (const ch of pattern) {
        if (ch === "*") body += ".*";
        else if (ch === "?") body += ".";
        else body += escapeRegExp(ch);
    }
    return new RegExp(`^${body}$`);
}

function hostSuffixTest(host) {
    const re = new RegExp(`^(.+\\.)?${escapeRegExp(host)}$`);
    return (hostname) => re.test(hostname);
}

function matchPatternTest(pattern) {
    const m = /^(\*|https?|file|ftp):\/\/(\*\.[^/*]+|\*|[^/*]*)(\/.*)$/.exec(pattern);
    if (!m) throw new Error("not a valid match pattern (scheme://host/path)");
    const [, scheme, host, path] = m;
    const schemeOk = scheme === "*" ? (s) => s === "http" || s === "https" : (s) => s === scheme;
    const hostOk = host === "*" ? () => true : host.startsWith("*.") ? hostSuffixTest(host.slice(2)) : (h) => h === host;
    const pathRe = wildcardStarOnly(path);
    return (url) => {
        let u;
        try { u = new URL(url); } catch { return false; }
        if (!schemeOk(u.protocol.slice(0, -1))) return false;
        if (!hostOk(u.hostname)) return false;
        return pathRe.test(u.pathname + u.search);
    };
}

function globRuleTest(pattern) {
    const re = wildcardStarQuestion(pattern);
    return (url) => re.test(url);
}

function domainRuleTest(value) {
    const test = hostSuffixTest(value);
    return (url) => {
        try { return test(new URL(url).hostname); } catch { return false; }
    };
}

function compileOne(rule) {
    switch (rule.kind) {
        case "match": return matchPatternTest(rule.value);
        case "glob": return globRuleTest(rule.value);
        case "regexp": { const re = new RegExp(rule.value); return (u) => re.test(u); }
        case "url": return (u) => u === rule.value;
        case "url-prefix": return (u) => u.startsWith(rule.value);
        case "domain": return domainRuleTest(rule.value);
        default: throw new Error(`unknown rule kind "${rule.kind}"`);
    }
}

/**
 * @param {{include: {kind:string,value:string}[], exclude: {kind:string,value:string}[]}} targets
 */
export function compileTargets(targets) {
    const compile = (rule, field) => {
        try {
            return { rule, test: compileOne(rule) };
        } catch (err) {
            throw new SkinParseError(`bad ${rule.kind} rule "${rule.value}": ${err.message}`, { field });
        }
    };
    const include = (targets.include ?? []).map((r, i) => compile(r, `targets.include[${i}]`));
    const exclude = (targets.exclude ?? []).map((r, i) => compile(r, `targets.exclude[${i}]`));
    return {
        include,
        exclude,
        test(url) {
            return include.some((c) => c.test(url)) && !exclude.some((c) => c.test(url));
        }
    };
}

/** A bare string, as found in `matches`/`excludes` or a metadata `@match` line. */
export function ruleFromString(value, kind) {
    if (kind) return { kind, value };
    if (value.length > 1 && value.startsWith("/") && value.endsWith("/")) {
        return { kind: "regexp", value: value.slice(1, -1) };
    }
    return { kind: "match", value };
}

function describeRule(rule) {
    switch (rule.kind) {
        case "regexp": return `/${rule.value}/`;
        case "url-prefix": return `${rule.value}*`;
        default: return rule.value;
    }
}

export function describeTargets(targets) {
    const include = targets.include ?? [];
    const exclude = targets.exclude ?? [];
    if (include.length === 0) return "matches nothing";
    const inc = include.map(describeRule).join(", ");
    if (exclude.length === 0) return inc;
    return `${inc} (except ${exclude.map(describeRule).join(", ")})`;
}

// ---- dom ops -----------------------------------------------------------

const OP_SPECS = {
    remove: { required: ["select"] },
    move: { required: ["select", "into"], enums: { position: ["append", "prepend", "before", "after"] } },
    wrap: { required: ["select", "with"] },
    unwrap: { required: ["select"] },
    insert: { required: ["into", "position"], oneOf: ["html", "text", "element"] },
    replace: { required: ["select"], oneOf: ["html", "text", "element"] },
    setAttr: { required: ["select", "attr", "value"] },
    removeAttr: { required: ["select", "attr"] },
    addClass: { required: ["select", "class"] },
    removeClass: { required: ["select", "class"] },
    toggleClass: { required: ["select", "class"] },
    setText: { required: ["select", "text"] },
    rewriteText: { required: ["select", "pattern", "with"] },
    sort: { required: ["select", "by"] },
    attrToVar: { required: ["select", "attr", "var"] }
};

/**
 * Field paths are `dom[i]...`, matching the shape `engine/core/domops.js`
 * uses — so callers do not need to know which one produced the errors.
 *
 * @returns {{ops: object[], errors: {message:string, field:string}[]}}
 */
export function validateOps(ops) {
    const errors = [];
    const normalized = [];
    if (ops === undefined || ops === null) return { ops: normalized, errors };
    if (!Array.isArray(ops)) {
        errors.push({ message: "dom must be an array of operations", field: "dom" });
        return { ops: normalized, errors };
    }
    ops.forEach((op, i) => {
        const field = `dom[${i}]`;
        if (!op || typeof op !== "object") { errors.push({ message: "op must be an object", field }); return; }
        const spec = OP_SPECS[op.op];
        if (!spec) { errors.push({ message: `unknown op "${op.op}"`, field: `${field}.op` }); return; }
        for (const key of spec.required) {
            if (op[key] === undefined) {
                errors.push({ message: `"${op.op}" is missing required field "${key}"`, field: `${field}.${key}` });
            }
        }
        if (spec.oneOf) {
            const present = spec.oneOf.filter((k) => op[k] !== undefined);
            if (present.length === 0) {
                errors.push({ message: `"${op.op}" needs one of ${spec.oneOf.join("/")}`, field });
            } else if (present.length > 1) {
                errors.push({ message: `"${op.op}" accepts only one of ${spec.oneOf.join("/")}, got ${present.join(", ")}`, field });
            }
        }
        if (spec.enums) {
            for (const [key, allowed] of Object.entries(spec.enums)) {
                if (op[key] !== undefined && !allowed.includes(op[key])) {
                    errors.push({ message: `"${key}" must be one of ${allowed.join("|")}, got "${op[key]}"`, field: `${field}.${key}` });
                }
            }
        }
        if (op.when !== undefined && (typeof op.when !== "object" || op.when === null)) {
            errors.push({ message: "\"when\" must be an object", field: `${field}.when` });
        }
        normalized.push(op);
    });
    return { ops: normalized, errors };
}

// ---- vars ----------------------------------------------------------------

/**
 * Field paths are `vars[i]` with the path folded into the message text too —
 * matching `engine/core/vars.js`'s convention, so callers don't need
 * to know which one produced an error. Unlike that module, this one does not
 * validate a default against its own min/max/options — see
 * `oriel-cli/src/skin-loader.js`'s `checkVarBounds`, which does that as a
 * layer on top of *either* implementation.
 *
 * @returns {{vars: object[], errors: {message:string, field:string}[]}}
 */
export function normalizeVars(rawVars) {
    const errors = [];
    const seen = new Set();
    const list = Array.isArray(rawVars) ? rawVars : rawVars == null ? [] : [rawVars];
    const vars = [];
    list.forEach((v, i) => {
        const field = `vars[${i}]`;
        if (!v || typeof v !== "object") {
            errors.push({ message: `${field}: a var must be an object`, field });
            return;
        }
        const key = typeof v.key === "string" ? v.key.trim() : "";
        if (!/^[\w-]+$/.test(key)) {
            errors.push({ message: `${field}: missing or invalid "key"`, field });
            return;
        }
        if (seen.has(key)) {
            errors.push({ message: `${field}: duplicate var key "${key}"`, field });
            return;
        }
        if (!VAR_TYPES.includes(v.type)) {
            errors.push({ message: `${field}: unknown var type "${v.type}"`, field });
            return;
        }
        if (v.default === undefined || v.default === null) {
            errors.push({ message: `${field}: var "${key}" needs a default`, field });
            return;
        }
        seen.add(key);
        vars.push({ ...v, key });
    });
    return { vars, errors };
}

export function defaultValues(vars) {
    const out = {};
    for (const v of vars ?? []) {
        if (v && v.key) out[v.key] = v.default;
    }
    return out;
}

// ---- usercss ---------------------------------------------------------
//
// Shape matches engine/core/usercss.js's parseUserCss exactly —
// {meta, name, version, ..., vars, sections: [{rules, css}], targets,
// dom, js, runAt, allFrames, warnings, errors} — so skin-loader.js has one
// contract regardless of which produced it. This is a reduced parser:
// @oriel-dom/@oriel-js/@oriel-match/@oriel-exclude are not supported here
// (dom/js/targets.include/exclude always come back empty) — the real module
// is what should be relied on for those; this is the last-resort fallback.

export function isUserCss(text) {
    return typeof text === "string" && /\/\*\s*==UserStyle==/.test(text);
}

function stripQuotes(s) {
    const t = s.trim();
    if (t.length >= 2 && t[0] === "\"" && t[t.length - 1] === "\"") {
        return t.slice(1, -1).replace(/\\"/g, "\"");
    }
    return t;
}

function countChar(s, ch) {
    let n = 0;
    for (const c of s) if (c === ch) n++;
    return n;
}

function parseOptionMap(spec) {
    const obj = JSON.parse(spec);
    return Object.entries(obj).map(([labelKey, value]) => {
        const idx = labelKey.indexOf(":");
        return idx === -1
            ? { key: labelKey, label: labelKey, value }
            : { key: labelKey.slice(idx + 1), label: labelKey.slice(0, idx), value };
    });
}

/** Throws on a malformed line — the caller turns that into an `errors` entry, never a thrown exception. */
function parseVarLine(body) {
    const m = /^(\S+)\s+(\S+)\s+"((?:[^"\\]|\\.)*)"\s+([\s\S]+)$/.exec(body.trim());
    if (!m) throw new Error(`cannot parse "@var ${body.trim()}"`);
    const [, type, key, label, defSpecRaw] = m;
    const spec = defSpecRaw.trim();
    if (!VAR_TYPES.includes(type)) throw new Error(`@var has an unknown type "${type}"`);
    switch (type) {
        case "text":
            return { key, type, label, default: stripQuotes(spec) };
        case "color":
            return { key, type, label, default: spec };
        case "checkbox":
            return { key, type, label, default: spec === "1" ? 1 : 0 };
        case "number":
        case "range": {
            const tuple = JSON.parse(spec);
            const [def, min, max, step, units] = tuple;
            return { key, type, label, default: Number(def), min: Number(min), max: Number(max), step: Number(step), units: units !== undefined ? String(units) : undefined };
        }
        case "select":
        case "image": {
            const options = parseOptionMap(spec);
            return { key, type, label, default: options[0] ? options[0].key : "", options };
        }
        default:
            return { key, type, label, default: stripQuotes(spec) };
    }
}

function lineAtLocal(text, offset) {
    let line = 1;
    for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++;
    return line;
}

function splitTopLevel(s, sep) {
    const out = [];
    let depth = 0, cur = "", inString = null;
    for (const ch of s) {
        if (inString) { cur += ch; if (ch === inString) inString = null; continue; }
        if (ch === "\"" || ch === "'") { inString = ch; cur += ch; continue; }
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === sep && depth === 0) { out.push(cur); cur = ""; continue; }
        cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out;
}

/** One entry per function; a part that doesn't parse becomes `null` rather than aborting the whole list. */
function parseDocFunctions(raw) {
    return splitTopLevel(raw, ",").map((part) => {
        const m = /^(domain|regexp|url-prefix|url)\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\)$/.exec(part.trim());
        return m ? { kind: m[1], value: stripQuotes(m[2]) } : null;
    });
}

function findMatchingBrace(text, openIndex) {
    let depth = 0;
    let inString = null;
    for (let i = openIndex; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === "\\") { i++; continue; }
            if (ch === inString) inString = null;
            continue;
        }
        if (ch === "\"" || ch === "'") { inString = ch; continue; }
        if (ch === "/" && text[i + 1] === "*") {
            const end = text.indexOf("*/", i + 2);
            i = end === -1 ? text.length : end + 1;
            continue;
        }
        if (ch === "{") depth++;
        else if (ch === "}") { depth--; if (depth === 0) return i; }
    }
    return -1;
}

/** `{sections, errors}` — a block that never closes stops the scan but still returns what came before it. */
function parseSections(text, fromIndex, errors) {
    const sections = [];
    const re = /@-moz-document\s+([^{]+)\{/g;
    re.lastIndex = fromIndex;
    let m;
    while ((m = re.exec(text))) {
        const line = lineAtLocal(text, m.index);
        const bodyStart = re.lastIndex;
        const bodyEnd = findMatchingBrace(text, bodyStart - 1);
        if (bodyEnd === -1) {
            errors.push({ message: "@-moz-document section opened here was never closed", line });
            break;
        }
        const parsedFns = parseDocFunctions(m[1].trim());
        for (const fn of parsedFns) {
            if (!fn) errors.push({ message: `cannot parse @-moz-document function in "${m[1].trim()}"`, line });
        }
        sections.push({ rules: parsedFns.filter(Boolean), css: text.slice(bodyStart, bodyEnd) });
        re.lastIndex = bodyEnd + 1;
    }
    return sections;
}

function emptyResult(warnings, errors) {
    return {
        meta: {}, name: "", version: "0.0.0", namespace: "", description: "", author: "", license: "",
        homepageURL: "", supportURL: "", updateURL: "", vars: [], sections: [],
        targets: { include: [], exclude: [] }, dom: [], js: [], runAt: undefined, allFrames: false,
        warnings, errors
    };
}

/**
 * Never throws — a parse problem is an entry in `errors`, with a line number
 * where one is known. Shape matches `engine/core/usercss.js`'s
 * `parseUserCss` (see the module comment above); `@oriel-match`,
 * `@oriel-exclude`, `@oriel-dom` and `@oriel-js` are not implemented here, so
 * `targets.include/exclude` and `dom`/`js` always come back empty.
 *
 * @returns {{meta: object, name: string, version: string, namespace: string,
 *   description: string, author: string, license: string, homepageURL: string,
 *   supportURL: string, updateURL: string, vars: object[],
 *   sections: {rules: object[], css: string}[], targets: object,
 *   dom: object[], js: object[], runAt: string|undefined, allFrames: boolean,
 *   warnings: string[], errors: {message: string, line?: number, field?: string}[]}}
 */
export function parseUserCss(text) {
    const warnings = [];
    const errors = [];
    const raw = typeof text === "string" ? text : "";

    const headerMatch = /\/\*\s*==UserStyle==\s*\n([\s\S]*?)\n\s*==\/UserStyle==\s*\*\//.exec(raw);
    if (!headerMatch) {
        errors.push({ message: "no /* ==UserStyle== metadata block found", line: 1 });
        return emptyResult(warnings, errors);
    }

    const headerBodyStartLine = lineAtLocal(raw, headerMatch.index) + 1;
    const lines = headerMatch[1].split("\n");
    const meta = {};
    const vars = [];

    for (let li = 0; li < lines.length; li++) {
        const trimmed = lines[li].trim();
        if (!trimmed.startsWith("@")) continue;
        const line = headerBodyStartLine + li;
        const sp = trimmed.indexOf(" ");
        const key = sp === -1 ? trimmed.slice(1) : trimmed.slice(1, sp);
        const rest = sp === -1 ? "" : trimmed.slice(sp + 1).trim();
        if (key === "var") {
            let block = rest;
            while (countChar(block, "{") > countChar(block, "}") && li + 1 < lines.length) {
                li++;
                block += "\n" + lines[li];
            }
            try {
                vars.push(parseVarLine(block));
            } catch (err) {
                errors.push({ message: err.message, line, field: "vars" });
            }
            continue;
        }
        if (Object.hasOwn(meta, key)) warnings.push(`line ${line}: @${key} repeated; using the last value`);
        meta[key] = stripQuotes(rest);
    }

    if (!meta.name || !meta.name.trim()) {
        errors.push({ message: "missing @name", line: headerBodyStartLine, field: "name" });
    }
    if (meta.namespace === undefined) warnings.push("missing @namespace");
    const version = meta.version === undefined ? (warnings.push("missing @version; defaulting to 0.0.0"), "0.0.0") : meta.version;

    if (meta.preprocessor === "less" || meta.preprocessor === "stylus") {
        warnings.push(`@preprocessor ${meta.preprocessor} is not supported; its @myVar / bare-name variable syntax is not resolved`);
    }

    const sections = parseSections(raw, headerMatch.index + headerMatch[0].length, errors);

    return {
        meta,
        name: meta.name ?? "",
        version,
        namespace: meta.namespace ?? "",
        description: meta.description ?? "",
        author: meta.author ?? "",
        license: meta.license ?? "",
        homepageURL: meta.homepageURL ?? "",
        supportURL: meta.supportURL ?? "",
        updateURL: meta.updateURL ?? "",
        vars,
        sections,
        targets: { include: [], exclude: [] },
        dom: [],
        js: [],
        runAt: undefined,
        allFrames: false,
        warnings,
        errors
    };
}
