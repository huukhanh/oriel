/**
 * UserCSS — the primary skin format (docs/SKIN-FORMAT.md §1.1), as Stylus
 * implements it, with Oriel's own `@oriel-` extensions layered on top. The
 * world has an enormous library of these; a style that installs fine in
 * Stylus should install fine here, with warnings rather than rejection for
 * anything Oriel does differently.
 *
 * `parseUserCss` never throws — a broken skin has to reach the install screen
 * with a line number, not a stack trace (docs/SKIN-FORMAT.md §10). Structural
 * problems go into `errors`; things Oriel can work around go into `warnings`.
 *
 * @module core/usercss
 */

import { parseVarDeclaration } from "./vars.js";

// Duplicated from types.js rather than imported: this module's only allowed
// external import is vars.js, so the three run-at points are spelled out here.
const RUN_AT = ["document_start", "document_end", "document_idle"];

const OPEN = "/* ==UserStyle==";
const CLOSE = "==/UserStyle== */";

const SIMPLE_KEYS = new Set([
    "name", "namespace", "version", "description", "author", "license",
    "homepageURL", "supportURL", "updateURL", "downloadURL", "preprocessor"
]);

function normalizeNewlines(text) {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function lineNumber(text, index) {
    let n = 1;
    for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") n++;
    return n;
}

function findMetaBlock(text) {
    const start = text.indexOf(OPEN);
    if (start === -1) return null;
    const bodyStart = start + OPEN.length;
    const closeAt = text.indexOf(CLOSE, bodyStart);
    if (closeAt === -1) return null;
    return { start, bodyStart, bodyEnd: closeAt, end: closeAt + CLOSE.length };
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isUserCss(text) {
    if (typeof text !== "string") return false;
    return findMetaBlock(normalizeNewlines(text)) !== null;
}

// --- the metadata block ----------------------------------------------------

// Net depth of `{`/`[` vs `}`/`]`, ignoring bracket characters inside a
// double-quoted string. This is how a multi-line @var default (the select
// object form) is told apart from a one-line one: keep pulling lines while
// depth stays positive.
function jsonishDepth(text) {
    let depth = 0;
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inString) {
            if (c === "\\") { i++; continue; }
            if (c === '"') inString = false;
            continue;
        }
        if (c === '"') { inString = true; continue; }
        if (c === "{" || c === "[") depth++;
        else if (c === "}" || c === "]") depth--;
    }
    return depth;
}

/**
 * Find the brace-balanced `{ ... }` in `text`, aware of JS string/template
 * literals and comments so a `}` inside either doesn't close early. Returns
 * `{prefix, inner}` — text before the opening brace, and text between the
 * braces — or `null` if `text` has no balanced block yet.
 */
function extractJsBlock(text) {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let i = start;
    let depth = 0;
    let mode = null; // "sq" | "dq" | "tpl" | "line" | "block"
    while (i < text.length) {
        const c = text[i];
        if (mode === "sq" || mode === "dq") {
            if (c === "\\") { i += 2; continue; }
            if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"')) mode = null;
            i++;
            continue;
        }
        if (mode === "tpl") {
            if (c === "\\") { i += 2; continue; }
            if (c === "`") mode = null;
            i++;
            continue;
        }
        if (mode === "line") {
            if (c === "\n") mode = null;
            i++;
            continue;
        }
        if (mode === "block") {
            if (c === "*" && text[i + 1] === "/") { mode = null; i += 2; continue; }
            i++;
            continue;
        }
        if (c === "'") { mode = "sq"; i++; continue; }
        if (c === '"') { mode = "dq"; i++; continue; }
        if (c === "`") { mode = "tpl"; i++; continue; }
        if (c === "/" && text[i + 1] === "/") { mode = "line"; i += 2; continue; }
        if (c === "/" && text[i + 1] === "*") { mode = "block"; i += 2; continue; }
        if (c === "{") { depth++; i++; continue; }
        if (c === "}") {
            depth--;
            if (depth === 0) return { prefix: text.slice(0, start).trim(), inner: text.slice(start + 1, i) };
            i++;
            continue;
        }
        i++;
    }
    return null;
}

const SLASH_DELIMITED = /^\/(.+)\/([a-zA-Z]*)$/s;

// @oriel-match / @oriel-exclude: a bare string is a match pattern (the only
// kind the metadata block writes by hand); slash-delimited is a regexp, the
// same convention target.js uses for a rule sniffed from free text.
function sniffOrielRule(raw) {
    const value = raw.trim();
    const m = SLASH_DELIMITED.exec(value);
    if (!m) return { kind: "match", value };
    const flags = m[2].replace(/[gy]/g, "");
    return flags ? { kind: "regexp", value: m[1], flags } : { kind: "regexp", value: m[1] };
}

function parseBool(text, fallback) {
    const t = text.trim().toLowerCase();
    if (t === "true" || t === "1" || t === "yes") return true;
    if (t === "false" || t === "0" || t === "no" || t === "") return false;
    return fallback;
}

function parseRunAt(text, warnings, lineNo) {
    const key = text.trim().toLowerCase().replace(/-/g, "_");
    if (RUN_AT.includes(key)) return key;
    warnings.push(`line ${lineNo}: unknown @oriel-run-at value "${text.trim()}"`);
    return undefined;
}

/**
 * Walk the metadata block's physical lines, dispatching each `@key` to its
 * handler. `@var`/`@advanced`/`@oriel-dom`/`@oriel-js` may pull in following
 * lines first, when their value opens a bracket/brace that isn't balanced yet.
 */
function readMetaLines(bodyLines, startLine, warnings, errors) {
    const meta = {};
    const vars = [];
    const dom = [];
    const js = [];
    const include = [];
    const exclude = [];
    let runAt;
    let allFrames = false;

    let j = 0;
    while (j < bodyLines.length) {
        const lineNo = startLine + j;
        const m = /^\s*@(\S+)[ \t]*(.*)$/.exec(bodyLines[j]);
        if (!m) { j++; continue; }
        const rawKey = m[1];
        let valueText = m[2];

        if (rawKey === "var" || rawKey === "advanced" || rawKey === "oriel-dom") {
            while (jsonishDepth(valueText) > 0 && j + 1 < bodyLines.length) {
                j++;
                valueText += "\n" + bodyLines[j];
            }
        } else if (rawKey === "oriel-js") {
            while (extractJsBlock(valueText) === null && j + 1 < bodyLines.length) {
                j++;
                valueText += "\n" + bodyLines[j];
            }
        }

        switch (rawKey) {
            case "var":
            case "advanced": {
                const typeMatch = /^\s*(\S+)\s*/.exec(valueText);
                if (!typeMatch) {
                    errors.push({ message: `@${rawKey} is missing its type`, line: lineNo, field: "vars" });
                    break;
                }
                try {
                    vars.push(parseVarDeclaration(typeMatch[1], valueText.slice(typeMatch[0].length)));
                } catch (error) {
                    errors.push({ message: error.message, line: lineNo, field: error.field ?? "vars" });
                }
                break;
            }
            case "oriel-dom": {
                try {
                    const parsed = JSON.parse(valueText.trim());
                    if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
                    dom.push(...parsed);
                } catch (error) {
                    errors.push({ message: `@oriel-dom: ${error.message}`, line: lineNo, field: "dom" });
                }
                break;
            }
            case "oriel-js": {
                const block = extractJsBlock(valueText);
                if (!block) {
                    errors.push({ message: "@oriel-js block was never closed", line: lineNo, field: "js" });
                    break;
                }
                let world = "isolated";
                let scriptRunAt;
                for (const token of block.prefix.split(/\s+/).filter(Boolean)) {
                    const norm = token.toLowerCase();
                    if (norm === "main" || norm === "isolated") world = norm;
                    else if (RUN_AT.includes(norm.replace(/-/g, "_"))) scriptRunAt = norm.replace(/-/g, "_");
                }
                js.push({ id: `js${js.length}`, text: block.inner.trim(), world, runAt: scriptRunAt });
                break;
            }
            // `@match` and `@exclude-match` are accepted alongside the
            // prefixed spellings because that is what an author who has ever
            // written a userscript will type, and there is no Stylus key of
            // either name for them to collide with. The prefixed forms are
            // what `stringifyUserCss` emits, so a round trip is stable.
            case "oriel-match":
            case "match":
                include.push(sniffOrielRule(valueText));
                break;
            case "oriel-exclude":
            case "exclude-match":
            case "exclude":
                exclude.push(sniffOrielRule(valueText));
                break;
            case "oriel-run-at":
                runAt = parseRunAt(valueText, warnings, lineNo) ?? runAt;
                break;
            case "oriel-all-frames":
                allFrames = parseBool(valueText, allFrames);
                break;
            default: {
                const known = SIMPLE_KEYS.has(rawKey);
                if (Object.hasOwn(meta, rawKey)) {
                    warnings.push(`line ${lineNo}: @${rawKey} repeated; using the last value`);
                }
                meta[rawKey] = valueText.trim();
                if (!known) warnings.push(`line ${lineNo}: unknown metadata key @${rawKey} (kept)`);
            }
        }
        j++;
    }

    if (meta.preprocessor === "less" || meta.preprocessor === "stylus") {
        warnings.push(
            `@preprocessor ${meta.preprocessor} is not supported; its @myVar / bare-name variable syntax is not resolved`
        );
    }

    return { meta, vars, dom, js, include, exclude, runAt, allFrames };
}

// --- @-moz-document sections ------------------------------------------------

/** Argument list split on top-level commas — a comma inside a quoted arg does not split. */
function splitArgs(text) {
    const parts = [];
    let cur = "";
    let quote = null;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            cur += c;
            if (c === "\\") { i++; cur += text[i] ?? ""; continue; }
            if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'") { quote = c; cur += c; continue; }
        if (c === ",") { parts.push(cur); cur = ""; continue; }
        cur += c;
    }
    if (cur.trim() !== "") parts.push(cur);
    return parts;
}

function unquoteArg(raw) {
    const t = raw.trim();
    if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
        const q = t[0];
        let out = "";
        for (let i = 1; i < t.length - 1; i++) {
            if (t[i] === "\\" && (t[i + 1] === q || t[i + 1] === "\\")) { out += t[i + 1]; i++; continue; }
            out += t[i];
        }
        return out;
    }
    return t;
}

const FUNC_CALL = /^\s*(url-prefix|url|domain|regexp)\s*\(\s*([\s\S]*?)\s*\)\s*$/i;

function parseFunctionList(argsText, openLine, warnings) {
    const rules = [];
    for (const part of splitArgs(argsText)) {
        if (part.trim() === "") continue;
        const m = FUNC_CALL.exec(part);
        if (!m) {
            warnings.push(`line ${openLine}: unrecognized @-moz-document function: ${part.trim()}`);
            continue;
        }
        rules.push({ kind: m[1].toLowerCase(), value: unquoteArg(m[2]) });
    }
    return rules;
}

/** Find `}` matching the `{` at `openIndex`, skipping strings and comments so `content: "}"` can't close it early. */
function findMatchingBrace(text, openIndex) {
    let depth = 1;
    let i = openIndex + 1;
    while (i < text.length) {
        const c = text[i];
        if (c === '"' || c === "'") {
            const q = c;
            i++;
            while (i < text.length && text[i] !== q) {
                if (text[i] === "\\") i++;
                i++;
            }
            i++;
            continue;
        }
        if (c === "/" && text[i + 1] === "*") {
            i += 2;
            while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
            i += 2;
            continue;
        }
        if (c === "{") { depth++; i++; continue; }
        if (c === "}") {
            depth--;
            if (depth === 0) return i;
            i++;
            continue;
        }
        i++;
    }
    return -1;
}

function pushOutsideSection(sections, chunk) {
    if (chunk.trim() === "") return;
    sections.push({ rules: [], css: chunk });
}

/**
 * Split CSS into `@-moz-document` sections plus the plain CSS between them,
 * in source order. Section bodies are found by balancing braces rather than
 * with a regex, because CSS puts `{}` inside strings and comments too.
 *
 * @param {string} css
 * @returns {{sections: {rules: import("./types.js").Rule[], css: string}[], warnings: string[]}}
 */
export function parseMozDocument(css) {
    const { sections, warnings, errors } = scanMozDocument(css);
    const merged = [...warnings, ...errors.map((e) => (e.line ? `line ${e.line}: ${e.message}` : e.message))];
    return { sections, warnings: merged };
}

function scanMozDocument(text) {
    const source = normalizeNewlines(String(text ?? ""));
    const sections = [];
    const warnings = [];
    const errors = [];

    const KEYWORD = /@-moz-document\b/gi;
    let cursor = 0;
    let match;
    while ((match = KEYWORD.exec(source))) {
        pushOutsideSection(sections, source.slice(cursor, match.index));

        const afterKeyword = match.index + match[0].length;
        const openLine = lineNumber(source, match.index);
        const braceAt = source.indexOf("{", afterKeyword);
        if (braceAt === -1) {
            errors.push({ message: "@-moz-document has no opening brace", line: openLine });
            break;
        }

        const rules = parseFunctionList(source.slice(afterKeyword, braceAt), openLine, warnings);
        const closeAt = findMatchingBrace(source, braceAt);
        if (closeAt === -1) {
            errors.push({ message: "@-moz-document section opened here was never closed", line: openLine });
            break;
        }

        sections.push({ rules, css: source.slice(braceAt + 1, closeAt) });
        cursor = closeAt + 1;
        KEYWORD.lastIndex = cursor;
    }
    pushOutsideSection(sections, source.slice(cursor));

    return { sections, warnings, errors };
}

// --- top level ---------------------------------------------------------

function emptyResult(warnings, errors) {
    return {
        meta: {},
        name: "",
        version: "0.0.0",
        namespace: "",
        description: "",
        author: "",
        license: "",
        homepageURL: "",
        supportURL: "",
        updateURL: "",
        vars: [],
        sections: [],
        targets: { include: [], exclude: [] },
        dom: [],
        js: [],
        runAt: undefined,
        allFrames: false,
        warnings,
        errors
    };
}

/**
 * @param {string} text
 * @returns {{
 *   meta: Record<string,string>, name: string, version: string, namespace: string,
 *   description: string, author: string, license: string, homepageURL: string,
 *   supportURL: string, updateURL: string, vars: import("./types.js").Var[],
 *   sections: {rules: import("./types.js").Rule[], css: string}[],
 *   targets: import("./types.js").Targets, dom: object[], js: object[],
 *   runAt: string|undefined, allFrames: boolean,
 *   warnings: string[], errors: import("./types.js").SkinError[]
 * }}
 */
export function parseUserCss(text) {
    const warnings = [];
    const errors = [];
    const normalized = normalizeNewlines(typeof text === "string" ? text : "");
    const block = findMetaBlock(normalized);

    if (!block) {
        errors.push({ message: "no /* ==UserStyle== metadata block found" });
        return emptyResult(warnings, errors);
    }

    const openLine = lineNumber(normalized, block.start);
    const bodyLines = normalized.slice(block.bodyStart, block.bodyEnd).split("\n");
    const collected = readMetaLines(bodyLines, openLine, warnings, errors);
    const meta = collected.meta;

    if (!meta.name || !meta.name.trim()) {
        errors.push({ message: "missing @name", line: openLine, field: "name" });
    }
    if (meta.namespace === undefined) {
        warnings.push("missing @namespace");
    }
    let version = meta.version;
    if (version === undefined) {
        warnings.push("missing @version; defaulting to 0.0.0");
        version = "0.0.0";
    }

    const { sections, warnings: mozWarnings, errors: mozErrors } = scanMozDocument(normalized.slice(block.end));
    warnings.push(...mozWarnings);
    for (const error of mozErrors) errors.push(error);

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
        vars: collected.vars,
        sections,
        targets: { include: collected.include, exclude: collected.exclude },
        dom: collected.dom,
        js: collected.js,
        runAt: collected.runAt,
        allFrames: collected.allFrames,
        warnings,
        errors
    };
}

// --- stringify ---------------------------------------------------------

function escapeLabel(text) {
    return text.replace(/"/g, '\\"');
}

function varDefaultText(v) {
    switch (v.type) {
        case "text":
            return JSON.stringify(String(v.default));
        case "color":
            return String(v.default);
        case "checkbox":
            return v.default === 1 || v.default === "1" ? "1" : "0";
        case "number":
        case "range": {
            const arr = [v.default];
            const fields = [v.min, v.max, v.step];
            let last = -1;
            fields.forEach((f, i) => { if (f !== undefined) last = i; });
            for (let i = 0; i <= last; i++) arr.push(fields[i] === undefined ? null : fields[i]);
            if (v.units !== undefined) arr.push(v.units);
            return JSON.stringify(arr);
        }
        case "select":
        case "image": {
            const obj = {};
            for (const opt of v.options ?? []) {
                const key = `${opt.key}:${opt.label}${opt.key === v.default ? "*" : ""}`;
                obj[key] = opt.value;
            }
            return JSON.stringify(obj);
        }
        default:
            return JSON.stringify(String(v.default ?? ""));
    }
}

function varLine(v) {
    const label = v.tooltip ? `${v.label}\n${v.tooltip}`.replace("\n", "\\n") : v.label;
    return `@var ${v.type} ${v.key} "${escapeLabel(label)}" ${varDefaultText(v)}`;
}

function mozFuncText(rule) {
    return `${rule.kind}(${JSON.stringify(rule.value)})`;
}

function sectionText(section) {
    if (!section.rules || section.rules.length === 0) return section.css;
    return `@-moz-document ${section.rules.map(mozFuncText).join(", ")} {\n${section.css}\n}`;
}

function ruleText(rule) {
    if (rule.kind === "regexp") return `/${rule.value}/${rule.flags ?? ""}`;
    return rule.value;
}

function buildMetaLines(skin) {
    const lines = [];
    const push = (key, value) => {
        if (value !== undefined && value !== null && value !== "") lines.push(`@${key} ${value}`);
    };
    push("name", skin.name);
    push("namespace", skin.namespace);
    push("version", skin.version);
    push("description", skin.description);
    push("author", skin.author);
    push("license", skin.license);
    push("homepageURL", skin.homepageURL);
    push("supportURL", skin.supportURL);
    push("updateURL", skin.updateURL);
    push("preprocessor", skin.meta?.preprocessor);
    for (const v of skin.vars ?? []) lines.push(varLine(v));
    for (const r of skin.targets?.include ?? []) lines.push(`@oriel-match ${ruleText(r)}`);
    for (const r of skin.targets?.exclude ?? []) lines.push(`@oriel-exclude ${ruleText(r)}`);
    if (skin.runAt) lines.push(`@oriel-run-at ${skin.runAt}`);
    if (skin.allFrames) lines.push(`@oriel-all-frames true`);
    return lines.join("\n");
}

function buildCssBody(skin) {
    if (Array.isArray(skin.sections)) return skin.sections.map(sectionText).join("\n\n");
    if (Array.isArray(skin.css)) {
        return skin.css
            .map((sheet) => sectionText({ rules: sheet.targets?.include ?? [], css: sheet.text ?? "" }))
            .join("\n\n");
    }
    return "";
}

/**
 * Render a parsed-usercss shape (from {@link parseUserCss}) or an assembled
 * {@link import("./types.js").Skin} back to `.user.css` text. `core/skin.js`
 * calls this with the latter to power "Export"; the round trip with the
 * former is what proves the parser and printer agree with each other.
 *
 * @param {object} skin
 * @returns {string}
 */
export function stringifyUserCss(skin) {
    const meta = buildMetaLines(skin);
    const body = buildCssBody(skin);
    return `${OPEN}\n${meta}\n${CLOSE}\n\n${body}\n`;
}
