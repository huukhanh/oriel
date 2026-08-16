/**
 * Loose semver, per docs/SKIN-FORMAT.md §7: dot-separated numeric segments,
 * a leading `v`, an optional pre-release suffix that sorts before the
 * release it precedes, and build metadata that is ignored entirely.
 *
 * Not full semver — no leading-zero rejection, no cap on segment count —
 * because a skin author's `@version` field is free text an update poller
 * has to make sense of, not a spec they agreed to.
 *
 * @module core/version
 */

/**
 * @typedef {object} ParsedVersion
 * @property {number[]} parts        Numeric segments, left to right.
 * @property {string[]|null} pre     Pre-release identifiers, or null if none.
 * @property {string} raw            The input, unmodified.
 * @property {boolean} valid         False if `parts`/`pre` couldn't be extracted.
 */

/**
 * @param {string} v
 * @returns {ParsedVersion}
 */
export function parseVersion(v) {
    const raw = typeof v === "string" ? v : String(v);
    if (typeof v !== "string") return { parts: [], pre: null, raw, valid: false };

    // A leading "v" (npm/GitHub tag style) or "=" (Tampermonkey's "pin exactly
    // this version" prefix) carries no comparable information.
    let s = v.trim().replace(/^[vV=]/, "");

    // Build metadata is always last and is opaque — drop it before anything
    // else so a stray "-" inside it (e.g. "+build-7") can't be mistaken for
    // the pre-release delimiter. Neither Stylus nor Tampermonkey implements
    // real semver; Tampermonkey specifically treats "+build" as significant
    // ("1.12+1" < "1.12+2"), but we ignore it entirely, matching semver
    // proper and Violentmonkey — two build tags of the same version are the
    // same version as far as "is there an update" is concerned.
    const plus = s.indexOf("+");
    if (plus !== -1) s = s.slice(0, plus);

    let core = s;
    let pre = null;
    const dash = s.indexOf("-");
    if (dash !== -1) {
        core = s.slice(0, dash);
        pre = s.slice(dash + 1).split(".");
        if (pre.some((id) => id === "")) return { parts: [], pre: null, raw, valid: false };
    }

    if (!/^\d+(\.\d+)*$/.test(core)) return { parts: [], pre: null, raw, valid: false };

    return { parts: core.split(".").map(Number), pre, raw, valid: true };
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1}
 */
export function compareVersions(a, b) {
    const pa = parseVersion(a);
    const pb = parseVersion(b);

    if (!pa.valid || !pb.valid) {
        // Nothing numeric to compare. Fall back to raw text so the function
        // still returns a stable total order — isNewer() has its own,
        // deliberately asymmetric-looking rule for this case; this fallback
        // just needs to not contradict itself.
        if (pa.raw === pb.raw) return 0;
        return pa.raw < pb.raw ? -1 : 1;
    }

    const len = Math.max(pa.parts.length, pb.parts.length);
    for (let i = 0; i < len; i++) {
        const na = pa.parts[i] ?? 0;
        const nb = pb.parts[i] ?? 0;
        if (na !== nb) return na < nb ? -1 : 1;
    }

    if (pa.pre === null && pb.pre === null) return 0;
    if (pa.pre === null) return 1; // a has no pre-release suffix: a is the release, b precedes it
    if (pb.pre === null) return -1;

    const preLen = Math.max(pa.pre.length, pb.pre.length);
    for (let i = 0; i < preLen; i++) {
        const ia = pa.pre[i];
        const ib = pb.pre[i];
        if (ia === undefined) return -1; // fewer identifiers, all preceding ones equal: lower precedence
        if (ib === undefined) return 1;
        if (ia === ib) continue;
        const bothNumeric = /^\d+$/.test(ia) && /^\d+$/.test(ib);
        if (bothNumeric) {
            const na = Number(ia);
            const nb = Number(ib);
            return na < nb ? -1 : 1;
        }
        return ia < ib ? -1 : 1;
    }
    return 0;
}

/**
 * @param {string} candidate
 * @param {string} current
 * @returns {boolean}
 */
export function isNewer(candidate, current) {
    const c = parseVersion(candidate);
    const u = parseVersion(current);
    // A skin whose version string doesn't parse (a git-hash tag, "nightly",
    // whatever) still needs to be offered as an update. Refusing to compare
    // is refusing to ever update it again, which is worse than occasionally
    // re-offering a build that turns out unchanged — the user decides, on
    // the diff, whether to accept it. True in both directions: it doesn't
    // matter which side is the one we can't parse.
    if (!c.valid || !u.valid) return true;
    return compareVersions(candidate, current) > 0;
}
