/**
 * Converts a Tampermonkey/Violentmonkey-style userscript metadata block into
 * Oriel's normalized shape (docs/SKIN-FORMAT.md §3 "Targeting" and §8
 * "JavaScript"). The world has hundreds of thousands of these; a user pasting
 * one in should get something that works, with warnings, not a rejection.
 *
 * The one place that philosophy stops: a script with no @match and no
 * @include gets NO include rules and an error, never "<all_urls>". Silently
 * matching everything is how a stranger's script ends up running on a
 * banking site (docs/SKIN-FORMAT.md §3.1, §3.2).
 *
 * @module core/userscript
 */

import { SkinParseError, RUN_AT } from "./types.js";

const [DOCUMENT_START, DOCUMENT_END, DOCUMENT_IDLE] = RUN_AT;

const OPEN_MARKER = /^[ \t]*\/\/[ \t]*==UserScript==[ \t]*$/;
const CLOSE_MARKER = /^[ \t]*\/\/[ \t]*==\/UserScript==[ \t]*$/;
const COMMENT_LINE = /^[ \t]*\/\/[ \t]*(.*)$/;
const META_KEY = /^@(\S+)[ \t]*(.*)$/;
// A Tampermonkey @include/@exclude value delimited like a JS regex literal:
// leading "/", a trailing "/" with only flag letters after it. Greedy .*
// naturally finds the *last* "/" as the closer, so escaped slashes earlier
// in the pattern (`\/`) don't get mistaken for the delimiter.
const REGEXP_LITERAL = /^\/(.*)\/([a-zA-Z]*)$/;

// Keys that may legitimately repeat. Everything else that repeats is almost
// always a paste mistake, so it warns and keeps the last value.
const MULTI_VALUED = new Set([
    "match", "include", "exclude", "exclude-match", "require", "resource", "grant", "connect"
]);

// Canonical (upper-cased, "." and whitespace folded to "_") form of every
// grant Oriel's GM shim provides, so "GM_getValue" and "GM.getValue" compare
// equal without hand-listing both spellings of each one.
const IMPLEMENTED_GRANTS = new Set([
    "GM_ADDSTYLE", "GM_GETVALUE", "GM_SETVALUE", "GM_DELETEVALUE", "GM_LISTVALUES",
    "GM_LOG", "GM_XMLHTTPREQUEST", "GM_GETRESOURCETEXT", "GM_GETRESOURCEURL",
    "GM_OPENINTAB", "GM_SETCLIPBOARD", "UNSAFEWINDOW"
]);

function normalizeNewlines(text) {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

// isUserScript and parseUserScript must agree on what counts as "a block",
// so both go through this rather than each guessing independently. A block
// needs both markers; an opened-but-never-closed block is treated the same
// as no block at all, since there is no principled place to stop reading it.
function findBlock(lines) {
    const start = lines.findIndex((line) => OPEN_MARKER.test(line));
    if (start === -1) return null;
    const closeOffset = lines.slice(start + 1).findIndex((line) => CLOSE_MARKER.test(line));
    if (closeOffset === -1) return null;
    return { start, end: start + 1 + closeOffset };
}

export function isUserScript(text) {
    if (typeof text !== "string") return false;
    return findBlock(normalizeNewlines(text).split("\n")) !== null;
}

function parseMetaLines(blockLines, blockStartLine, warnings) {
    const meta = {};
    const seenSingleValued = new Set();
    blockLines.forEach((line, i) => {
        const lineNo = blockStartLine + i;
        const comment = COMMENT_LINE.exec(line);
        const rest = comment ? comment[1] : null;
        const kv = rest === null ? null : META_KEY.exec(rest);
        if (!kv) {
            // A blank line, or a blank "//" line, is formatting, not a mistake.
            if ((rest ?? line).trim() !== "") {
                warnings.push(`line ${lineNo}: ignored malformed metadata line: ${line}`);
            }
            return;
        }
        const key = kv[1];
        const value = kv[2].trimEnd();
        (meta[key] ??= []).push(value);
        if (!MULTI_VALUED.has(key)) {
            if (seenSingleValued.has(key)) {
                warnings.push(`line ${lineNo}: @${key} repeated; using the last value`);
            }
            seenSingleValued.add(key);
        }
    });
    return meta;
}

function lastValue(meta, key) {
    const values = meta[key];
    return values && values.length ? values[values.length - 1] : undefined;
}

// "@name:fr" is recorded in `meta` under its own literal key — the locale is
// right there in the key, nothing is dropped or merged. This is only for
// resolving the *structured* field: the un-suffixed value wins when both
// exist, and a locale-only script still gets a usable value instead of a
// false "missing @name".
function localizedValue(meta, base) {
    const direct = lastValue(meta, base);
    if (direct !== undefined) return direct;
    const prefix = `${base}:`;
    const localized = Object.keys(meta).find((key) => key.startsWith(prefix));
    return localized ? lastValue(meta, localized) : undefined;
}

function sniffRule(raw) {
    const value = raw.trim();
    if (value === "*") return { kind: "match", value: "<all_urls>" };
    const m = REGEXP_LITERAL.exec(value);
    if (m) return { kind: "regexp", value: m[1] };
    return { kind: "glob", value };
}

function buildTargets(meta, errors) {
    const include = [
        ...(meta.match ?? []).map((v) => ({ kind: "match", value: v.trim() })),
        ...(meta.include ?? []).map(sniffRule)
    ];
    const exclude = [
        ...(meta["exclude-match"] ?? []).map((v) => ({ kind: "match", value: v.trim() })),
        ...(meta.exclude ?? []).map(sniffRule)
    ];
    if (include.length === 0) {
        errors.push(new SkinParseError(
            "no @match or @include: this script would run nowhere, so it has no include rules",
            { field: "targets" }
        ));
    }
    return { include, exclude };
}

function buildRunAt(meta, warnings) {
    const raw = lastValue(meta, "run-at");
    if (raw === undefined) return DOCUMENT_IDLE;
    const key = raw.trim().toLowerCase().replace(/-/g, "_");
    switch (key) {
        case "document_start":
        case "document_body":
            return DOCUMENT_START;
        case "document_end":
            return DOCUMENT_END;
        case "document_idle":
            return DOCUMENT_IDLE;
        case "context_menu":
            warnings.push("@run-at context-menu has no Oriel equivalent; treated as document-idle");
            return DOCUMENT_IDLE;
        default:
            warnings.push(`unknown @run-at value "${raw}"; treated as document-idle`);
            return DOCUMENT_IDLE;
    }
}

function buildWorld(meta, warnings) {
    const raw = lastValue(meta, "inject-into") ?? lastValue(meta, "world");
    if (raw === undefined) return "isolated";
    const key = raw.trim().toLowerCase();
    if (key === "page" || key === "main") return "main";
    if (key === "content" || key === "isolated") return "isolated";
    if (key === "auto") {
        warnings.push("@inject-into auto cannot be resolved ahead of time; treated as isolated");
        return "isolated";
    }
    warnings.push(`unknown @inject-into value "${raw}"; treated as isolated`);
    return "isolated";
}

// Real Tampermonkey runs in every frame unless @noframes opts out. Oriel
// inverts that by design (docs/SKIN-FORMAT.md §3: "a skin only enters
// subframes when allFrames is true"), so a converted script needs its own
// opt-in keys rather than inheriting Tampermonkey's opt-out default.
function buildAllFrames(meta, warnings) {
    const noframes = "noframes" in meta;
    const optIn = "oriel-all-frames" in meta || "allFrames" in meta;
    if (noframes && optIn) {
        warnings.push("@noframes conflicts with @allFrames/@oriel-all-frames; frames stay disabled");
        return false;
    }
    return optIn;
}

function canonicalGrant(value) {
    return value.toUpperCase().replace(/[.\s]+/g, "_");
}

function buildGrants(meta, warnings) {
    const grants = [];
    for (const raw of meta.grant ?? []) {
        const value = raw.trim();
        if (value.toLowerCase() === "none") continue;
        grants.push(value);
        if (!IMPLEMENTED_GRANTS.has(canonicalGrant(value))) {
            warnings.push(`@grant ${value} is not implemented by Oriel; the script may not fully work`);
        }
    }
    return grants;
}

function buildResources(meta, warnings) {
    const resources = [];
    for (const raw of meta.resource ?? []) {
        const m = /^(\S+)[ \t]+(\S.*)$/.exec(raw.trim());
        if (!m) {
            warnings.push(`ignored malformed @resource line, expected "<name> <url>": ${raw}`);
            continue;
        }
        resources.push({ name: m[1], url: m[2].trim() });
    }
    return resources;
}

function extractBody(lines, block) {
    if (!block) return lines.join("\n");
    return lines.slice(0, block.start).concat(lines.slice(block.end + 1)).join("\n");
}

function firstNonEmptyLine(text) {
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed !== "") return trimmed;
    }
    return undefined;
}

function buildName(meta, body, errors) {
    const named = localizedValue(meta, "name");
    if (named !== undefined && named.trim() !== "") return named;
    errors.push(new SkinParseError("missing @name", { field: "name" }));
    return firstNonEmptyLine(body) ?? "Untitled script";
}

export function parseUserScript(text) {
    const warnings = [];
    const errors = [];
    const source = typeof text === "string" ? text : "";
    const lines = normalizeNewlines(source).split("\n");
    const block = findBlock(lines);
    if (!block) {
        errors.push(new SkinParseError("no ==UserScript== metadata block found"));
    }
    const meta = block ? parseMetaLines(lines.slice(block.start + 1, block.end), block.start + 2, warnings) : {};
    const body = extractBody(lines, block);

    if (meta.require?.length) {
        warnings.push("@require URLs are fetched once at install time and stored with the skin, not fetched at run time");
    }
    if (meta.resource?.length) {
        warnings.push("@resource URLs are fetched once at install time and stored with the skin, not fetched at run time");
    }

    return {
        meta,
        name: buildName(meta, body, errors),
        namespace: lastValue(meta, "namespace") ?? "",
        version: lastValue(meta, "version") ?? "",
        description: localizedValue(meta, "description") ?? "",
        author: lastValue(meta, "author") ?? "",
        license: lastValue(meta, "license") ?? "",
        homepageURL: lastValue(meta, "homepageURL") ?? "",
        supportURL: lastValue(meta, "supportURL") ?? "",
        updateURL: lastValue(meta, "updateURL") ?? "",
        downloadURL: lastValue(meta, "downloadURL") ?? "",
        targets: buildTargets(meta, errors),
        runAt: buildRunAt(meta, warnings),
        world: buildWorld(meta, warnings),
        allFrames: buildAllFrames(meta, warnings),
        requires: (meta.require ?? []).map((v) => v.trim()),
        resources: buildResources(meta, warnings),
        grants: buildGrants(meta, warnings),
        body,
        warnings,
        errors
    };
}
