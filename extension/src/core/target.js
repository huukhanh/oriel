/**
 * Compiling target rules — the decision of whether a skin may touch a page.
 *
 * Pure functions of (rule, url). No DOM, no extension APIs: the content script,
 * the background page and the UI all ask this module the same question and must
 * get the same answer, and it has to be answerable in Node under vitest.
 *
 * The rules are normative in docs/SKIN-FORMAT.md §3. §3.3 is the paragraph to
 * keep in mind while editing this file: a rule that matches more than it says
 * hands a stranger's CSS and JS to a site the user never authorised. Every
 * ambiguity below is therefore resolved towards matching *less* — a skin that
 * silently fails to apply is a bug report, a skin that silently applies to a
 * bank is an incident.
 *
 * @module core/target
 */

import { SkinParseError, RULE_KINDS } from "./types.js";

/**
 * The schemes a pattern may name, and exactly what `<all_urls>` covers
 * (docs/SKIN-FORMAT.md §3.2). One list, so the two cannot drift apart. `*` is
 * not in it: as a scheme it means http|https, and nothing else.
 */
const PATTERN_SCHEMES = ["http", "https", "ws", "wss", "ftp", "data", "file"];

const ALL_URLS = "<all_urls>";

/**
 * `/body/flags` as written in a metadata block. `.+` is greedy so the *last*
 * slash is the delimiter, which is what makes `/^https:\/\/x\.com\//` work.
 * Flags are restricted to the real ones so that a path-shaped string like
 * `/a/b/c` is not mistaken for a regexp with the flags `c`.
 */
const SLASH_DELIMITED = /^\/(.+)\/([dgimsuvy]*)$/s;

/** Characters that must be escaped to appear literally in a RegExp. */
const RE_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/** In a glob, these two survive escaping as wildcards. `*` spans `/`; `?` is one character. */
const GLOB_WILDCARDS = { "*": "[\\s\\S]*", "?": "[\\s\\S]" };

/**
 * Sniff a bare string written by a human into a typed Rule.
 *
 * `skin.json` calls this with no options, so a bare string is a match pattern
 * (docs/SKIN-FORMAT.md §3.1); a userscript `@include` parser passes
 * `{ defaultKind: "glob" }`. Either way a string that parses as a match pattern
 * becomes one, because reading `*://*.example.com/*` as a glob would let the
 * leading `*` swallow a whole origin and match `https://evil.com/?q=x://a.example.com/`.
 *
 * @param {string|{kind: string, value: string, flags?: string}} value
 * @param {{defaultKind?: string}} [options]
 * @returns {{kind: string, value: string, flags?: string}}
 */
export function ruleFromString(value, options = {}) {
    if (value && typeof value === "object" && !Array.isArray(value)) return normalizeRule(value);
    if (typeof value !== "string" || !value.trim()) {
        throw new SkinParseError(`a target rule must be a non-empty string, got ${quote(value)}`);
    }

    const text = value.trim();
    const delimited = SLASH_DELIMITED.exec(text);
    if (delimited) return normalizeRule({ kind: "regexp", value: delimited[1], flags: delimited[2] });
    if (looksLikeMatchPattern(text)) return normalizeRule({ kind: "match", value: text });
    return normalizeRule({ kind: options.defaultKind ?? "match", value: text });
}

/**
 * Compile one rule to something with a fast `.test()`.
 *
 * A bare string is sniffed with {@link ruleFromString} first, so callers that
 * have not normalized yet still get the same semantics.
 *
 * @param {string|{kind: string, value: string, flags?: string}} rule
 * @returns {{kind: string, value: string, flags?: string, test: (url: string) => boolean}}
 */
export function compileRule(rule) {
    const normalized = ruleFromString(rule);
    return { ...normalized, test: COMPILERS[normalized.kind](normalized) };
}

/**
 * Compile an include/exclude set.
 *
 * A rule that does not compile is dropped from matching and recorded in
 * `errors`: one typo must not take the whole skin down, and must not be
 * invisible either (docs/SKIN-FORMAT.md §10).
 *
 * @param {{include?: unknown[], exclude?: unknown[]}} targets
 * @returns {{test: (url: string) => boolean, include: object[], exclude: object[], errors: object[]}}
 */
export function compileTargets(targets) {
    const errors = [];
    const include = compileSide(targets?.include, "include", errors);
    const exclude = compileSide(targets?.exclude, "exclude", errors);

    return {
        include,
        exclude,
        errors,
        test(url) {
            if (typeof url !== "string" || !url) return false;
            return include.some((rule) => rule.test(url)) && !exclude.some((rule) => rule.test(url));
        }
    };
}

/**
 * `compileTargets(...).test(url)`, memoized on the identity of `targets`.
 *
 * Identity, not contents: a `Targets` is built once by the parser and never
 * mutated, and hashing it on every URL change of every frame would cost more
 * than the compile it saves.
 *
 * @param {{include?: unknown[], exclude?: unknown[]}} targets
 * @param {string} url
 * @returns {boolean}
 */
export function matchesTargets(targets, url) {
    if (!targets || typeof targets !== "object") return false;
    let compiled = COMPILED.get(targets);
    if (!compiled) {
        compiled = compileTargets(targets);
        COMPILED.set(targets, compiled);
    }
    return compiled.test(url);
}

/**
 * Short human summary of the include set, for a list row: a host name when the
 * skin targets one site, a count when it targets several, "everywhere" when it
 * targets everything.
 *
 * @param {{include?: unknown[], exclude?: unknown[]}} targets
 * @returns {string}
 */
export function describeTargets(targets) {
    const { include } = compileTargets(targets);
    if (!include.length) return "nothing";
    if (include.some(matchesEverything)) return "everywhere";

    const hosts = new Set();
    let unnamed = 0;
    for (const rule of include) {
        const host = displayHost(rule);
        if (host) hosts.add(host);
        else unnamed += 1;
    }

    const total = hosts.size + unnamed;
    if (total === 1 && hosts.size === 1) return [...hosts][0];
    return `${total} site${total === 1 ? "" : "s"}`;
}

/**
 * Best-effort match patterns covering the include set, for `host_permissions`
 * and `scripting.registerContentScripts`.
 *
 * Only the origin is preserved; the path is widened to `/*` and the rule is
 * re-checked at runtime. Registration decides *where the content script loads*,
 * not what applies — being one origin too wide there is recoverable, being one
 * origin too narrow means a skin that never runs.
 *
 * @param {{include?: unknown[], exclude?: unknown[]}} targets
 * @returns {string[]}
 */
export function originPatterns(targets) {
    const { include } = compileTargets(targets);
    const patterns = [];
    for (const rule of include) {
        const pattern = originPattern(rule);
        if (!pattern || pattern === ALL_URLS) return [ALL_URLS];
        patterns.push(pattern);
    }
    return [...new Set(patterns)];
}

// --- rule normalization ---------------------------------------------------

const COMPILED = new WeakMap();

const quote = (value) => JSON.stringify(typeof value === "string" ? value : String(value));

function normalizeRule(rule) {
    const kind = String(rule.kind ?? "").trim().toLowerCase();
    if (!RULE_KINDS.includes(kind)) {
        throw new SkinParseError(
            `unknown rule kind ${quote(rule.kind)}; expected one of ${RULE_KINDS.join(", ")}`,
            { field: "kind" }
        );
    }

    const value = typeof rule.value === "string" ? rule.value.trim() : "";
    if (!value) throw new SkinParseError(`a ${kind} rule needs a value`, { field: "value" });

    // Flags exist only for the slash-delimited form; a bare JSON regexp has none.
    const flags = kind === "regexp" && typeof rule.flags === "string" ? rule.flags.trim() : "";
    return flags ? { kind, value, flags } : { kind, value };
}

function compileSide(rules, field, errors) {
    if (!Array.isArray(rules)) return [];
    const compiled = [];
    rules.forEach((rule, index) => {
        try {
            compiled.push(compileRule(rule));
        } catch (err) {
            const error = { message: err.message, field: `${field}[${index}]` };
            if (err.line !== undefined) error.line = err.line;
            errors.push(error);
        }
    });
    return compiled;
}

// --- match patterns -------------------------------------------------------

function looksLikeMatchPattern(text) {
    if (text === ALL_URLS) return true;
    try {
        parseMatchPattern(text);
        return true;
    } catch {
        return false;
    }
}

/**
 * `<scheme>://<host><path>` into its three parts, with the host canonicalized
 * the way `new URL()` canonicalizes one so the two can be compared directly.
 */
function parseMatchPattern(pattern) {
    const schemeEnd = pattern.indexOf("://");
    if (schemeEnd < 1) {
        throw new SkinParseError(`match pattern ${quote(pattern)} must be written <scheme>://<host>/<path>`);
    }

    const scheme = pattern.slice(0, schemeEnd).toLowerCase();
    if (scheme !== "*" && !PATTERN_SCHEMES.includes(scheme)) {
        throw new SkinParseError(
            `match pattern ${quote(pattern)} has an unsupported scheme ${quote(scheme)};` +
                ` expected * or one of ${PATTERN_SCHEMES.join(", ")}`
        );
    }

    const rest = pattern.slice(schemeEnd + 3);
    const pathStart = rest.indexOf("/");
    if (pathStart === -1) {
        throw new SkinParseError(
            `match pattern ${quote(pattern)} has no path, and a path is required;` +
                ` ${quote(`${pattern}/*`)} matches the whole host`
        );
    }

    const path = rest.slice(pathStart);
    if (path.includes("#")) {
        throw new SkinParseError(
            `match pattern ${quote(pattern)} contains a fragment; the fragment is stripped from a URL` +
                ` before it is matched, so this pattern could never match anything`
        );
    }

    return { scheme, host: parseMatchHost(rest.slice(0, pathStart), pattern, scheme), path };
}

function parseMatchHost(host, pattern, scheme) {
    if (scheme === "file") {
        if (host) throw new SkinParseError(`match pattern ${quote(pattern)} must have an empty host: file:///path`);
        return "";
    }
    if (!host) throw new SkinParseError(`match pattern ${quote(pattern)} needs a host`);
    if (host === "*") return "*";

    const star = host.indexOf("*");
    if (star > 0 || (star === 0 && !host.startsWith("*."))) {
        throw new SkinParseError(
            `match pattern ${quote(pattern)} may only use * as the whole host or as the leftmost label, as in *.example.com`
        );
    }

    // `#` and `?` would be swallowed by the URL parser below and silently
    // shorten the host, which is the one failure mode this file exists to stop.
    const literal = star === 0 ? host.slice(2) : host;
    if (!literal || /[*#?]/.test(literal)) {
        throw new SkinParseError(`match pattern ${quote(pattern)} has a malformed host ${quote(host)}`);
    }
    if (hasPort(literal)) {
        throw new SkinParseError(
            `match pattern ${quote(pattern)} names a port; Chrome honours it and Firefox ignores it,` +
                ` so Oriel rejects the pattern rather than matching different pages on different browsers`
        );
    }

    return (star === 0 ? "*." : "") + canonicalHost(literal, pattern);
}

/** IPv6 literals are full of colons, so only a colon after the `]` is a port. */
function hasPort(host) {
    return host.startsWith("[") ? host.indexOf(":", host.indexOf("]")) !== -1 : host.includes(":");
}

/**
 * Lowercase and punycode a host the same way the URL parser does, so that an
 * IDN written by the author compares equal to the `xn--` form a real URL has.
 */
function canonicalHost(host, context) {
    try {
        return new URL(`http://${host}`).hostname;
    } catch {
        throw new SkinParseError(`${quote(context)} has a host that is not a valid host name: ${quote(host)}`);
    }
}

function compileMatch(rule) {
    if (rule.value === ALL_URLS) {
        return (url) => {
            const parsed = parseURL(url);
            return !!parsed && PATTERN_SCHEMES.includes(schemeOf(parsed));
        };
    }

    const { scheme, host, path } = parseMatchPattern(rule.value);
    const testScheme = scheme === "*" ? (s) => s === "http" || s === "https" : (s) => s === scheme;
    const testHost = hostTester(host);
    const testPath = pathRegExp(path);

    return (url) => {
        const parsed = parseURL(url);
        if (!parsed) return false;
        if (!testScheme(schemeOf(parsed))) return false;
        if (!testHost(parsed.hostname)) return false;
        // The fragment is stripped before matching (§3.2), so `https://x.com/a`
        // still applies after the page scrolls to `#top`. Only `match` does
        // this; the other five kinds see the whole URL.
        return testPath.test(parsed.pathname + parsed.search);
    };
}

/**
 * `*.example.com` covers example.com and its subdomains and nothing else: the
 * dot is what stops it matching notexample.com, and the anchoring at the end of
 * `endsWith` is what stops it matching example.com.evil.com.
 */
function hostTester(host) {
    if (host === "*") return () => true;
    if (host === "") return (candidate) => candidate === "";
    if (host.startsWith("*.")) {
        const base = host.slice(2);
        const suffix = `.${base}`;
        return (candidate) => candidate === base || candidate.endsWith(suffix);
    }
    return (candidate) => candidate === host;
}

/** In a path, `*` is the only wildcard and it spans `/`. Everything else is literal. */
function pathRegExp(path) {
    return new RegExp(`^${path.split("*").map(escapeRegExp).join("[\\s\\S]*")}$`);
}

// --- the other five kinds -------------------------------------------------

function compileGlob(rule) {
    const body = rule.value.replace(RE_SPECIAL, (char) => GLOB_WILDCARDS[char] ?? `\\${char}`);
    const anchored = new RegExp(`^${body}$`, "i");
    return (url) => typeof url === "string" && anchored.test(url);
}

function compileRegExp(rule) {
    // `g` and `y` make RegExp stateful: a rule carrying either would match every
    // other call as lastIndex walked forward. They mean nothing to `.test()` here.
    const flags = (rule.flags ?? "").replace(/[gy]/g, "");
    let compiled;
    try {
        compiled = new RegExp(rule.value, flags);
    } catch (err) {
        throw new SkinParseError(`regexp rule ${quote(rule.value)} does not compile: ${err.message}`);
    }
    return (url) => typeof url === "string" && compiled.test(url);
}

function compileExactURL(rule) {
    return (url) => url === rule.value;
}

function compilePrefix(rule) {
    return (url) => typeof url === "string" && url.startsWith(rule.value);
}

function compileDomain(rule) {
    // A domain rule is compared against the host alone, so anything that could
    // only have come from a URL is a mistake worth reporting rather than a rule
    // that quietly matches nothing.
    if (/[\s/:?#@*]/.test(rule.value)) {
        throw new SkinParseError(
            `domain rule ${quote(rule.value)} must be a bare host name such as "example.com";` +
                ` it already covers every subdomain`
        );
    }

    const domain = canonicalHost(rule.value.toLowerCase(), rule.value);
    const suffix = `.${domain}`;
    return (url) => {
        const parsed = parseURL(url);
        if (!parsed) return false;
        return parsed.hostname === domain || parsed.hostname.endsWith(suffix);
    };
}

const COMPILERS = {
    match: compileMatch,
    glob: compileGlob,
    regexp: compileRegExp,
    url: compileExactURL,
    "url-prefix": compilePrefix,
    domain: compileDomain
};

// --- summaries and permissions --------------------------------------------

/**
 * The origin of a glob, when it has one it cannot lie about. A glob's `*` can
 * span `://` and `/`, so the answer is a guess — but a guess that is narrower
 * than the glob, which is the safe direction for a permission request.
 */
function globOrigin(value) {
    const match = /^(\*|https?|file|ftp|wss?):\/\/([^/]*)\//i.exec(value);
    if (!match) return null;

    const host = match[2].toLowerCase();
    const literal = host.startsWith("*.") ? host.slice(2) : host;
    if (host !== "*" && (literal.includes("*") || literal.includes("?"))) return null;
    return { scheme: match[1].toLowerCase(), host };
}

function matchesEverything(rule) {
    if (rule.kind === "glob") return rule.value === "*";
    if (rule.kind !== "match") return false;
    if (rule.value === ALL_URLS) return true;
    const { host, path } = parseMatchPattern(rule.value);
    return host === "*" && path === "/*";
}

/** A host to show a person, or null when the rule does not name one. */
function displayHost(rule) {
    if (rule.kind === "domain") return rule.value.toLowerCase();
    if (rule.kind === "url" || rule.kind === "url-prefix") return parseURL(rule.value)?.hostname || null;
    if (rule.kind === "glob") return stripWildcard(globOrigin(rule.value)?.host);
    if (rule.kind !== "match" || rule.value === ALL_URLS) return null;
    return stripWildcard(parseMatchPattern(rule.value).host);
}

function stripWildcard(host) {
    if (!host || host === "*") return null;
    return host.startsWith("*.") ? host.slice(2) : host;
}

function originPattern(rule) {
    switch (rule.kind) {
        case "match": {
            if (rule.value === ALL_URLS) return ALL_URLS;
            const { scheme, host } = parseMatchPattern(rule.value);
            return `${scheme}://${host}/*`;
        }
        case "domain":
            // `*.example.com` covers example.com itself, so one pattern is enough.
            return `*://*.${canonicalHost(rule.value.toLowerCase(), rule.value)}/*`;
        case "url":
        case "url-prefix":
            return urlOriginPattern(rule.value);
        case "glob": {
            const origin = globOrigin(rule.value);
            return origin ? `${origin.scheme}://${origin.host}/*` : null;
        }
        default:
            return null;
    }
}

function urlOriginPattern(value) {
    const parsed = parseURL(value);
    if (!parsed) return null;
    const scheme = schemeOf(parsed);
    if (!PATTERN_SCHEMES.includes(scheme)) return null;
    if (scheme === "file") return "file:///*";
    // A `data:` URL has no host, so there is no origin to ask permission for.
    return parsed.hostname ? `${scheme}://${parsed.hostname}/*` : null;
}

// --- small shared helpers -------------------------------------------------

function parseURL(url) {
    if (typeof url !== "string") return null;
    try {
        return new URL(url);
    } catch {
        return null;
    }
}

function schemeOf(parsed) {
    return parsed.protocol.slice(0, -1);
}

function escapeRegExp(text) {
    return text.replace(RE_SPECIAL, "\\$&");
}
