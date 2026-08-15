/**
 * Minimal stand-ins for extension/src/core/*, used only when those modules
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

/** @returns {{message:string, field:string}[]} empty when every op is valid */
export function validateOps(ops) {
    if (!Array.isArray(ops)) return [{ message: "dom must be an array of operations", field: "" }];
    const errors = [];
    ops.forEach((op, i) => {
        const field = `[${i}]`;
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
    });
    return errors;
}

// ---- vars ----------------------------------------------------------------

/** @returns {{vars: object[], errors: {message:string, field:string}[]}} */
export function normalizeVars(rawVars) {
    const errors = [];
    const seen = new Set();
    const vars = (rawVars ?? []).map((v, i) => {
        const field = `[${i}]`;
        if (!v || typeof v !== "object") {
            errors.push({ message: "var must be an object", field });
            return v;
        }
        if (!v.key) {
            errors.push({ message: "var is missing \"key\"", field: `${field}.key` });
        } else if (seen.has(v.key)) {
            errors.push({ message: `duplicate var key "${v.key}"`, field: `${field}.key` });
        } else {
            seen.add(v.key);
        }
        if (!VAR_TYPES.includes(v.type)) {
            errors.push({ message: `unknown var type "${v.type}"`, field: `${field}.type` });
            return v;
        }
        if (v.type === "number" || v.type === "range") {
            const def = Number(v.default);
            if (v.min !== undefined && def < v.min) {
                errors.push({ message: `default ${v.default} is below min ${v.min}`, field: `${field}.default` });
            }
            if (v.max !== undefined && def > v.max) {
                errors.push({ message: `default ${v.default} is above max ${v.max}`, field: `${field}.default` });
            }
        }
        if ((v.type === "select" || v.type === "image") && Array.isArray(v.options) && v.options.length > 0) {
            if (!v.options.some((o) => o.key === v.default)) {
                errors.push({ message: `default "${v.default}" is not one of the declared options`, field: `${field}.default` });
            }
        }
        return v;
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

export function isUserCss(text) {
    return /==UserStyle==/.test(text);
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

function parseVarLine(body, line) {
    const m = /^(\S+)\s+(\S+)\s+"((?:[^"\\]|\\.)*)"\s+([\s\S]+)$/.exec(body.trim());
    if (!m) throw new Error(`cannot parse "${body.trim()}"`);
    const [, type, key, label, defSpecRaw] = m;
    const spec = defSpecRaw.trim();
    if (!VAR_TYPES.includes(type)) {
        return { key, type, label, default: stripQuotes(spec), line };
    }
    switch (type) {
        case "text":
            return { key, type, label, default: stripQuotes(spec), line };
        case "color":
            return { key, type, label, default: spec, line };
        case "checkbox":
            return { key, type, label, default: spec === "1" ? 1 : 0, line };
        case "number":
        case "range": {
            const tuple = JSON.parse(spec);
            const [def, min, max, step, units] = tuple;
            return { key, type, label, default: Number(def), min: Number(min), max: Number(max), step: Number(step), units: units !== undefined ? String(units) : undefined, line };
        }
        case "select":
        case "image": {
            const options = parseOptionMap(spec);
            return { key, type, label, default: options[0] ? options[0].key : "", options, line };
        }
        default:
            return { key, type, label, default: stripQuotes(spec), line };
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

function parseDocFunctions(raw, line) {
    return splitTopLevel(raw, ",").map((part) => {
        const m = /^(domain|regexp|url-prefix|url)\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\)$/.exec(part.trim());
        if (!m) throw new SkinParseError(`cannot parse @-moz-document function "${part.trim()}"`, { line });
        return { kind: m[1], value: stripQuotes(m[2]) };
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

function parseSections(text, fromIndex) {
    const sections = [];
    const re = /@-moz-document\s+([^{]+)\{/g;
    re.lastIndex = fromIndex;
    let m;
    while ((m = re.exec(text))) {
        const line = lineAtLocal(text, m.index);
        const bodyStart = re.lastIndex;
        const bodyEnd = findMatchingBrace(text, bodyStart - 1);
        if (bodyEnd === -1) throw new SkinParseError("unterminated @-moz-document block", { line });
        const rules = parseDocFunctions(m[1].trim(), line);
        sections.push({ targets: { include: rules, exclude: [] }, css: text.slice(bodyStart, bodyEnd), cssStart: bodyStart, line });
        re.lastIndex = bodyEnd + 1;
    }
    return sections;
}

/**
 * @returns {{meta: object, vars: object[], matchRule: object|null, sections: object[], warnings: string[]}}
 */
export function parseUserCss(text) {
    const headerMatch = /\/\*\s*==UserStyle==\s*\n([\s\S]*?)\n\s*==\/UserStyle==\s*\*\//.exec(text);
    if (!headerMatch) throw new SkinParseError("no ==UserStyle== metadata block found", { line: 1 });

    const headerBodyStartLine = lineAtLocal(text, headerMatch.index) + 1;
    const lines = headerMatch[1].split("\n");
    const meta = {};
    const vars = [];
    let matchRule = null;
    const warnings = [];

    for (let li = 0; li < lines.length; li++) {
        const trimmed = lines[li].trim();
        if (!trimmed.startsWith("@")) continue;
        const line = headerBodyStartLine + li;
        const sp = trimmed.indexOf(" ");
        const key = sp === -1 ? trimmed.slice(1) : trimmed.slice(1, sp);
        let rest = sp === -1 ? "" : trimmed.slice(sp + 1).trim();
        if (key === "var") {
            let block = rest;
            while (countChar(block, "{") > countChar(block, "}") && li + 1 < lines.length) {
                li++;
                block += "\n" + lines[li];
            }
            try {
                vars.push(parseVarLine(block, line));
            } catch (err) {
                throw new SkinParseError(`bad @var: ${err.message}`, { line });
            }
            continue;
        }
        if (key === "match") {
            matchRule = { kind: "match", value: stripQuotes(rest) };
            continue;
        }
        meta[key] = stripQuotes(rest);
    }

    if (meta.preprocessor === "less" || meta.preprocessor === "stylus") {
        warnings.push(`@preprocessor ${meta.preprocessor} is not supported; variables are handled as "default"`);
    }

    const sections = parseSections(text, headerMatch.index + headerMatch[0].length);
    return { meta, vars, matchRule, sections, warnings };
}
