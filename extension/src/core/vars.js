/**
 * Vars — user-tunable values declared by a skin (docs/SKIN-FORMAT.md §6).
 *
 * Two independent jobs live here. `parseVarDeclaration` reads the Stylus
 * `@var` grammar as written in a `.user.css` metadata block (usercss.js calls
 * it once per line, after balancing any bracket/brace that spans lines).
 * Everything else works on already-structured {@link Var} objects, the shape
 * both `skin.json` and a parsed `.user.css` converge on, and is what
 * `core/skin.js` calls to turn declarations plus user choices into CSS.
 *
 * Pure: no DOM, no storage. A var's value only ever becomes untrusted CSS
 * text, so every place that writes one into a stylesheet — `cssVariableBlock`,
 * `substituteCss` — treats it as attacker-controlled and refuses to emit
 * anything containing `}` or `<`.
 *
 * @module core/vars
 */

import { SkinParseError, VAR_TYPES } from "./types.js";

// Stylus's own six keywords, plus the two Oriel accepts because skin.json
// declares them as real types: both collapse to "select" here because their
// @var grammar (an option list) is identical to select's. skin.json's own
// `image` type is a different thing and never comes through this parser.
const TYPE_ALIASES = {
    text: "text",
    color: "color",
    checkbox: "checkbox",
    number: "number",
    range: "range",
    select: "select",
    dropdown: "select",
    image: "select"
};

const KEY_RE = /^[\w-]+/;

/**
 * Parse one `@var <type> <rest>` (or `@advanced`) declaration.
 *
 * `rest` is everything after the type keyword — key, quoted label, default —
 * and may itself span multiple source lines when the default is a
 * bracket-balanced array or object; the caller is responsible for handing
 * over the whole balanced text.
 *
 * @param {string} type
 * @param {string} rest
 * @returns {import("./types.js").Var}
 */
export function parseVarDeclaration(type, rest) {
    const canonicalType = TYPE_ALIASES[String(type ?? "").trim().toLowerCase()];
    if (!canonicalType) {
        throw new SkinParseError(`@var has an unknown type "${type}"`, { field: "vars" });
    }

    const text = String(rest ?? "");
    const keyMatch = KEY_RE.exec(text.trimStart());
    if (!keyMatch) {
        throw new SkinParseError(`@var ${type} is missing its key`, { field: "vars" });
    }
    const key = keyMatch[0];
    const afterKey = text.slice(text.indexOf(key) + key.length);

    const labelResult = readQuotedLabel(afterKey);
    if (!labelResult) {
        throw new SkinParseError(`@var ${key} is missing its "label"`, { field: "vars", key });
    }
    const [label, tooltip] = splitLabel(labelResult.value);

    const v = { key, type: canonicalType, label };
    if (tooltip) v.tooltip = tooltip;
    applyDefault(v, canonicalType, labelResult.rest.trim());
    return v;
}

function readQuotedLabel(text) {
    const start = /^\s*/.exec(text)[0].length;
    if (text[start] !== '"') return null;
    return parseQuotedString(text.slice(start));
}

// A literal two-character `\n` inside the label — not a real newline, since a
// `@var` line (outside its bracket-balanced default) is always one physical
// line — is Stylus's separator between the label and a tooltip.
function splitLabel(raw) {
    const at = raw.indexOf("\\n");
    if (at === -1) return [raw, undefined];
    return [raw.slice(0, at), raw.slice(at + 2)];
}

/** Double-quoted string starting at `text[0] === '"'`. Honours `\"` and `\\`. */
function parseQuotedString(text) {
    if (text[0] !== '"') return null;
    let out = "";
    let i = 1;
    while (i < text.length) {
        const c = text[i];
        if (c === "\\" && (text[i + 1] === '"' || text[i + 1] === "\\")) {
            out += text[i + 1];
            i += 2;
            continue;
        }
        if (c === '"') return { value: out, rest: text.slice(i + 1) };
        out += c;
        i++;
    }
    return null; // unterminated
}

function applyDefault(v, type, text) {
    switch (type) {
        case "text":
            applyTextDefault(v, text);
            return;
        case "color":
            if (!text) throw new SkinParseError(`@var ${v.key} is missing its default colour`, { field: "vars" });
            v.default = text;
            return;
        case "checkbox":
            applyCheckboxDefault(v, text);
            return;
        case "number":
        case "range":
            applyNumericDefault(v, text);
            return;
        case "select":
            applySelectDefault(v, text);
            return;
    }
}

function applyTextDefault(v, text) {
    if (text.startsWith('"')) {
        const parsed = parseQuotedString(text);
        if (!parsed) throw new SkinParseError(`@var ${v.key} has an unterminated default value`, { field: "vars" });
        let value = parsed.value;
        // "'val:ue'" — double-then-single quoting, used when the default
        // contains a `:` that would otherwise be ambiguous. Strip both layers.
        if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
            value = value.slice(1, -1);
        }
        v.default = value;
        return;
    }
    v.default = text;
}

function applyCheckboxDefault(v, text) {
    const trimmed = text.trim();
    if (trimmed !== "0" && trimmed !== "1") {
        throw new SkinParseError(`@var ${v.key} checkbox default must be 0 or 1, got ${JSON.stringify(text)}`, {
            field: "vars"
        });
    }
    v.default = trimmed === "1" ? 1 : 0;
}

function applyNumericDefault(v, text) {
    let arr;
    try {
        arr = JSON.parse(text);
    } catch (error) {
        // JSON.parse rejecting a bare `.5` (no leading zero) is exactly the
        // Stylus trap this is meant to catch — not worked around.
        throw new SkinParseError(`@var ${v.key} default must be a JSON array like [default, min, max, step, "units"]: ${error.message}`, {
            field: "vars"
        });
    }
    if (!Array.isArray(arr) || arr.length === 0) {
        throw new SkinParseError(`@var ${v.key} default must be a non-empty JSON array`, { field: "vars" });
    }
    const numbers = arr.filter((x) => typeof x === "number" && Number.isFinite(x));
    const units = arr.find((x) => typeof x === "string");
    const [def, min, max, step] = numbers;
    if (def === undefined) {
        throw new SkinParseError(`@var ${v.key} needs at least a default value`, { field: "vars" });
    }
    v.default = def;
    if (min !== undefined) v.min = min;
    if (max !== undefined) v.max = max;
    if (step !== undefined) v.step = step;
    if (units !== undefined) v.units = units;
}

function applySelectDefault(v, text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new SkinParseError(`@var ${v.key} default must be a JSON array or object of options: ${error.message}`, {
            field: "vars"
        });
    }

    let entries;
    if (Array.isArray(parsed)) {
        entries = parsed.map((raw) => {
            const { key, label, isDefault } = parseOptionKeyLabel(String(raw));
            return { key, label, value: key, isDefault };
        });
    } else if (parsed && typeof parsed === "object") {
        // Object form: key is `OPTION_KEY:OPTION_LABEL` — key first, label
        // second, the opposite of what most people guess on first read.
        entries = Object.entries(parsed).map(([rawKey, value]) => {
            const { key, label, isDefault } = parseOptionKeyLabel(rawKey);
            return { key, label, value: String(value), isDefault };
        });
    } else {
        throw new SkinParseError(`@var ${v.key} default must be a JSON array or object of options`, { field: "vars" });
    }

    if (entries.length === 0) {
        throw new SkinParseError(`@var ${v.key} has no options`, { field: "vars" });
    }

    const chosen = entries.find((e) => e.isDefault) ?? entries[0];
    v.options = entries.map(({ key, label, value }) => ({ key, label, value }));
    v.default = chosen.key;
}

/** `key`, `key:Label`, or either with a trailing `*` marking it the default. */
function parseOptionKeyLabel(raw) {
    let str = raw;
    let isDefault = false;
    if (str.endsWith("*")) {
        isDefault = true;
        str = str.slice(0, -1);
    }
    const colon = str.indexOf(":");
    if (colon === -1) return { key: str, label: str, isDefault };
    return { key: str.slice(0, colon), label: str.slice(colon + 1), isDefault };
}

/**
 * Validate and normalize an array of already-structured var descriptors —
 * the shape `skin.json`'s `vars` field uses directly. Never throws: one bad
 * entry is dropped and reported, not fatal to the rest of the skin.
 *
 * @param {unknown[]} raw
 * @returns {{vars: import("./types.js").Var[], errors: import("./types.js").SkinError[]}}
 */
export function normalizeVars(raw) {
    const vars = [];
    const errors = [];
    const seen = new Set();

    const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
    list.forEach((entry, i) => {
        const field = `vars[${i}]`;
        if (!entry || typeof entry !== "object") {
            errors.push({ message: `${field}: a var must be an object`, field });
            return;
        }
        const key = typeof entry.key === "string" ? entry.key.trim() : "";
        if (!/^[\w-]+$/.test(key)) {
            errors.push({ message: `${field}: missing or invalid "key"`, field });
            return;
        }
        if (seen.has(key)) {
            errors.push({ message: `${field}: duplicate var key "${key}"`, field });
            return;
        }
        if (!VAR_TYPES.includes(entry.type)) {
            errors.push({ message: `${field}: unknown var type ${JSON.stringify(entry.type)}`, field });
            return;
        }
        if (entry.default === undefined || entry.default === null) {
            errors.push({ message: `${field}: var "${key}" needs a default`, field });
            return;
        }

        const v = {
            key,
            type: entry.type,
            label: typeof entry.label === "string" && entry.label ? entry.label : key,
            default: entry.default
        };
        if (typeof entry.tooltip === "string" && entry.tooltip) v.tooltip = entry.tooltip;
        if (Number.isFinite(entry.min)) v.min = entry.min;
        if (Number.isFinite(entry.max)) v.max = entry.max;
        if (Number.isFinite(entry.step)) v.step = entry.step;
        if (typeof entry.units === "string" && entry.units) v.units = entry.units;
        if (Array.isArray(entry.options)) {
            v.options = entry.options
                .filter((o) => o && typeof o.key === "string")
                .map((o) => ({
                    key: o.key,
                    label: typeof o.label === "string" ? o.label : o.key,
                    value: o.value !== undefined ? String(o.value) : o.key
                }));
        }

        seen.add(key);
        vars.push(v);
    });

    return { vars, errors };
}

/**
 * @param {import("./types.js").Var[]} vars
 * @returns {Record<string, string|number>}
 */
export function defaultValues(vars) {
    const result = {};
    for (const v of vars) result[v.key] = coerceValue(v, v.default);
    return result;
}

/**
 * Force an arbitrary value into what its var's type can actually hold.
 * Anything unusable falls back to the var's own default, never to a crash —
 * this runs on values that came from storage or from a pasted skin update,
 * neither of which is trustworthy.
 *
 * @param {import("./types.js").Var} v
 * @param {*} value
 * @returns {string|number}
 */
export function coerceValue(v, value) {
    switch (v.type) {
        case "checkbox":
            if (value === 1 || value === "1" || value === true) return 1;
            if (value === 0 || value === "0" || value === false) return 0;
            return v.default === 1 || v.default === "1" ? 1 : 0;
        case "number":
        case "range": {
            const n = Number(value);
            return clampNumber(v, Number.isFinite(n) ? n : Number(v.default));
        }
        case "select":
        case "image": {
            const options = Array.isArray(v.options) ? v.options : [];
            const key = String(value);
            if (options.some((o) => o.key === key)) return key;
            return v.default;
        }
        default: // text, color
            if (typeof value === "string") return value;
            if (typeof value === "number") return String(value);
            return v.default;
    }
}

function clampNumber(v, n) {
    if (!Number.isFinite(n)) return 0;
    let result = n;
    if (Number.isFinite(v.min) && result < v.min) result = v.min;
    if (Number.isFinite(v.max) && result > v.max) result = v.max;
    if (Number.isFinite(v.step) && v.step > 0) {
        const base = Number.isFinite(v.min) ? v.min : 0;
        result = base + Math.round((result - base) / v.step) * v.step;
        if (Number.isFinite(v.min) && result < v.min) result = v.min;
        if (Number.isFinite(v.max) && result > v.max) result = v.max;
    }
    return result;
}

function unsafeForCss(value) {
    return typeof value === "string" && /[}<]/.test(value);
}

/**
 * The `:root { --key: value; }` block that makes every var live-updatable
 * without re-injecting a stylesheet (docs/SKIN-FORMAT.md §6.2 mode 1).
 *
 * @param {import("./types.js").Var[]} vars
 * @param {Record<string, string|number>} values
 * @param {string} [selector]
 * @returns {string}
 */
export function cssVariableBlock(vars, values, selector = ":root") {
    const lines = [];
    for (const v of vars) {
        const raw = values && Object.hasOwn(values, v.key) ? values[v.key] : v.default;

        if (v.type === "select" || v.type === "image") {
            const options = Array.isArray(v.options) ? v.options : [];
            const key = String(raw);
            const opt = options.find((o) => o.key === key) ?? options[0];
            if (!opt || unsafeForCss(opt.value) || unsafeForCss(opt.key)) continue;
            lines.push(`  --${v.key}: ${opt.value};`);
            lines.push(`  --${v.key}-key: ${opt.key};`);
            continue;
        }

        const cssValue = v.type === "number" || v.type === "range" ? `${raw}${v.units ?? ""}` : String(raw);
        if (unsafeForCss(cssValue)) continue;
        lines.push(`  --${v.key}: ${cssValue};`);
    }
    if (!lines.length) return "";
    return `${selector} {\n${lines.join("\n")}\n}`;
}

/**
 * Replace every `/*[[key]]*\/` placeholder with its value (docs/SKIN-FORMAT.md
 * §6.2 mode 2). A key with no matching var is left exactly as written — the
 * placeholder survives untouched rather than being silently blanked.
 *
 * @param {string} css
 * @param {import("./types.js").Var[]} vars
 * @param {Record<string, string|number>} values
 * @returns {string}
 */
export function substituteCss(css, vars, values) {
    return String(css).replace(/\/\*\[\[([\w-]+)\]\]\*\//g, (match, key) => {
        const v = vars.find((x) => x.key === key);
        if (!v) return match;
        const raw = values && Object.hasOwn(values, key) ? values[key] : v.default;

        if (v.type === "select" || v.type === "image") {
            const options = Array.isArray(v.options) ? v.options : [];
            const opt = options.find((o) => o.key === String(raw)) ?? options[0];
            return opt ? String(opt.value) : match;
        }
        if (v.type === "number" || v.type === "range") return `${raw}${v.units ?? ""}`;
        return String(raw);
    });
}

/**
 * `{{key}}` substitution for DOM-op string fields and skin JS interpolation
 * (docs/SKIN-FORMAT.md §6.2 mode 3). Same unknown-key policy as
 * {@link substituteCss}: left untouched, not blanked.
 *
 * @param {string} text
 * @param {Record<string, string|number>} values
 * @returns {string}
 */
export function interpolate(text, values) {
    return String(text).replace(/\{\{\s*([\w-]+)\s*\}\}/g, (match, key) => {
        if (!values || !Object.hasOwn(values, key)) return match;
        const value = values[key];
        return value === undefined || value === null ? match : String(value);
    });
}
