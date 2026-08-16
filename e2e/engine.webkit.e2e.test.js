/**
 * The engine, in the engine Safari uses.
 *
 * Playwright's WebKit is the WPE/GTK port: the same JavaScriptCore and the same
 * WebCore as a `WKWebView` on an iPhone. It cannot load an extension, so these
 * tests bundle the modules and drive them from the page. That gives up the
 * extension plumbing — which Chromium covers — and buys the thing Chromium
 * cannot give: the layout engine, the HTML parser, and the URL parser that will
 * actually be judging a skin on the target device.
 *
 * jsdom already covers the logic. What is here is only what needs a real engine.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { launchWebKit, startServer, bundleForBrowser, HTML } from "./harness.js";

let browser;
let server;
let engine;

beforeAll(async () => {
    engine = await bundleForBrowser(`
        import * as domops from "./engine/core/domops.js";
        import { createStyleHost } from "./engine/runtime/styles.js";
        import { wrapForUserScriptWorld } from "./engine/core/wrapper.js";
        import { compileTargets } from "./engine/core/target.js";
        globalThis.__oriel = { domops, createStyleHost, wrapForUserScriptWorld, compileTargets };
    `);

    browser = await launchWebKit();
    server = await startServer({
        "/page": { body: HTML.article },
        "/strict": { body: HTML.article, headers: HTML.strictHeaders },
        "/spa": {
            body: `<!doctype html><html><body><div id="marker">spa</div>
<script>window.go = (p) => history.pushState({}, "", p);</script></body></html>`
        },
        "/slow": {
            // A body that arrives in pieces, so "did the style land before the
            // content did" is a question with a real answer.
            body:
                `<!doctype html><html><head></head><body>` +
                `<div id="first">first</div>` +
                "<!--" +
                "x".repeat(200_000) +
                "-->" +
                `<div id="last">last</div></body></html>`
        }
    });
}, 180_000);

afterAll(async () => {
    await browser?.close();
    await server?.close();
});

/** A page with the engine available at document_start, as a content script would be. */
async function open(path) {
    const context = await browser.newContext();
    await context.addInitScript({ content: engine });
    const page = await context.newPage();
    await page.goto(server.url(path));
    return { page, close: () => context.close() };
}

describe("stylesheets at document_start", () => {
    it("styles the first element before the rest of the document has parsed", async () => {
        // The fallback path — a <style> element Oriel owns — is what Safari is
        // most likely to use, and the whole question about it is whether it
        // wins the race against the page's own content.
        const context = await browser.newContext();
        await context.addInitScript({ content: engine });
        await context.addInitScript({
            content: `(() => {
                const host = __oriel.createStyleHost(async () => ({ ok: false }));
                host.add("probe", "#first { color: rgb(1, 2, 3); }");
                document.addEventListener("DOMContentLoaded", () => {
                    const el = document.querySelector("#first");
                    document.documentElement.dataset.firstColour = getComputedStyle(el).color;
                });
            })();`
        });
        const page = await context.newPage();
        await page.goto(server.url("/slow"));

        expect(await page.evaluate(() => document.documentElement.dataset.firstColour)).toBe("rgb(1, 2, 3)");
        await context.close();
    });

    it("still applies on a page whose CSP forbids the page's own styles", async () => {
        // The measurement this whole mechanism ordering exists for: under
        // `style-src 'self'` a <style> element inserted by script is blocked,
        // and a constructed stylesheet is not. A great many of the sites worth
        // reskinning send exactly that header.
        const { page, close } = await open("/strict");
        const result = await page.evaluate(async () => {
            const host = __oriel.createStyleHost(async () => ({ ok: false }));
            await host.add("probe", "#masthead { background-color: rgb(4, 5, 6); }");

            const blocked = document.createElement("style");
            blocked.textContent = "#ads { background-color: rgb(7, 8, 9); }";
            document.head.appendChild(blocked);

            return {
                mode: host.modeOf("probe"),
                skin: getComputedStyle(document.querySelector("#masthead")).backgroundColor,
                plainStyleElement: getComputedStyle(document.querySelector("#ads")).backgroundColor
            };
        });

        expect(result.mode).toBe("adopted");
        expect(result.skin).toBe("rgb(4, 5, 6)");
        // Proves the CSP is real and the page is genuinely hostile to the
        // obvious approach, rather than the header being ignored.
        expect(result.plainStyleElement).not.toBe("rgb(7, 8, 9)");
        await close();
    });

    it("takes an adopted stylesheet back off without disturbing the page's own", async () => {
        const { page, close } = await open("/page");
        const result = await page.evaluate(async () => {
            const theirs = new CSSStyleSheet();
            theirs.replaceSync("footer { color: rgb(9, 9, 9); }");
            document.adoptedStyleSheets = [theirs];

            const host = __oriel.createStyleHost(async () => ({ ok: false }));
            await host.add("probe", "#masthead { background-color: rgb(4, 5, 6); }");
            const during = document.adoptedStyleSheets.length;

            await host.remove("probe");
            return {
                during,
                after: document.adoptedStyleSheets.length,
                pageSheetSurvived: document.adoptedStyleSheets.includes(theirs),
                colour: getComputedStyle(document.querySelector("#masthead")).backgroundColor
            };
        });

        expect(result.during).toBe(2);
        expect(result.after).toBe(1);
        expect(result.pageSheetSurvived).toBe(true);
        expect(result.colour).not.toBe("rgb(4, 5, 6)");
        await close();
    });

    it("rewrites a variable block in place rather than churning the sheet list", async () => {
        // Moving a slider re-adds the same key many times a second. Replacing
        // the sheet each time would reorder the document's stylesheets under a
        // page that may be reading them.
        const { page, close } = await open("/page");
        const result = await page.evaluate(async () => {
            const host = __oriel.createStyleHost(async () => ({ ok: false }));
            await host.add("vars", ":root { --accent: rgb(1, 1, 1); } #masthead { background-color: var(--accent); }");
            const first = document.adoptedStyleSheets.at(-1);

            await host.add("vars", ":root { --accent: rgb(2, 2, 2); } #masthead { background-color: var(--accent); }");
            return {
                sameSheet: document.adoptedStyleSheets.at(-1) === first,
                count: document.adoptedStyleSheets.length,
                colour: getComputedStyle(document.querySelector("#masthead")).backgroundColor
            };
        });

        expect(result.sameSheet).toBe(true);
        expect(result.count).toBe(1);
        expect(result.colour).toBe("rgb(2, 2, 2)");
        await close();
    });
});

describe("layout operations on a real DOM", () => {
    it("restructures and then undoes back to exactly what was there", async () => {
        const { page, close } = await open("/page");
        const result = await page.evaluate(() => {
            const before = document.body.innerHTML;
            const applied = __oriel.domops.applyOps(
                [
                    { op: "remove", select: "#ads" },
                    { op: "unwrap", select: "#wrap" },
                    { op: "wrap", select: ".post", with: { tag: "section", class: "card" } },
                    { op: "move", select: "#masthead", into: "footer", position: "prepend" },
                    // By the time this runs, `wrap` has put the rank one level
                    // down inside a card, so the key has to be read from a
                    // descendant. Sorting the wrappers by their own attributes
                    // would silently do nothing, which is the trap here.
                    {
                        op: "sort",
                        select: "main",
                        by: { selector: ".post", attr: "data-rank" },
                        numeric: true
                    },
                    { op: "setAttr", select: "main", attr: "data-skinned", value: "yes" }
                ],
                { document }
            );
            const changed = {
                ads: Boolean(document.querySelector("#ads")),
                cards: document.querySelectorAll("section.card > article.post").length,
                mastheadParent: document.querySelector("#masthead").parentElement.tagName,
                order: [...document.querySelectorAll("main .post")].map((el) => el.dataset.rank)
            };
            applied.undo();
            return { before, after: document.body.innerHTML, changed, errors: applied.errors };
        });

        expect(result.errors).toEqual([]);
        expect(result.changed).toEqual({
            ads: false,
            cards: 2,
            mastheadParent: "FOOTER",
            order: ["1", "2"]
        });
        // Byte-identical, in the engine that will be doing it on the device.
        expect(result.after).toBe(result.before);
        await close();
    });

    it("settles a watched operation in a bounded number of passes while the page mutates", async () => {
        const { page, close } = await open("/page");
        const passes = await page.evaluate(async () => {
            let sweeps = 0;
            const runner = __oriel.domops.createRunner(
                [{ op: "wrap", select: ".post", with: { tag: "section", class: "card" }, watch: true }],
                {
                    document,
                    schedule: (fn) => requestAnimationFrame(() => {
                        sweeps += 1;
                        fn();
                    })
                }
            );
            runner.start();

            const article = document.createElement("article");
            article.className = "post";
            document.querySelector("main").append(article);

            await new Promise((resolve) => setTimeout(resolve, 300));
            runner.stop();
            return { sweeps, wrapped: document.querySelectorAll("section.card").length };
        });

        // Wrapping a node mutates the DOM, which would schedule another pass,
        // which would wrap the wrapper. Under a real rAF, on a real engine.
        expect(passes.wrapped).toBe(3);
        expect(passes.sweeps).toBeLessThanOrEqual(2);
        await close();
    });

    it("rewrites text without touching script contents", async () => {
        const { page, close } = await open("/page");
        const result = await page.evaluate(() => {
            const script = document.createElement("script");
            script.type = "text/plain";
            script.textContent = "var example = 1;";
            document.body.append(script);

            __oriel.domops.applyOps(
                [{ op: "rewriteText", select: "body", pattern: "example", with: "REPLACED" }],
                { document }
            );
            return { script: script.textContent, heading: document.querySelector("h1").textContent };
        });
        expect(result.script).toBe("var example = 1;");
        await close();
    });
});

describe("the sanitizer, against WebKit's own parser", () => {
    it("strips everything that could execute", async () => {
        // jsdom is a parser too, but this is the parser. An HTML string that
        // survives jsdom's normalisation and not WebKit's — or the reverse —
        // is exactly the kind of gap a sanitizer test is for.
        const { page, close } = await open("/page");
        const html = await page.evaluate(() => {
            const nasty = [
                '<script>window.__pwned = 1<\/script>',
                '<img src=x onerror="window.__pwned = 1">',
                '<a href="javascript:window.__pwned=1">a</a>',
                // A real control character, not the text "": browsers
                // strip C0 controls and whitespace before working out a scheme,
                // so this is `javascript:` as far as a click is concerned.
                `<a href=" ${String.fromCharCode(1)}JaVaScRiPt:window.__pwned=1">b</a>`,
                `<a href="java${String.fromCharCode(9)}script:window.__pwned=1">c</a>`,
                '<iframe src="data:text/html,<script>1<\\/script>"></iframe>',
                '<svg><script>window.__pwned = 1<\/script></svg>',
                '<object data="x"></object>',
                '<link rel=stylesheet href=x>',
                '<base href="http://evil.test/">',
                '<form action="javascript:1"><button formaction="javascript:1">x</button></form>'
            ].join("");

            const fragment = __oriel.domops.sanitizeFragment(nasty, document);
            const holder = document.createElement("div");
            holder.append(fragment);
            document.body.append(holder);
            return {
                markup: holder.innerHTML,
                pwned: window.__pwned ?? null
            };
        });

        expect(html.pwned).toBeNull();
        for (const forbidden of ["<script", "<iframe", "<object", "<link", "<base", "onerror"]) {
            expect(html.markup.toLowerCase()).not.toContain(forbidden);
        }
        expect(html.markup.toLowerCase()).not.toContain("javascript:");
        await close();
    });

    it("keeps the harmless parts", async () => {
        const { page, close } = await open("/page");
        const markup = await page.evaluate(() => {
            const fragment = __oriel.domops.sanitizeFragment(
                '<p class="x">hello <b>there</b></p><a href="https://example.com/">link</a><img src="https://example.com/a.png">',
                document
            );
            const holder = document.createElement("div");
            holder.append(fragment);
            return holder.innerHTML;
        });
        expect(markup).toContain("<b>there</b>");
        expect(markup).toContain('href="https://example.com/"');
        expect(markup).toContain("a.png");
        await close();
    });
});

describe("URL matching against WebKit's URL parser", () => {
    it("agrees with Node about the cases that decide who gets skinned", async () => {
        // `core/target.js` is tested exhaustively in Node. This asks only
        // whether WebKit's URL parser normalises anything differently — a
        // punycode host or a collapsed path would move the boundary.
        const { page, close } = await open("/page");
        const verdicts = await page.evaluate(() => {
            const targets = { include: [{ kind: "match", value: "*://*.example.com/*" }], exclude: [] };
            const compiled = __oriel.compileTargets(targets);
            return [
                "https://example.com/",
                "https://a.b.example.com/x?y#z",
                "https://EXAMPLE.COM/",
                "https://evil.com/?q=example.com",
                "https://notexample.com/",
                "https://example.com.evil.com/",
                "ftp://example.com/x",
                "https://exämple.com/"
            ].map((url) => [url, compiled.test(url)]);
        });

        expect(Object.fromEntries(verdicts)).toEqual({
            "https://example.com/": true,
            "https://a.b.example.com/x?y#z": true,
            "https://EXAMPLE.COM/": true,
            "https://evil.com/?q=example.com": false,
            "https://notexample.com/": false,
            "https://example.com.evil.com/": false,
            "ftp://example.com/x": false,
            "https://exämple.com/": false
        });
        await close();
    });
});

describe("generated user-script source in JavaScriptCore", () => {
    it("runs, and its cleanup takes its stylesheet back", async () => {
        const { page, close } = await open("/page");
        const result = await page.evaluate(() => {
            const source = __oriel.wrapForUserScriptWorld({
                skinId: "probe",
                name: "Probe",
                vars: { accent: "#ff0000" },
                code: `
                    oriel.css('#masthead { background-color: ' + oriel.vars.accent + '; }');
                    window.__ranWith = oriel.vars.accent;
                `
            });
            // No extension messaging here; the wrapper must survive that.
            window.chrome = { runtime: { sendMessage: () => Promise.resolve({ ok: true }) } };
            (0, eval)(source);

            const applied = getComputedStyle(document.querySelector("#masthead")).backgroundColor;
            window.dispatchEvent(new CustomEvent("oriel:cleanup:probe"));
            return {
                ran: window.__ranWith,
                applied,
                afterCleanup: getComputedStyle(document.querySelector("#masthead")).backgroundColor
            };
        });

        expect(result.ran).toBe("#ff0000");
        expect(result.applied).toBe("rgb(255, 0, 0)");
        expect(result.afterCleanup).not.toBe("rgb(255, 0, 0)");
        await close();
    });
});

describe("single-page navigation in a real engine", () => {
    it("sees pushState, replaceState, popstate and hashchange", async () => {
        const { page, close } = await open("/spa");
        const seen = await page.evaluate(async () => {
            const urls = [];
            let current = location.href;
            const announce = () => {
                if (location.href === current) return;
                current = location.href;
                urls.push(new URL(current).pathname + location.hash);
            };
            for (const name of ["pushState", "replaceState"]) {
                const original = history[name];
                history[name] = function (...args) {
                    const result = original.apply(this, args);
                    announce();
                    return result;
                };
            }
            addEventListener("popstate", announce);
            addEventListener("hashchange", announce);

            history.pushState({}, "", "/spa/a");
            history.replaceState({}, "", "/spa/b");
            location.hash = "#c";
            await new Promise((resolve) => setTimeout(resolve, 100));
            history.back();
            await new Promise((resolve) => setTimeout(resolve, 200));
            return urls;
        });

        expect(seen.slice(0, 3)).toEqual(["/spa/a", "/spa/b", "/spa/b#c"]);
        expect(seen.length).toBeGreaterThan(3);
        await close();
    });
});
