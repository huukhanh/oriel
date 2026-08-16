/**
 * Turning what a user pastes into an import box — a URL, a GitHub shorthand,
 * or a link to a file, a directory, a repo, a gist, a release asset — into a
 * list of concrete bytes-URLs to try, in the order they should be tried.
 *
 * Pure URL algebra: no `fetch`, no browser globals. `background/install.js`
 * is the only caller that actually makes a request; this module just decides
 * what to request and in what order. That split is what makes the interesting
 * half of "import a skin from a link" testable in Node.
 *
 * @module core/source
 */

/**
 * @typedef {object} Candidate
 * @property {string} url
 * @property {"raw"|"api"} via
 * @property {"skin"|"listing"} expects  A "listing" response is JSON to be
 *   turned back into more candidates (see `background/install.js`), not a skin.
 * @property {string} [note]
 */

/**
 * @typedef {object} Resolved
 * @property {"github-file"|"github-dir"|"github-repo"|"gist"|"release-asset"|"raw"|"url"|"unknown"} kind
 * @property {string} [owner]
 * @property {string} [repo]
 * @property {string} [ref]
 * @property {string} [path]
 * @property {string} [gistId]
 * @property {Candidate[]} candidates
 * @property {string} describe  One line, shown to the user as-is.
 */

/**
 * Manifest before stylesheet: a `skin.json` can point at whatever CSS file it
 * likes, so it is worth trying first even though a bare `*.user.css` is the
 * more common single-file skin.
 */
export const SKIN_FILENAMES = ["skin.json", "skin.user.css"];

/** @param {string} name @returns {boolean} */
export function isSkinFilename(name) {
    return typeof name === "string" && (name === "skin.json" || /\.user\.css$/i.test(name));
}

/**
 * Text that is unmistakably the start of skin source, not a link to one —
 * a UserCSS/Stylus comment or metadata line, or a bare JSON/CSS opening
 * brace. Checked against the raw, untrimmed-of-meaning input so a skin whose
 * first line happens to contain a URL (in a comment, in `@updateURL`) is
 * never sent through the fetch path instead of the paste path.
 */
const SKIN_SOURCE_START = /^(\/\*|\/\/|@-moz-document\b|\{)/;

/** A locator is a single token: a URL or an `owner/repo` shorthand, never multiple lines. */
const HAS_WHITESPACE = /\s/;

/** Schemes worth recognising as "this is a URI", including the ones we go on to refuse. */
const URI_SCHEME = /^(https?|javascript|data|file):/i;

/** GitHub username rules, loosely: alnum and single hyphens, capped at 39 characters. */
const OWNER_RE = /^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$/;

/** Repo names allow dots and underscores that usernames don't. */
const REPO_RE = /^[A-Za-z0-9._-]+$/;

/** `owner/repo`, `owner/repo@ref`, `owner/repo/path`, `owner/repo@ref/path`. */
const SHORTHAND_RE = /^([^\s@/]+)\/([^\s@/]+)(@[^\s/]+)?(\/.*)?$/;

/**
 * Decides paste-vs-fetch for the import box. Deliberately shallow: the actual
 * refusal of dangerous schemes and malformed links happens in
 * {@link resolveLocator}, which can give a precise reason. This function only
 * has to tell "one link" apart from "a chunk of skin source".
 *
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeLocator(text) {
    if (typeof text !== "string") return false;
    const trimmed = text.trim();
    if (!trimmed || HAS_WHITESPACE.test(trimmed) || SKIN_SOURCE_START.test(trimmed)) return false;
    return URI_SCHEME.test(trimmed) || SHORTHAND_RE.test(trimmed);
}

/**
 * @param {string} input
 * @returns {Resolved}
 */
export function resolveLocator(input) {
    const text = typeof input === "string" ? input.trim() : "";
    if (!text) return unknown("nothing to resolve");
    if (SKIN_SOURCE_START.test(text)) {
        return unknown("that looks like skin source, not a link to one — paste it directly instead");
    }

    let url;
    try {
        url = new URL(text);
    } catch {
        const shorthand = parseShorthand(text);
        if (shorthand) return resolveGithubPath(shorthand);
        return unknown(`"${truncate(text)}" isn't a URL or an owner/repo link Oriel recognises`);
    }

    return resolveURL(url);
}

/**
 * `resolvedUrl` is whatever actually got fetched — almost always already a
 * `raw.githubusercontent.com` or `gist.githubusercontent.com` URL, because
 * {@link resolveLocator} always prefers those candidates. Update polling must
 * land back on one of those two hosts: GitHub's unauthenticated REST API
 * (`api.github.com`) is capped at 60 requests/hour/IP, but the raw content
 * hosts are served by a CDN and carry no such quota. Anything else — a
 * generic URL, a release asset's signed (and CORS-less, and expiring)
 * redirect target — is not a host we can promise will still answer the same
 * way next week, so there is nothing safe to derive; the skin's own
 * `@updateURL`, if it declared one, is what governs updates instead.
 *
 * @param {string} resolvedUrl
 * @returns {string|null}
 */
export function deriveUpdateURL(resolvedUrl) {
    const parsed = parseURL(resolvedUrl);
    if (!parsed) return null;
    if (parsed.hostname === "raw.githubusercontent.com" || parsed.hostname === "gist.githubusercontent.com") {
        return stripQueryHash(parsed).href;
    }
    return null;
}

/**
 * The nicer, browsable github.com/gist.github.com equivalent of a raw or API
 * URL, for display. Returns the input unchanged when there is no nicer form
 * to compute, and null only when the input isn't a URL at all.
 *
 * @param {string} resolvedUrl
 * @returns {string|null}
 */
export function humanURL(resolvedUrl) {
    const parsed = parseURL(resolvedUrl);
    if (!parsed) return null;

    if (parsed.hostname === "raw.githubusercontent.com") {
        const [, owner, repo, ref, ...rest] = parsed.pathname.split("/");
        if (owner && repo && ref && rest.length) {
            return `https://github.com/${owner}/${repo}/blob/${ref}/${rest.join("/")}`;
        }
    }

    if (parsed.hostname === "gist.githubusercontent.com") {
        const [, user, gistId] = parsed.pathname.split("/");
        if (user && gistId) return `https://gist.github.com/${user}/${gistId}`;
    }

    if (parsed.hostname === "api.github.com") {
        const m = /^\/repos\/([^/]+)\/([^/]+)\/contents\/?(.*)$/.exec(parsed.pathname);
        if (m) {
            const [, owner, repo, path] = m;
            const ref = parsed.searchParams.get("ref") || "HEAD";
            return `https://github.com/${owner}/${repo}/tree/${ref}${path ? `/${path}` : ""}`;
        }
        if (/^\/gists\/([^/]+)$/.test(parsed.pathname)) {
            return `https://gist.github.com/${parsed.pathname.split("/")[2]}`;
        }
    }

    return parsed.href;
}

// --- refusing ---------------------------------------------------------------

function unknown(reason) {
    return { kind: "unknown", candidates: [], describe: reason };
}

function resolveURL(url) {
    const scheme = url.protocol.slice(0, -1).toLowerCase();

    if (scheme === "javascript" || scheme === "data" || scheme === "file") {
        return unknown(`refusing to fetch a "${scheme}:" URL`);
    }
    if (url.username || url.password) {
        return unknown("refusing a URL with credentials in it");
    }
    if (scheme !== "http" && scheme !== "https") {
        return unknown(`"${scheme}:" isn't a scheme Oriel fetches`);
    }

    const insecure = scheme === "http";
    const host = url.hostname.toLowerCase();

    if (host === "github.com" || host === "www.github.com") return resolveGithubCom(url, insecure);
    if (host === "gist.github.com") return resolveGistCom(url, insecure);
    if (host === "raw.githubusercontent.com" || host === "gist.githubusercontent.com") {
        return withInsecureNote(
            {
                kind: "raw",
                candidates: [{ url: stripQueryHash(url).href, via: "raw", expects: "skin" }],
                describe: `raw file at ${host}`
            },
            insecure
        );
    }

    return withInsecureNote(
        { kind: "url", candidates: [{ url: url.href, via: "raw", expects: "skin" }], describe: `URL: ${url.href}` },
        insecure
    );
}

function withInsecureNote(resolved, insecure) {
    if (!insecure) return resolved;
    return { ...resolved, describe: `${resolved.describe} (plain http — not encrypted in transit)` };
}

// --- github.com ---------------------------------------------------------------

function resolveGithubCom(url, insecure) {
    const segments = segmentsOf(url.pathname);
    const [owner, repo, mode, ...rest] = segments;

    if (!owner || !repo) {
        return withInsecureNote(
            { kind: "url", candidates: [{ url: url.href, via: "raw", expects: "skin" }], describe: `URL: ${url.href}` },
            insecure
        );
    }

    if (mode === "blob" || mode === "raw") {
        if (!rest.length) return malformed(url);
        const { ref, path, note } = splitRefPath(rest);
        return withInsecureNote(resolveGithubPath({ kind: "github-file", owner, repo, ref, path, note }), insecure);
    }

    if (mode === "tree" || mode === undefined) {
        if (!rest.length) {
            return withInsecureNote(resolveGithubPath({ kind: "github-repo", owner, repo, ref: rest[0] }), insecure);
        }
        const { ref, path, note } = splitRefPath(rest);
        if (!path) return withInsecureNote(resolveGithubPath({ kind: "github-repo", owner, repo, ref, note }), insecure);
        return withInsecureNote(resolveGithubPath({ kind: "github-dir", owner, repo, ref, path, note }), insecure);
    }

    if (mode === "releases" && rest[0] === "download" && rest.length >= 3) {
        const tag = rest[1];
        const assetPath = rest.slice(2).join("/");
        const href = `https://github.com/${encodeSegment(owner)}/${encodeSegment(repo)}/releases/download/${encodePath(tag)}/${encodePath(assetPath)}`;
        return withInsecureNote(
            {
                kind: "release-asset",
                owner,
                repo,
                ref: tag,
                path: assetPath,
                // Release assets 302 to a signed, time-limited URL with no
                // Access-Control-Allow-Origin header — unlike raw.githubusercontent.com,
                // gist.githubusercontent.com and api.github.com, which all send `*`.
                // Fetching this only works because the extension holds a host
                // permission for github.com, not because of CORS.
                candidates: [
                    { url: href, via: "raw", expects: "skin", note: "release asset — fetched via host permission, not CORS" }
                ],
                describe: `GitHub release asset: ${owner}/${repo} ${tag}/${assetPath}`
            },
            insecure
        );
    }

    return withInsecureNote(
        { kind: "url", candidates: [{ url: url.href, via: "raw", expects: "skin" }], describe: `URL: ${url.href}` },
        insecure
    );
}

function malformed(url) {
    return unknown(`"${truncate(url.href)}" is missing the ref/path a github.com blob link needs`);
}

/**
 * A ref may itself contain `/` (a branch called `feat/x`), which makes the
 * split between "ref" and "path" ambiguous whenever both are present — GitHub's
 * own web UI has this same problem. We always take the shortest possible ref
 * (the first segment) and treat everything else as path, and say so, rather
 * than guess at a longer ref that might not exist.
 */
function splitRefPath(segments) {
    const [ref, ...pathSegments] = segments;
    const path = pathSegments.join("/");
    const note = pathSegments.length
        ? `assuming ref "${ref}"; if the branch name itself contains "/", edit the ref`
        : undefined;
    return { ref, path, note };
}

function resolveGistCom(url, insecure) {
    const segments = segmentsOf(url.pathname);
    const user = segments.length > 1 ? segments[0] : undefined;
    const gistId = segments.length > 1 ? segments[1] : segments[0];
    if (!gistId) return unknown(`"${truncate(url.href)}" isn't a gist link Oriel recognises`);
    return withInsecureNote(buildGistCandidates(user, gistId), insecure);
}

function buildGistCandidates(user, gistId) {
    // GitHub resolves a gist raw URL by id alone; the username segment isn't
    // checked, so a missing one is filled in rather than treated as an error.
    const owner = user || "gist";
    const rawGuess = {
        url: `https://gist.githubusercontent.com/${encodeSegment(owner)}/${encodeSegment(gistId)}/raw/`,
        via: "raw",
        expects: "skin",
        note: "guessing the gist has a single file"
    };
    const apiListing = {
        url: `https://api.github.com/gists/${encodeSegment(gistId)}`,
        via: "api",
        expects: "listing",
        note: "listing the gist's files"
    };
    return {
        kind: "gist",
        gistId,
        candidates: [rawGuess, apiListing],
        describe: user ? `GitHub Gist ${gistId} (${user})` : `GitHub Gist ${gistId}`
    };
}

/**
 * The one place raw/API candidates get built, for a `{owner, repo, ref, path}`
 * already extracted from either a github.com URL or an `owner/repo` shorthand.
 */
function resolveGithubPath({ kind, owner, repo, ref, path, note }) {
    if (kind === "github-file") {
        const effectiveRef = ref || "HEAD";
        return {
            kind,
            owner,
            repo,
            ref: effectiveRef,
            path,
            candidates: [{ url: rawGithubURL(owner, repo, effectiveRef, path), via: "raw", expects: "skin", note }],
            describe: `GitHub file: ${owner}/${repo}@${effectiveRef}/${path}`
        };
    }

    if (kind === "github-dir") {
        const effectiveRef = ref || "HEAD";
        return {
            kind,
            owner,
            repo,
            ref: effectiveRef,
            path,
            candidates: dirCandidates(owner, repo, effectiveRef, path, note),
            describe: `GitHub directory: ${owner}/${repo}@${effectiveRef}/${path}`
        };
    }

    // github-repo: no path was given at all, so guess at the root and offer
    // API listings of the root and the two conventional skin directories.
    const effectiveRef = ref || "HEAD";
    return {
        kind: "github-repo",
        owner,
        repo,
        ref: effectiveRef,
        candidates: [
            ...SKIN_FILENAMES.map((name) => ({
                url: rawGithubURL(owner, repo, effectiveRef, name),
                via: "raw",
                expects: "skin",
                note
            })),
            listingCandidate(owner, repo, "", effectiveRef, "the repository root"),
            listingCandidate(owner, repo, "skins", effectiveRef, "skins/"),
            listingCandidate(owner, repo, "styles", effectiveRef, "styles/")
        ],
        describe: `GitHub repository: ${owner}/${repo}@${effectiveRef}`
    };
}

function dirCandidates(owner, repo, ref, dir, note) {
    // Raw candidates come before the API listing: GitHub's unauthenticated
    // REST API is capped at 60 requests/hour/IP, so a guess that lands
    // directly on raw.githubusercontent.com (CDN-served, no quota) must never
    // pay for a round trip the common case didn't need.
    const guesses = SKIN_FILENAMES.map((name) => ({
        url: rawGithubURL(owner, repo, ref, `${dir}/${name}`),
        via: "raw",
        expects: "skin",
        note
    }));
    return [...guesses, listingCandidate(owner, repo, dir, ref, dir)];
}

function listingCandidate(owner, repo, dir, ref, label) {
    return { url: apiContentsURL(owner, repo, dir, ref), via: "api", expects: "listing", note: `listing ${label}` };
}

// --- owner/repo shorthand ---------------------------------------------------

function parseShorthand(text) {
    const m = SHORTHAND_RE.exec(text);
    if (!m) return null;
    const [, owner, repo, refPart, pathPart] = m;
    if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) return null;

    const ref = refPart ? refPart.slice(1) : undefined;
    const rawPath = pathPart ? pathPart.slice(1) : "";
    const dirHint = rawPath.endsWith("/");
    const path = rawPath.replace(/\/+$/, "");
    const note = ref && path ? `assuming ref "${ref}"; if the branch name itself contains "/", edit the ref` : undefined;

    if (!path) return { kind: "github-repo", owner, repo, ref, note };
    return { kind: dirHint ? "github-dir" : "github-file", owner, repo, ref, path, note };
}

// --- URL building ------------------------------------------------------------

function rawGithubURL(owner, repo, ref, path) {
    const tail = path ? `/${encodePath(path)}` : "";
    return `https://raw.githubusercontent.com/${encodeSegment(owner)}/${encodeSegment(repo)}/${encodePath(ref)}${tail}`;
}

function apiContentsURL(owner, repo, path, ref) {
    const tail = path ? `/${encodePath(path)}` : "";
    const qs = new URLSearchParams({ ref });
    return `https://api.github.com/repos/${encodeSegment(owner)}/${encodeSegment(repo)}/contents${tail}?${qs}`;
}

/** Decode-then-reencode each `/`-separated segment, so an already-escaped input is never double-escaped. */
function encodePath(path) {
    return path.split("/").map(encodeSegment).join("/");
}

function encodeSegment(segment) {
    let decoded = segment;
    try {
        decoded = decodeURIComponent(segment);
    } catch {
        // Not a valid escape sequence — a literal "%" meant literally. Encode as given.
    }
    return encodeURIComponent(decoded);
}

// --- small shared helpers ----------------------------------------------------

function segmentsOf(pathname) {
    return pathname.replace(/\/+$/, "").split("/").filter(Boolean);
}

function stripQueryHash(url) {
    const copy = new URL(url.href);
    copy.search = "";
    copy.hash = "";
    return copy;
}

function parseURL(value) {
    if (typeof value !== "string") return null;
    try {
        return new URL(value);
    } catch {
        return null;
    }
}

function truncate(text) {
    return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}
