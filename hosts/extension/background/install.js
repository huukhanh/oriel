/**
 * Getting a skin from the outside world into storage.
 *
 * Two doors, one corridor: pasted text and a GitHub link end up in the same
 * `skinFromText` funnel. The link path is the interesting one, because a user
 * pastes whatever their address bar gave them — a `blob/` page, a directory, a
 * repo root, a gist — and each of those needs a different number of round
 * trips to reach actual bytes.
 *
 * The rule that shapes this file: **never install without showing what was
 * fetched**. Every failure comes back with the list of URLs tried, so "it
 * didn't work" is answerable.
 *
 * @module background/install
 */

import { resolveLocator, deriveUpdateURL, isSkinFilename, SKIN_FILENAMES } from "../../../engine/core/source.js";
import { skinFromText, skinFromBundle, sniffFormat } from "../../../engine/core/skin.js";
import { putSkin, readSkin, log } from "./store.js";

/** A skin bigger than this is a mistake or an attack; either way it does not belong in phone storage. */
const MAX_BYTES = 2 * 1024 * 1024;

/** Total network budget for one import, across every candidate and every file a bundle pulls in. */
const MAX_FETCHES = 24;

/**
 * @param {string} text
 * @param {{name?: string, match?: string, source?: import("../../../engine/core/types.js").Source}} [options]
 * @returns {Promise<import("../shared/protocol.js").ImportReply>}
 */
export async function importFromText(text, options = {}) {
    const source = options.source ?? { kind: "paste", fetchedAt: Date.now() };
    const result = skinFromText(text, source, options);
    if (!result.skin) {
        return { ok: false, errors: result.errors, warnings: result.warnings };
    }
    return finishInstall(result, source, text);
}

/**
 * @param {string} locator  A URL or `owner/repo` shorthand.
 * @returns {Promise<import("../shared/protocol.js").ImportReply>}
 */
export async function importFromLocator(locator) {
    const resolved = resolveLocator(locator);
    if (!resolved.candidates.length) {
        return {
            ok: false,
            errors: [{ message: `Oriel does not know how to fetch "${locator}".` }],
            warnings: [],
            tried: []
        };
    }

    const budget = { left: MAX_FETCHES };
    const tried = [];
    const queue = [...resolved.candidates];
    const problems = [];

    while (queue.length && budget.left > 0) {
        const candidate = queue.shift();
        tried.push(candidate.url);
        let response;
        try {
            response = await fetchText(candidate.url, budget);
        } catch (error) {
            problems.push({ message: `${short(candidate.url)}: ${error.message}` });
            continue;
        }

        if (candidate.expects === "listing") {
            const found = listingToCandidates(response.text, candidate);
            if (!found.length) problems.push({ message: `${short(candidate.url)}: no skin file in that directory.` });
            // Directory results go to the front: they are more specific than
            // whatever guesses were queued behind them.
            queue.unshift(...found);
            continue;
        }

        const format = sniffFormat(response.text);
        if (format === "unknown") {
            problems.push({ message: `${short(candidate.url)}: fetched, but it is not a skin.` });
            continue;
        }

        const source = {
            kind: "url",
            url: locator,
            resolved: response.url,
            fetchedAt: Date.now(),
            digest: await digest(response.text)
        };

        const parsed =
            format === "bundle"
                ? await skinFromBundle(JSON.parse(response.text), source, relativeReader(response.url, budget))
                : skinFromText(response.text, source, { format });

        if (!parsed.skin) {
            return { ok: false, errors: parsed.errors, warnings: parsed.warnings, tried };
        }
        if (!parsed.skin.updateURL) {
            parsed.skin.updateURL = deriveUpdateURL(response.url) ?? undefined;
        }
        const reply = await finishInstall(parsed, source, response.text);
        return { ...reply, tried };
    }

    return {
        ok: false,
        errors: problems.length ? problems : [{ message: "Nothing at that link answered." }],
        warnings: budget.left <= 0 ? ["Stopped after too many requests."] : [],
        tried
    };
}

/** Re-parse edited source in place. Keeps the id, the values, and where it came from. */
export async function saveSource(id, text) {
    const existing = await readSkin(id);
    if (!existing) return { ok: false, errors: [{ message: "That skin is no longer installed." }], warnings: [] };

    const source = { ...existing.skin.source, kind: "paste", fetchedAt: Date.now() };
    const parsed = skinFromText(text, source);
    if (!parsed.skin) return { ok: false, errors: parsed.errors, warnings: parsed.warnings };

    // The user edited *this* skin; keeping the original id is what makes the
    // edit an edit rather than an install of a near-duplicate.
    parsed.skin.id = id;
    parsed.skin.updateURL = parsed.skin.updateURL ?? existing.skin.updateURL;
    return finishInstall(parsed, source, text, { enabled: existing.enabled, values: existing.values });
}

async function finishInstall(parsed, source, text, state) {
    if (text.length > MAX_BYTES) {
        return {
            ok: false,
            errors: [{ message: `That skin is ${Math.round(text.length / 1024)} KB. The limit is ${MAX_BYTES / 1024} KB.` }],
            warnings: parsed.warnings
        };
    }
    parsed.skin.source = source;
    const installed = await putSkin(parsed.skin, state);
    log({ skinId: parsed.skin.id, level: "info", message: `Installed ${parsed.skin.name} ${parsed.skin.version}` });
    const { summarize } = await import("../../../engine/core/skin.js");
    return { ok: true, summary: summarize(installed), errors: [], warnings: parsed.warnings };
}

// --- fetching --------------------------------------------------------------

async function fetchText(url, budget) {
    if (budget.left-- <= 0) throw new Error("too many requests");
    const response = await fetch(url, {
        redirect: "follow",
        // No credentials, ever. A skin URL is a third-party URL and sending the
        // user's GitHub cookies to it would make a private repo's contents
        // reachable by anyone who can get a link into the import box.
        credentials: "omit",
        headers: { Accept: "text/plain, application/json, text/css, */*" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) throw new Error("file is too large");

    const text = await response.text();
    if (text.length > MAX_BYTES) throw new Error("file is too large");
    return { text, url: response.url || url };
}

/**
 * A bundle's `css`/`js`/`dom` paths resolve against the manifest's own URL, so
 * a repo can be laid out however its author likes.
 */
function relativeReader(manifestUrl, budget) {
    return async (path) => {
        const target = new URL(path, manifestUrl);
        if (target.origin !== new URL(manifestUrl).origin) {
            throw new Error("a skin may not pull files from another origin");
        }
        const { text } = await fetchText(target.href, budget);
        return text;
    };
}

/**
 * GitHub's contents API answers with an array of entries; the gists API with an
 * object of files. Both carry a ready-made raw URL, which is why the API round
 * trip is worth its place in the 60-per-hour unauthenticated budget.
 */
function listingToCandidates(body, candidate) {
    let parsed;
    try {
        parsed = JSON.parse(body);
    } catch {
        return [];
    }

    const files = [];
    if (Array.isArray(parsed)) {
        for (const entry of parsed) {
            if (entry?.type === "file" && entry.download_url && isSkinFilename(entry.name)) {
                files.push({ name: entry.name, url: entry.download_url });
            }
        }
    } else if (parsed?.files && typeof parsed.files === "object") {
        for (const file of Object.values(parsed.files)) {
            if (file?.raw_url && isSkinFilename(file.filename ?? "")) {
                files.push({ name: file.filename, url: file.raw_url });
            }
        }
    }

    // A manifest beats a stylesheet: it can name the stylesheet, but not the
    // other way round.
    const rank = (name) => {
        const i = SKIN_FILENAMES.indexOf(name);
        return i === -1 ? SKIN_FILENAMES.length + (name.endsWith(".user.css") ? 0 : 1) : i;
    };
    files.sort((a, b) => rank(a.name) - rank(b.name));

    return files.map((file) => ({
        url: file.url,
        via: "raw",
        expects: "skin",
        note: `${candidate.note ? `${candidate.note}, ` : ""}found ${file.name}`
    }));
}

async function digest(text) {
    if (!globalThis.crypto?.subtle) return undefined;
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return `sha256-${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function short(url) {
    try {
        const parsed = new URL(url);
        const path = parsed.pathname.length > 40 ? `…${parsed.pathname.slice(-38)}` : parsed.pathname;
        return `${parsed.host}${path}`;
    } catch {
        return url;
    }
}
