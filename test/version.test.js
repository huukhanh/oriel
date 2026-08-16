/**
 * Loose semver (docs/SKIN-FORMAT.md §7). The traps worth naming: lexical
 * comparison would put "1.10.0" before "1.9.0"; pre-release identifiers order
 * before the release they precede; and a version string that doesn't parse
 * must still be offered as an update, in both directions, because refusing to
 * ever compare it is worse than occasionally re-offering an unchanged build.
 */

import { describe, it, expect } from "vitest";
import { compareVersions, isNewer, parseVersion } from "../engine/core/version.js";

describe("parseVersion", () => {
    it("treats missing segments as 0", () => {
        expect(parseVersion("1.2")).toEqual({ parts: [1, 2], pre: null, raw: "1.2", valid: true });
    });

    it("ignores a leading v", () => {
        expect(parseVersion("v1.2.0")).toMatchObject({ parts: [1, 2, 0], valid: true });
    });

    it("ignores a leading =", () => {
        expect(parseVersion("=1.2.0")).toMatchObject({ parts: [1, 2, 0], valid: true });
    });

    it("drops build metadata entirely", () => {
        expect(parseVersion("1.2.0+sha.abc123")).toMatchObject({ parts: [1, 2, 0], pre: null, valid: true });
    });

    it("splits a pre-release suffix into dotted identifiers", () => {
        expect(parseVersion("1.0.0-alpha.1")).toEqual({
            parts: [1, 0, 0],
            pre: ["alpha", "1"],
            raw: "1.0.0-alpha.1",
            valid: true
        });
    });

    it("a '-' inside build metadata is not mistaken for the pre-release delimiter", () => {
        expect(parseVersion("1.0.0+build-7")).toEqual({ parts: [1, 0, 0], pre: null, raw: "1.0.0+build-7", valid: true });
    });

    it("is invalid for non-numeric core segments", () => {
        expect(parseVersion("nightly").valid).toBe(false);
        expect(parseVersion("1.x.0").valid).toBe(false);
    });

    it("is invalid for an empty pre-release identifier", () => {
        expect(parseVersion("1.0.0-").valid).toBe(false);
        expect(parseVersion("1.0.0-alpha..1").valid).toBe(false);
    });

    it("is invalid for non-string input, but still reports the raw value", () => {
        expect(parseVersion(undefined)).toEqual({ parts: [], pre: null, raw: "undefined", valid: false });
    });
});

describe("compareVersions", () => {
    it("1.2 == 1.2.0 == v1.2.0+sha", () => {
        expect(compareVersions("1.2", "1.2.0")).toBe(0);
        expect(compareVersions("1.2.0", "v1.2.0+sha")).toBe(0);
        expect(compareVersions("1.2", "v1.2.0+sha")).toBe(0);
    });

    it("1.10.0 > 1.9.0 — not a lexical comparison", () => {
        expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
        expect(compareVersions("1.9.0", "1.10.0")).toBe(-1);
    });

    it("orders a pre-release chain: alpha < alpha.1 < beta < release", () => {
        const chain = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-beta", "1.0.0"];
        for (let i = 0; i < chain.length - 1; i++) {
            expect(compareVersions(chain[i], chain[i + 1])).toBe(-1);
            expect(compareVersions(chain[i + 1], chain[i])).toBe(1);
        }
    });

    it("compares numeric pre-release identifiers numerically, not lexically", () => {
        expect(compareVersions("1.0.0-alpha.2", "1.0.0-alpha.10")).toBe(-1);
    });

    it("compares non-numeric pre-release identifiers by ASCII", () => {
        expect(compareVersions("1.0.0-beta", "1.0.0-rc")).toBe(-1);
    });

    it("a numeric identifier always precedes a non-numeric one at the same position", () => {
        expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBe(-1);
    });

    it("build metadata never affects ordering", () => {
        expect(compareVersions("1.2.0+1", "1.2.0+2")).toBe(0);
    });

    it("falls back to a stable text order when both sides are unparseable", () => {
        expect(compareVersions("nightly", "nightly")).toBe(0);
        expect(compareVersions("alpha-build", "beta-build")).toBe(-1);
        expect(compareVersions("beta-build", "alpha-build")).toBe(1);
    });
});

describe("isNewer", () => {
    it("true when strictly greater, false when equal or lesser", () => {
        expect(isNewer("1.2.0", "1.1.0")).toBe(true);
        expect(isNewer("1.1.0", "1.1.0")).toBe(false);
        expect(isNewer("1.0.0", "1.1.0")).toBe(false);
    });

    it("an unparseable version is offered as an update either way", () => {
        expect(isNewer("nightly", "1.0.0")).toBe(true);
        expect(isNewer("1.0.0", "nightly")).toBe(true);
    });

    it("two unparseable versions are still 'newer' than each other", () => {
        expect(isNewer("nightly", "canary")).toBe(true);
        expect(isNewer("canary", "nightly")).toBe(true);
    });
});
