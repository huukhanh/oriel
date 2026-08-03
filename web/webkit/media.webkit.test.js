// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { webkit } from "playwright";
import { startServer, pageWithPrelude, LAUNCH_TIMEOUT } from "./harness.js";

/**
 * The media bridge the toolbar's PiP button drives.
 *
 * What this can settle: which element gets picked, what the state report says,
 * and that `enterPiP` degrades honestly rather than throwing when the platform
 * API is absent.
 *
 * What it cannot: whether PiP actually opens a window on iOS.
 * `webkitSetPresentationMode` does not exist in the Linux port at all, so the
 * real path is exercised here through a stub. That remains a device question.
 */
let browser;
let server;

const PAGE = `<!doctype html><html><head><title>Test page</title></head><body>
    <video id="tiny" width="16" height="16"></video>
    <video id="main" width="640" height="360"></video>
    <audio id="sound"></audio>
</body></html>`;

beforeAll(async () => {
    browser = await webkit.launch({ timeout: LAUNCH_TIMEOUT });
    server = await startServer({ "/": { body: PAGE }, "/empty": { body: "<!doctype html><p>x" } });
}, LAUNCH_TIMEOUT + 10_000);

afterAll(async () => {
    await server?.close();
    await browser?.close();
});

describe("media element selection", () => {
    it("prefers the largest element when nothing is playing", async () => {
        const { context, page } = await pageWithPrelude(browser);
        await page.goto(server.url("/"));
        expect(
            await page.evaluate(() => window.__inj.media.pick().id),
            "ad slots and hidden preview players are tiny — picking one means the " +
                "PiP button acts on the wrong video"
        ).toBe("main");
        await context.close();
    });

    it("prefers a playing element over a larger paused one", async () => {
        const { context, page } = await pageWithPrelude(browser);
        await page.goto(server.url("/"));
        const picked = await page.evaluate(() => {
            const tiny = document.getElementById("tiny");
            Object.defineProperty(tiny, "paused", { value: false, configurable: true });
            return window.__inj.media.pick().id;
        });
        expect(picked).toBe("tiny");
        await context.close();
    });

    it("reports no media on a page that has none", async () => {
        const { context, page } = await pageWithPrelude(browser);
        await page.goto(server.url("/empty"));
        expect(await page.evaluate(() => window.__inj.media.state())).toEqual({
            hasMedia: false,
            playing: false
        });
        await context.close();
    });

    it("reports state for Now Playing", async () => {
        const { context, page } = await pageWithPrelude(browser);
        await page.goto(server.url("/"));
        const state = await page.evaluate(() => window.__inj.media.state());
        expect(state.hasMedia).toBe(true);
        expect(state.playing).toBe(false);
        expect(state.title).toBe("Test page");
        expect(state.isVideo).toBe(true);
        // A fresh element has duration NaN; propagating that to Swift would
        // produce a NaN in the lock-screen scrubber.
        expect(Number.isFinite(state.duration)).toBe(true);
        expect(Number.isFinite(state.currentTime)).toBe(true);
        await context.close();
    });
});

describe("enterPiP", () => {
    it("says so rather than throwing when there is no media", async () => {
        const { context, page } = await pageWithPrelude(browser);
        await page.goto(server.url("/empty"));
        expect(await page.evaluate(() => window.__inj.media.enterPiP())).toBe("no-media");
        await context.close();
    });

    it("reports 'unsupported' where the platform API is absent", async () => {
        const { context, page } = await pageWithPrelude(browser);
        await page.goto(server.url("/"));
        // Linux WebKit has neither API. An honest string beats a silent no-op:
        // the app surfaces it in the log instead of leaving the user tapping a
        // button that appears to do nothing.
        expect(await page.evaluate(() => window.__inj.media.enterPiP())).toBe("unsupported");
        await context.close();
    });

    it("calls webkitSetPresentationMode on the picked element when present", async () => {
        const { context, page } = await pageWithPrelude(browser);
        await page.goto(server.url("/"));
        const result = await page.evaluate(() => {
            const main = document.getElementById("main");
            window.__calledWith = null;
            main.webkitSetPresentationMode = function (mode) {
                window.__calledWith = mode;
            };
            const outcome = window.__inj.media.enterPiP();
            return { outcome, mode: window.__calledWith };
        });
        expect(result).toEqual({ outcome: "requested", mode: "picture-in-picture" });
        await context.close();
    });

    it("reports a failure instead of letting it escape", async () => {
        const { context, page } = await pageWithPrelude(browser);
        await page.goto(server.url("/"));
        const outcome = await page.evaluate(() => {
            const main = document.getElementById("main");
            main.webkitSetPresentationMode = function () {
                throw new Error("nope");
            };
            return window.__inj.media.enterPiP();
        });
        expect(outcome).toMatch(/^failed:/);
        await context.close();
    });
});

describe("playback events", () => {
    it("media events are observable from a document-level capture listener", async () => {
        // Media events do not bubble — a listener on window without capture
        // never sees them, which is how a Now Playing panel ends up frozen.
        const { context, page } = await pageWithPrelude(browser);
        await page.goto(server.url("/"));
        const seen = await page.evaluate(async () => {
            let count = 0;
            document.addEventListener("play", () => count++, true);
            document.getElementById("main").dispatchEvent(new Event("play"));
            return count;
        });
        expect(seen).toBe(1);
        await context.close();
    });
});
