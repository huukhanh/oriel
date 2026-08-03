import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { makeWindow, evaluateIn, navigate, repoRoot } from "./helpers.js";

/**
 * The seam.
 *
 * Swift generates the wrapper; this evaluates the byte-for-byte output of that
 * generator (`fixtures/wrapper-golden.js`, which a Core test asserts is current)
 * as a classic script, exactly as WebKit will.
 *
 * Either half can be perfect on its own while the pair is broken — a wrapper
 * that is valid Swift-side output but invalid JavaScript fails silently in the
 * content world, where nothing else in this project can see it. This is the
 * only test that would catch that.
 */
const golden = readFileSync(join(repoRoot, "fixtures", "wrapper-golden.js"), "utf8");

const WATCH_1 = "https://www.youtube.com/watch?v=1";

describe("generated wrapper", () => {
    it("parses and runs as a classic script", () => {
        const win = makeWindow(WATCH_1);
        expect(() => evaluateIn(win, golden)).not.toThrow();
    });

    it("registers under the id Swift emitted", () => {
        const win = makeWindow(WATCH_1);
        evaluateIn(win, golden);
        expect(Object.keys(win.__inj._entries)).toEqual(["hide-shorts"]);
    });

    it("runs its body on a matching URL, with the GM aliases bound", () => {
        const win = makeWindow(WATCH_1);
        evaluateIn(win, golden);
        // The golden script's body calls GM_addStyle. If the aliases were not
        // bound, the body throws and no style appears.
        expect(win.document.querySelectorAll("style").length).toBe(1);
        expect(win.document.querySelector("style").textContent).toContain(
            "ytd-reel-shelf-renderer"
        );
    });

    it("does not run on a host its pattern does not cover", () => {
        const win = makeWindow("https://example.com/");
        evaluateIn(win, golden);
        expect(win.document.querySelectorAll("style").length).toBe(0);
    });

    it("matches a subdomain, driven by the descriptor Swift emitted", () => {
        const win = makeWindow("https://m.youtube.com/watch?v=9");
        evaluateIn(win, golden);
        expect(win.document.querySelectorAll("style").length).toBe(1);
    });

    it("keeps its style across same-site route changes without duplicating it", () => {
        const win = makeWindow(WATCH_1);
        evaluateIn(win, golden);
        navigate(win, "/feed/subscriptions");
        navigate(win, "/watch?v=2");
        expect(
            win.document.querySelectorAll("style").length,
            "the pattern never stopped matching, so the script never re-ran"
        ).toBe(1);
    });

    it("is inert when the prelude is absent rather than throwing", () => {
        // A user script can outlive its runtime — a world without the prelude,
        // or an injection-ordering mistake. It must fail quietly, not with an
        // exception on every page load.
        const bare = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
            url: WATCH_1,
            runScripts: "dangerously"
        });
        expect(() => evaluateIn(bare.window, golden)).not.toThrow();
        expect(bare.window.document.querySelectorAll("style").length).toBe(0);
    });

    it("contains no eval or Function constructor", () => {
        // Asserted on the shipped artifact, not only on Swift's output: a user
        // script is exempt from the page's CSP, but eval inside it is not.
        expect(golden).not.toMatch(/\beval\s*\(/);
        expect(golden).not.toMatch(/new\s+Function\s*\(/);
    });
});
