// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { webkit } from "playwright";
import { startServer, pageWithPrelude, LAUNCH_TIMEOUT } from "./harness.js";

/**
 * `@run-at`, which the metadata parser has always understood and the runtime
 * has always ignored.
 *
 * Reported in #32: a new script from the app's own template does nothing. The
 * template ships `@run-at document-start`, and at document-start
 * `document.body` is null — so the first thing anyone writes,
 * `document.body.style.background = "red"`, throws before it can do anything.
 */
let browser;
let server;

const ANY = [{ scheme: "any", hostKind: "any", host: "", path: "*" }];

beforeAll(async () => {
    browser = await webkit.launch({ timeout: LAUNCH_TIMEOUT });
    server = await startServer({
        "/": { body: "<!doctype html><html><head></head><body><h1>hi</h1></body></html>" }
    });
}, LAUNCH_TIMEOUT + 10_000);

afterAll(async () => {
    await server?.close();
    await browser?.close();
});

/** Registers a body that records whether document.body was reachable. */
function probe(runAt) {
    return `
        window.__inj.register("t", ${JSON.stringify(ANY)}, function (GM) {
            window.__sawBody = !!document.body;
            try {
                document.body.style.background = "red";
                window.__applied = true;
            } catch (e) {
                window.__threw = String(e);
            }
        }, ${JSON.stringify(runAt)});
    `;
}

describe("@run-at", () => {
    it("document-start runs before the body exists — the reported failure", async () => {
        const { context, page } = await pageWithPrelude(browser, [probe("document-start")]);
        await page.goto(server.url("/"));

        expect(
            await page.evaluate(() => window.__sawBody),
            "document.body should be null at document-start; that is the point of the timing"
        ).toBe(false);
        expect(await page.evaluate(() => window.__applied)).toBeUndefined();
        await context.close();
    });

    it("document-end waits for the DOM, so a DOM tweak works", async () => {
        const { context, page } = await pageWithPrelude(browser, [probe("document-end")]);
        await page.goto(server.url("/"));

        expect(await page.evaluate(() => window.__sawBody)).toBe(true);
        expect(
            await page.evaluate(() => window.__applied),
            "this is the script from #32 — it must work"
        ).toBe(true);
        expect(await page.evaluate(() => document.body.style.background)).toBe("red");
        await context.close();
    });

    it("document-idle also waits for the DOM", async () => {
        const { context, page } = await pageWithPrelude(browser, [probe("document-idle")]);
        await page.goto(server.url("/"));
        expect(await page.evaluate(() => window.__applied)).toBe(true);
        await context.close();
    });

    it("defaults to document-end when run-at is absent", async () => {
        // The safe default: a script that touches the DOM is the common case,
        // and one that must beat the page's own listeners is the expert case.
        const source = `
            window.__inj.register("t", ${JSON.stringify(ANY)}, function (GM) {
                window.__sawBody = !!document.body;
            });
        `;
        const { context, page } = await pageWithPrelude(browser, [source]);
        await page.goto(server.url("/"));
        expect(await page.evaluate(() => window.__sawBody)).toBe(true);
        await context.close();
    });

    it("document-start still beats the page's own scripts", async () => {
        // The media built-ins depend on this: overriding document.hidden after
        // the page installed its visibilitychange handler accomplishes nothing.
        const local = await startServer({
            "/": {
                body: `<!doctype html><html><head><script>
                    window.__pageSaw = !!window.__injRanFirst;
                </script></head><body></body></html>`
            }
        });
        const source = `
            window.__inj.register("t", ${JSON.stringify(ANY)}, function (GM) {
                window.__injRanFirst = true;
            }, "document-start");
        `;
        const { context, page } = await pageWithPrelude(browser, [source]);
        await page.goto(local.url("/"));
        expect(
            await page.evaluate(() => window.__pageSaw),
            "document-start must still run before the page's own inline script"
        ).toBe(true);
        await context.close();
        await local.close();
    });

    it("a late-registered document-end script still runs on an already-loaded page", async () => {
        // "Run on this page now" registers after load; it must not hang waiting
        // for a DOMContentLoaded that already fired.
        const { context, page } = await pageWithPrelude(browser);
        await page.goto(server.url("/"));
        const applied = await page.evaluate((patterns) => {
            window.__inj.register("late", patterns, function () {
                document.body.style.background = "lime";
            }, "document-end");
            return document.body.style.background;
        }, ANY);
        expect(applied).toBe("lime");
        await context.close();
    });
});
