// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { webkit } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startServer, pageWithPrelude, repoRoot, LAUNCH_TIMEOUT } from "./harness.js";

/**
 * The built-in media scripts, wrapped by the real Swift generator, running in
 * a real WebKit engine.
 *
 * These fixtures are `WrapperBuilder`'s actual output — a Core test asserts
 * they are current — so what runs here is what would be injected on device,
 * not a hand-written approximation of it.
 */
const wrapped = (name) =>
    readFileSync(join(repoRoot, "fixtures", "builtins", `${name}.wrapped.js`), "utf8");

const VISIBILITY_SPOOF = wrapped("visibility-spoof");
const PLAYSINLINE = wrapped("playsinline");

let browser;
let server;

beforeAll(async () => {
    browser = await webkit.launch({ timeout: LAUNCH_TIMEOUT });
    server = await startServer({
        "/": {
            body: `<!doctype html><html><head>
                <script>
                    // A page that pauses itself when it thinks you looked away.
                    // This is what YouTube does, and it is the failure the
                    // visibility spoof exists to prevent.
                    window.__pauseCount = 0;
                    window.__visEvents = 0;
                    window.__hiddenAtLoad = document.hidden;
                    document.addEventListener("visibilitychange", function () {
                        window.__visEvents++;
                        if (document.hidden) { window.__pauseCount++; }
                    });
                    document.onvisibilitychange = function () {
                        window.__onPropertyFired = (window.__onPropertyFired || 0) + 1;
                    };
                </script>
                </head><body><video id="v"></video></body></html>`
        }
    });
}, LAUNCH_TIMEOUT + 10_000);

afterAll(async () => {
    await server?.close();
    await browser?.close();
});

describe("visibility-spoof", () => {
    it("reports the page as visible even when the engine says otherwise", async () => {
        const { context, page } = await pageWithPrelude(browser, [VISIBILITY_SPOOF]);
        await page.goto(server.url("/"));

        expect(await page.evaluate(() => document.hidden)).toBe(false);
        expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
        expect(await page.evaluate(() => document.webkitHidden)).toBe(false);

        await context.close();
    });

    it("was already in effect before the page's own script read document.hidden", async () => {
        const { context, page } = await pageWithPrelude(browser, [VISIBILITY_SPOOF]);
        await page.goto(server.url("/"));
        // Not merely "false" — it must have been false at the moment the page
        // looked, which is the whole reason for document-start.
        expect(await page.evaluate(() => window.__hiddenAtLoad)).toBe(false);
        await context.close();
    });

    it("swallows visibilitychange so a self-pausing page never hears it", async () => {
        const { context, page } = await pageWithPrelude(browser, [VISIBILITY_SPOOF]);
        await page.goto(server.url("/"));

        await page.evaluate(() => {
            document.dispatchEvent(new Event("visibilitychange"));
            document.dispatchEvent(new Event("webkitvisibilitychange"));
        });

        expect(await page.evaluate(() => window.__visEvents)).toBe(0);
        expect(await page.evaluate(() => window.__pauseCount)).toBe(0);
        expect(
            await page.evaluate(() => window.__onPropertyFired),
            "document.onvisibilitychange is a separate path from addEventListener " +
                "and needs blocking too"
        ).toBeUndefined();

        await context.close();
    });

    it("without it, the same page does pause — proving the test can fail", async () => {
        // A guard test. If the page stopped reacting to visibilitychange for
        // some unrelated reason, every assertion above would pass vacuously.
        const { context, page } = await pageWithPrelude(browser);
        await page.goto(server.url("/"));

        await page.evaluate(() => {
            Object.defineProperty(document, "hidden", {
                configurable: true,
                get: () => true
            });
            document.dispatchEvent(new Event("visibilitychange"));
        });

        expect(await page.evaluate(() => window.__pauseCount)).toBe(1);
        await context.close();
    });

    it("restores the page exactly when switched off", async () => {
        const { context, page } = await pageWithPrelude(browser, [VISIBILITY_SPOOF]);
        await page.goto(server.url("/"));
        expect(await page.evaluate(() => document.hidden)).toBe(false);

        // Toggling a built-in off is the app's whole answer to a site changing
        // under it, so "off" has to mean off.
        const after = await page.evaluate(() => {
            const entry = window.__inj._entries["visibility-spoof"];
            entry.patterns = [];
            window.dispatchEvent(new Event("__inj:navigate"));

            window.__visEvents = 0;
            document.dispatchEvent(new Event("visibilitychange"));
            return {
                hidden: document.hidden,
                // Event *delivery*, not pausing: the page only pauses when it
                // believes it is hidden, and in a live tab it is not.
                delivered: window.__visEvents,
                ownProperty: Object.prototype.hasOwnProperty.call(document, "hidden")
            };
        });

        expect(after.delivered, "the event must reach the page again").toBe(1);
        expect(
            after.ownProperty,
            "the override should be gone, not merely returning the right value"
        ).toBe(false);
        expect(after.hidden, "and the native getter is back in charge").toBe(false);

        await context.close();
    });
});

describe("playsinline", () => {
    it("marks videos present at load", async () => {
        const { context, page } = await pageWithPrelude(browser, [PLAYSINLINE]);
        await page.goto(server.url("/"));
        expect(
            await page.evaluate(() => document.getElementById("v").hasAttribute("playsinline"))
        ).toBe(true);
        expect(
            await page.evaluate(() =>
                document.getElementById("v").hasAttribute("webkit-playsinline")
            )
        ).toBe(true);
        await context.close();
    });

    it("marks videos added later, which is how real players load", async () => {
        const { context, page } = await pageWithPrelude(browser, [PLAYSINLINE]);
        await page.goto(server.url("/"));

        const marked = await page.evaluate(async () => {
            const host = document.createElement("div");
            const video = document.createElement("video");
            host.appendChild(video);
            document.body.appendChild(host);
            // MutationObserver callbacks are microtask-timed.
            await new Promise((resolve) => setTimeout(resolve, 50));
            return video.hasAttribute("playsinline");
        });

        expect(marked, "a one-shot pass at document-start would miss nearly every player").toBe(
            true
        );
        await context.close();
    });

    it("disconnects its observer when switched off", async () => {
        const { context, page } = await pageWithPrelude(browser, [PLAYSINLINE]);
        await page.goto(server.url("/"));

        const markedAfterOff = await page.evaluate(async () => {
            const entry = window.__inj._entries["playsinline"];
            entry.patterns = [];
            window.dispatchEvent(new Event("__inj:navigate"));

            const video = document.createElement("video");
            document.body.appendChild(video);
            await new Promise((resolve) => setTimeout(resolve, 50));
            return video.hasAttribute("playsinline");
        });

        expect(
            markedAfterOff,
            "an observer that outlives its script walks every DOM mutation forever"
        ).toBe(false);
        await context.close();
    });
});

describe("built-ins together", () => {
    it("both run side by side without interfering", async () => {
        const { context, page } = await pageWithPrelude(browser, [
            VISIBILITY_SPOOF,
            PLAYSINLINE
        ]);
        await page.goto(server.url("/"));

        expect(await page.evaluate(() => Object.keys(window.__inj._entries).sort())).toEqual([
            "playsinline",
            "visibility-spoof"
        ]);
        expect(await page.evaluate(() => document.hidden)).toBe(false);
        expect(
            await page.evaluate(() => document.getElementById("v").hasAttribute("playsinline"))
        ).toBe(true);

        await context.close();
    });
});

describe("speed-hud", () => {
    const SPEED = wrapped("speed-hud");

    /// No GM storage stub: the real bridge is absent here, so this exercises
    /// exactly what happens when persistence is unavailable. The control must
    /// still appear — gating it behind the storage promise was a real flaw,
    /// and this is what would catch a regression.
    async function withVideo() {
        const { context, page } = await pageWithPrelude(browser, [SPEED]);
        await page.goto(server.url("/"));
        await page.waitForFunction(() => document.querySelector("[data-oriel-speed]") !== null, {
            timeout: 5000
        });
        return { context, page };
    }

    it("shows a control only when the page has a video", async () => {
        const { context, page } = await withVideo();
        expect(await page.evaluate(() => {
            const el = document.querySelector("[data-oriel-speed]");
            return el && el.style.display !== "none";
        })).toBe(true);
        await context.close();
    });

    it("changes the video's playbackRate", async () => {
        const { context, page } = await withVideo();
        const rate = await page.evaluate(async () => {
            const buttons = document.querySelectorAll("[data-oriel-speed] button");
            buttons[buttons.length - 1].click();  // "+"
            await new Promise((r) => setTimeout(r, 50));
            return document.getElementById("v").playbackRate;
        });
        expect(rate).toBeGreaterThan(1);
        await context.close();
    });

    it("re-applies the rate to a video added later", async () => {
        // An SPA swapping the player would otherwise silently reset to 1x.
        const { context, page } = await withVideo();
        const rate = await page.evaluate(async () => {
            const buttons = document.querySelectorAll("[data-oriel-speed] button");
            buttons[buttons.length - 1].click();
            await new Promise((r) => setTimeout(r, 50));
            const fresh = document.createElement("video");
            document.body.appendChild(fresh);
            await new Promise((r) => setTimeout(r, 150));
            return fresh.playbackRate;
        });
        expect(rate).toBeGreaterThan(1);
        await context.close();
    });

    it("overrides a player that resets the rate itself", async () => {
        const { context, page } = await withVideo();
        const rate = await page.evaluate(async () => {
            const buttons = document.querySelectorAll("[data-oriel-speed] button");
            buttons[buttons.length - 1].click();
            await new Promise((r) => setTimeout(r, 50));
            const video = document.getElementById("v");
            video.playbackRate = 1;                       // the site fighting back
            video.dispatchEvent(new Event("ratechange"));
            await new Promise((r) => setTimeout(r, 50));
            return video.playbackRate;
        });
        expect(rate).toBeGreaterThan(1);
        await context.close();
    });

    it("removes the control and restores 1x when switched off", async () => {
        const { context, page } = await withVideo();
        const after = await page.evaluate(async () => {
            const buttons = document.querySelectorAll("[data-oriel-speed] button");
            buttons[buttons.length - 1].click();
            await new Promise((r) => setTimeout(r, 50));

            const entry = window.__inj._entries["speed-hud"];
            entry.patterns = [];
            window.dispatchEvent(new Event("__inj:navigate"));
            await new Promise((r) => setTimeout(r, 50));
            return {
                hud: document.querySelector("[data-oriel-speed]") !== null,
                rate: document.getElementById("v").playbackRate
            };
        });
        expect(after.hud, "the control outlived the script").toBe(false);
        expect(after.rate, "the page was left sped up after switching off").toBe(1);
        await context.close();
    });
});
