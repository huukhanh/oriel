import { describe, it, expect, beforeAll } from "vitest";
import { makeWindow, fixture } from "./helpers.js";

/**
 * The cross-language check.
 *
 * Swift decides which scripts to inject; this guard re-checks on SPA route
 * changes. If the two ever disagree, a script runs on a page it was never
 * scoped to — and no test that exercises only one language can see it.
 *
 * Both sides are driven from fixtures/match-cases.json. Swift asserts its
 * parser produces the `descriptors` entries; this suite feeds those same
 * descriptors through the JS matcher and asserts the same verdicts.
 */
// Only the pure matcher is needed here, not a live document.
let inj;
beforeAll(async () => {
    inj = (await makeWindow("https://example.org/")).__inj;
});

describe("match guard agrees with Swift", () => {
    it("has a descriptor for every pattern used in the table", () => {
        for (const testCase of fixture.cases) {
            expect(
                fixture.descriptors[testCase.pattern],
                `no descriptor for \`${testCase.pattern}\` — Swift and JS would be ` +
                    `testing different things`
            ).toBeTruthy();
        }
    });

    for (const testCase of fixture.cases) {
        const verb = testCase.match ? "matches" : "rejects";
        it(`${verb} ${testCase.pattern} vs ${testCase.url}`, () => {
            const descriptor = fixture.descriptors[testCase.pattern];
            expect(inj.matches(descriptor, testCase.url), testCase.why).toBe(testCase.match);
        });
    }

    it("matchesAny is true when any pattern matches", () => {
        const youtube = fixture.descriptors["*://*.youtube.com/watch*"];
        const example = fixture.descriptors["*://*.example.com/*"];
        expect(inj.matchesAny([youtube, example], "https://a.example.com/x")).toBe(true);
        expect(inj.matchesAny([youtube], "https://a.example.com/x")).toBe(false);
        expect(inj.matchesAny([], "https://a.example.com/x")).toBe(false);
    });
});

describe("glob", () => {
    it("handles the basics identically to Swift", () => {
        expect(inj.glob("*", "")).toBe(true);
        expect(inj.glob("*", "anything/at/all")).toBe(true);
        expect(inj.glob("/a*b", "/ab")).toBe(true);
        expect(inj.glob("/a*b", "/axxxb")).toBe(true);
        expect(inj.glob("/a*b", "/axxx")).toBe(false);
        expect(inj.glob("/a**b", "/ab")).toBe(true);
        expect(inj.glob("", "/")).toBe(false);
        expect(inj.glob("", "")).toBe(true);
    });

    // A naive recursive glob goes exponential here — in the content world, on
    // the main thread of whatever page the user is reading.
    it("does not blow up on adversarial input", () => {
        const pattern = "a*".repeat(24) + "b";
        const text = "a".repeat(400);
        expect(inj.glob(pattern, text)).toBe(false);
    });
});
