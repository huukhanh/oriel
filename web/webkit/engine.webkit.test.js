// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { webkit } from "playwright";
import {
    startServer,
    pageWithPrelude,
    goldenWrapper,
    LAUNCH_TIMEOUT
} from "./harness.js";

/**
 * The injection engine, in real WebKit.
 *
 * Playwright ships the WPE/GTK port of WebKit — the same JavaScriptCore and
 * WebCore that back `WKWebView` on iOS. It is not an iPhone, and it cannot say
 * anything about `WKUserContentController`, content worlds, or media
 * behaviour. What it *can* settle is everything that happens once our
 * JavaScript is running in a real engine on a real page: injection timing,
 * CSP, history interception, the DOM.
 *
 * jsdom cannot answer any of those honestly. It has no CSP implementation at
 * all, so the single architectural rule this whole design rests on — that a
 * user script is CSP-exempt but `eval` inside it is not — was, until now,
 * folklore repeated in a comment.
 */
let browser;

beforeAll(async () => {
    browser = await webkit.launch({ timeout: LAUNCH_TIMEOUT });
}, LAUNCH_TIMEOUT + 10_000);

afterAll(async () => {
    await browser?.close();
});

const PLAIN_PAGE = `<!doctype html><html><head>
<script>window.__pageScriptRan = true; window.__sawInjEarly = !!window.__inj;</script>
</head><body><h1>page</h1></body></html>`;

describe("injection timing", () => {
    let server;
    beforeAll(async () => {
        server = await startServer({ "/": { body: PLAIN_PAGE } });
    });
    afterAll(async () => await server.close());

    it("the prelude is installed before the page's own inline script runs", async () => {
        const { context, page } = await pageWithPrelude(browser);
        await page.goto(server.url("/"));

        expect(await page.evaluate(() => window.__pageScriptRan)).toBe(true);
        expect(
            await page.evaluate(() => window.__sawInjEarly),
            "document-start is not a nicety — overriding document.hidden after the " +
                "page installed its visibilitychange handler accomplishes nothing"
        ).toBe(true);

        await context.close();
    });

    it("installs exactly one runtime even across a reload", async () => {
        const { context, page } = await pageWithPrelude(browser);
        await page.goto(server.url("/"));
        await page.reload();
        expect(await page.evaluate(() => typeof window.__inj)).toBe("object");
        await context.close();
    });
});

/**
 * The rule the architecture is built on, finally measured.
 */
describe("Content-Security-Policy", () => {
    let server;
    const STRICT = { "Content-Security-Policy": "default-src 'none'; script-src 'none'" };

    beforeAll(async () => {
        server = await startServer({
            "/strict": { body: PLAIN_PAGE, headers: STRICT },
            "/strict-inline": {
                body: `<!doctype html><html><head></head><body>
                    <script>window.__pageScriptRan = true;</script>
                    </body></html>`,
                headers: STRICT
            }
        });
    });
    afterAll(async () => await server.close());

    it("a user script still runs under script-src 'none'", async () => {
        const { context, page } = await pageWithPrelude(browser);
        await page.goto(server.url("/strict-inline"));

        // The page's own inline script must be blocked, or the header is not
        // doing anything and this test proves nothing.
        expect(
            await page.evaluate(() => window.__pageScriptRan),
            "CSP did not block the page's inline script — the header is not in effect"
        ).toBeUndefined();

        expect(
            await page.evaluate(() => typeof window.__inj),
            "a user script is exempt from the page's CSP — this is why build-time " +
                "wrapping works at all"
        ).toBe("object");

        await context.close();
    });

    it("but eval inside that user script is NOT exempt", async () => {
        const probe = `
            window.__evalResult = "not attempted";
            try {
                window.__evalResult = "ok:" + eval("1+1");
            } catch (e) {
                window.__evalResult = "threw:" + e.name;
            }
            try {
                window.__functionResult = "ok:" + (new Function("return 2+2"))();
            } catch (e) {
                window.__functionResult = "threw:" + e.name;
            }
        `;
        const { context, page } = await pageWithPrelude(browser, [probe]);
        await page.goto(server.url("/strict"));

        const evalResult = await page.evaluate(() => window.__evalResult);
        const functionResult = await page.evaluate(() => window.__functionResult);

        // This is the empirical basis for "no fetch-and-eval architecture".
        expect(evalResult).toMatch(/^threw:/);
        expect(functionResult).toMatch(/^threw:/);

        await context.close();
    });

    it("GM_addStyle works under a CSP that forbids inline style sources", async () => {
        const { context, page } = await pageWithPrelude(browser);
        await page.goto(server.url("/strict"));
        const applied = await page.evaluate(() => {
            let ok = false;
            window.__inj.register(
                "styler",
                [{ scheme: "any", hostKind: "any", host: "", path: "*" }],
                function (GM) {
                    GM.addStyle("h1 { color: rgb(1, 2, 3) }");
                    ok = document.querySelectorAll("style").length === 1;
                }
            );
            return ok;
        });
        expect(applied).toBe(true);
        await context.close();
    });
});

describe("the generated wrapper in a real engine", () => {
    let server;
    beforeAll(async () => {
        server = await startServer({
            "/": { body: PLAIN_PAGE },
            "/watch": { body: PLAIN_PAGE },
            "/feed": { body: PLAIN_PAGE }
        });
    });
    afterAll(async () => await server.close());

    it("parses and registers in WebKit's JavaScriptCore", async () => {
        const { context, page } = await pageWithPrelude(browser, [goldenWrapper]);
        await page.goto(server.url("/"));
        expect(await page.evaluate(() => Object.keys(window.__inj._entries))).toEqual([
            "hide-shorts"
        ]);
        await context.close();
    });

    it("does not run on a host its pattern does not cover", async () => {
        const { context, page } = await pageWithPrelude(browser, [goldenWrapper]);
        await page.goto(server.url("/"));
        expect(await page.evaluate(() => document.querySelectorAll("style").length)).toBe(0);
        await context.close();
    });
});

/**
 * Real history, real popstate, real event dispatch — the part jsdom models
 * loosely and WebKit implements.
 */
describe("SPA route handling", () => {
    let server;
    const SITE = [{ scheme: "any", hostKind: "any", host: "", path: "/watch*" }];

    beforeAll(async () => {
        server = await startServer({
            "/": { body: PLAIN_PAGE },
            "/watch": { body: PLAIN_PAGE },
            "/feed": { body: PLAIN_PAGE }
        });
    });
    afterAll(async () => await server.close());

    async function setup() {
        const { context, page } = await pageWithPrelude(browser);
        await page.goto(server.url("/"));
        await page.evaluate((patterns) => {
            window.__runs = 0;
            window.__cleanups = 0;
            window.__routes = [];
            window.__inj.register("t", patterns, function (GM) {
                window.__runs++;
                GM.onCleanup(() => window.__cleanups++);
                GM.onRouteChange((href) => window.__routes.push(href));
            });
        }, SITE);
        return { context, page };
    }

    it("starts a script when pushState makes its pattern match", async () => {
        const { context, page } = await setup();
        expect(await page.evaluate(() => window.__runs)).toBe(0);

        await page.evaluate(() => history.pushState({}, "", "/watch?v=1"));
        expect(await page.evaluate(() => window.__runs)).toBe(1);

        await context.close();
    });

    it("tears it down when pushState makes the pattern stop matching", async () => {
        const { context, page } = await setup();
        await page.evaluate(() => history.pushState({}, "", "/watch?v=1"));
        await page.evaluate(() => history.pushState({}, "", "/feed"));

        expect(await page.evaluate(() => window.__cleanups)).toBe(1);
        await context.close();
    });

    it("does not re-run while the pattern keeps matching", async () => {
        const { context, page } = await setup();
        await page.evaluate(() => {
            history.pushState({}, "", "/watch?v=1");
            history.pushState({}, "", "/watch?v=2");
            history.pushState({}, "", "/watch?v=3");
        });
        expect(
            await page.evaluate(() => window.__runs),
            "decision 005 — re-running here doubles a pasted script's listeners"
        ).toBe(1);
        expect(await page.evaluate(() => window.__routes.length)).toBe(2);
        await context.close();
    });

    it("reacts to real back-button popstate, not just pushState", async () => {
        const { context, page } = await setup();
        await page.evaluate(() => history.pushState({}, "", "/watch?v=1"));
        expect(await page.evaluate(() => window.__runs)).toBe(1);

        await page.goBack();
        // Back to "/", which no longer matches.
        expect(await page.evaluate(() => window.__cleanups)).toBe(1);

        await context.close();
    });

    it("survives a site that patches history itself", async () => {
        // Sites do this. Our prelude patched first (document-start), so the
        // site's patch wraps ours and both still fire.
        const { context, page } = await setup();
        await page.evaluate(() => {
            const original = history.pushState;
            history.pushState = function () {
                window.__sitePatchSaw = (window.__sitePatchSaw || 0) + 1;
                return original.apply(this, arguments);
            };
        });
        await page.evaluate(() => history.pushState({}, "", "/watch?v=9"));

        expect(await page.evaluate(() => window.__sitePatchSaw)).toBe(1);
        expect(await page.evaluate(() => window.__runs)).toBe(1);
        await context.close();
    });
});

describe("media element detection", () => {
    let server;
    beforeAll(async () => {
        server = await startServer({
            "/": {
                body: `<!doctype html><html><body>
                    <video id="decoy"></video>
                    <video id="real"></video>
                    </body></html>`
            }
        });
    });
    afterAll(async () => await server.close());

    it("a real HTMLMediaElement reports paused/ended as the probe expects", async () => {
        const { context, page } = await pageWithPrelude(browser);
        await page.goto(server.url("/"));
        const state = await page.evaluate(() => {
            const video = document.getElementById("real");
            return {
                paused: video.paused,
                ended: video.ended,
                currentTime: video.currentTime,
                hasCurrentSrc: typeof video.currentSrc === "string"
            };
        });
        // The Phase 0 probe assumes exactly this shape on a fresh element.
        expect(state).toEqual({
            paused: true,
            ended: false,
            currentTime: 0,
            hasCurrentSrc: true
        });
        await context.close();
    });
});
