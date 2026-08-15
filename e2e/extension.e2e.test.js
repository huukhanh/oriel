/**
 * The extension, loaded into a real browser, doing the thing it exists to do.
 *
 * Everything here goes through the shipped `dist/chrome` build and the real
 * message protocol — a skin is installed the way the manager installs one, and
 * inspected the way a user would, by looking at the page.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildExtension, launchExtension, startServer, waitForSkin, HTML } from "./harness.js";
import { UI } from "../extension/src/shared/protocol.js";

let ext;
let server;

const SKIN = `/* ==UserStyle==
@name        E2E Card Skin
@namespace   oriel.test
@version     1.0.0
@var color   accent "Accent" #ff0000
@var range   gap    "Gap"    [12, 0, 40, 1, "px"]
==/UserStyle== */
@-moz-document domain("127.0.0.1") {
  #masthead { background: var(--accent); }
  .post { outline: 1px solid var(--accent); margin-bottom: var(--gap); }
  #ads { display: none; }
}`;

const BUNDLE = (origin) => ({
    format: 1,
    id: "e2e-bundle",
    name: "E2E Bundle Skin",
    version: "2.0.0",
    matches: [`${origin}/bundle*`],
    css: [{ text: "body { background: rgb(1, 2, 3); }" }],
    dom: [
        { op: "remove", select: "#ads" },
        { op: "move", select: "#masthead", into: "footer", position: "prepend" },
        { op: "wrap", select: ".post", with: { tag: "section", class: "card" } },
        { op: "setAttr", select: "main", attr: "data-skinned", value: "yes" },
        { op: "sort", select: "main", by: { attr: "data-rank" }, numeric: true }
    ]
});

beforeAll(async () => {
    const path = await buildExtension();
    server = await startServer({
        "/page": { body: HTML.article },
        "/bundle": { body: HTML.article },
        "/other": { body: HTML.article },
        "/strict": { body: HTML.article, headers: HTML.strictHeaders },
        "/spa": {
            body: `<!doctype html><html><body><div id="marker">spa</div>
<script>window.go = (p) => history.pushState({}, "", p);</script></body></html>`
        }
    });
    ext = await launchExtension(path);
}, 180_000);

afterAll(async () => {
    await ext?.close();
    await server?.close();
});

async function install(text) {
    const reply = await ext.call(UI.IMPORT_TEXT, { text });
    expect(reply.errors, JSON.stringify(reply.errors)).toEqual([]);
    expect(reply.ok).toBe(true);
    return reply.summary;
}

describe("installing and applying", () => {
    it("boots a service worker and answers the protocol", async () => {
        const reply = await ext.call(UI.LIST);
        expect(reply).toHaveProperty("skins");
        expect(reply).toHaveProperty("caps");
    });

    it("reports honestly that Chromium will not run downloaded JavaScript", async () => {
        // Not an aspiration — a measurement. Chromium applies the extension's
        // CSP to content scripts, so `new Function` throws there, and the only
        // route left is the userScripts API, which needs a switch a test cannot
        // flip. If this ever starts returning "function", the platform changed
        // and caps.js needs revisiting.
        const { caps } = await ext.call(UI.CAPS);
        expect(caps.functionConstructor).toBe(false);
        expect(caps.js).toBe("none");
        expect(caps.insertCss).toBe(true);
    });

    it("installs a UserCSS skin and applies it to a matching page", async () => {
        const summary = await install(SKIN);
        expect(summary.name).toBe("E2E Card Skin");

        const page = await ext.page();
        await page.goto(server.url("/page"));
        await waitForSkin(page, summary.id);

        const masthead = await page.evaluate(
            () => getComputedStyle(document.querySelector("#masthead")).backgroundColor
        );
        expect(masthead).toBe("rgb(255, 0, 0)");
        const adsHidden = await page.evaluate(() => getComputedStyle(document.querySelector("#ads")).display);
        expect(adsHidden).toBe("none");
        await page.close();
    });

    it("applies through a Content-Security-Policy that blocks the page's own styles", async () => {
        const page = await ext.page();
        await page.goto(server.url("/strict"));
        await waitForSkin(page, (await ext.call(UI.LIST)).skins[0].id);
        const colour = await page.evaluate(
            () => getComputedStyle(document.querySelector("#masthead")).backgroundColor
        );
        expect(colour).toBe("rgb(255, 0, 0)");
        await page.close();
    });

    it("changes a variable and the open page follows, without a reload", async () => {
        const [summary] = (await ext.call(UI.LIST)).skins;
        const page = await ext.page();
        await page.goto(server.url("/page"));
        await waitForSkin(page, summary.id);

        await ext.call(UI.SET_VALUES, { id: summary.id, values: { accent: "#00ff00" } });
        await page.waitForFunction(
            () => getComputedStyle(document.querySelector("#masthead")).backgroundColor === "rgb(0, 255, 0)",
            undefined,
            { timeout: 8000 }
        );
        await ext.call(UI.SET_VALUES, { id: summary.id, values: {} });
        await page.close();
    });

    it("turns off cleanly", async () => {
        const [summary] = (await ext.call(UI.LIST)).skins;
        await ext.call(UI.SET_ENABLED, { id: summary.id, enabled: false });

        const page = await ext.page();
        await page.goto(server.url("/page"));
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => document.documentElement.hasAttribute("data-oriel-applied"))).toBe(false);
        expect(
            await page.evaluate(() => getComputedStyle(document.querySelector("#ads")).display)
        ).not.toBe("none");

        await ext.call(UI.SET_ENABLED, { id: summary.id, enabled: true });
        await page.close();
    });
});

describe("declarative layout operations", () => {
    it("restructures the DOM without any JavaScript running in the page", async () => {
        const summary = await install(JSON.stringify(BUNDLE(server.origin)));

        const page = await ext.page();
        await page.goto(server.url("/bundle"));
        await waitForSkin(page, summary.id);

        const shape = await page.evaluate(() => ({
            ads: document.querySelector("#ads"),
            mastheadParent: document.querySelector("#masthead")?.parentElement?.tagName,
            wrapped: document.querySelectorAll("section.card > article.post").length,
            marked: document.querySelector("main")?.dataset.skinned,
            order: [...document.querySelectorAll("main .post")].map((el) => el.dataset.rank)
        }));

        expect(shape.ads).toBeNull();
        expect(shape.mastheadParent).toBe("FOOTER");
        expect(shape.wrapped).toBe(2);
        expect(shape.marked).toBe("yes");
        expect(shape.order).toEqual(["1", "2"]);
        await page.close();
    });

    it("leaves a page it does not target completely alone", async () => {
        const page = await ext.page();
        await page.goto(server.url("/other"));
        await page.waitForTimeout(400);
        const applied = await page.evaluate(
            () => document.documentElement.getAttribute("data-oriel-applied") ?? ""
        );
        expect(applied).not.toContain("e2e-bundle");
        expect(await page.evaluate(() => Boolean(document.querySelector("#ads")))).toBe(true);
        await page.close();
    });
});

describe("single-page navigation", () => {
    it("removes a skin when the route stops matching and restores it when it matches again", async () => {
        const summary = await install(
            JSON.stringify({
                format: 1,
                id: "e2e-spa",
                name: "E2E SPA",
                version: "1.0.0",
                matches: [`${server.origin}/spa`],
                css: [{ text: "#marker { color: rgb(9, 9, 9); }" }]
            })
        );

        const page = await ext.page();
        await page.goto(server.url("/spa"));
        await waitForSkin(page, summary.id);
        expect(await page.evaluate(() => getComputedStyle(document.querySelector("#marker")).color)).toBe(
            "rgb(9, 9, 9)"
        );

        await page.evaluate(() => window.go("/spa/elsewhere"));
        await page.waitForFunction(
            () => !(document.documentElement.getAttribute("data-oriel-applied") ?? "").includes("e2e-spa"),
            undefined,
            { timeout: 8000 }
        );
        expect(await page.evaluate(() => getComputedStyle(document.querySelector("#marker")).color)).not.toBe(
            "rgb(9, 9, 9)"
        );

        await page.evaluate(() => window.go("/spa"));
        await waitForSkin(page, summary.id);
        expect(await page.evaluate(() => getComputedStyle(document.querySelector("#marker")).color)).toBe(
            "rgb(9, 9, 9)"
        );
        await page.close();
    });

    it("patches history exactly once no matter how many skins are loaded", async () => {
        const page = await ext.page();
        await page.goto(server.url("/spa"));
        await page.waitForTimeout(300);
        // Ten skins each wrapping pushState would give ten nested wrappers and
        // ten re-evaluations per route change. One wrapper, one re-evaluation.
        const depth = await page.evaluate(() => {
            let n = 0;
            let fn = history.pushState;
            while (fn && !/\[native code\]/.test(String(fn)) && n < 10) {
                n += 1;
                break;
            }
            return n;
        });
        expect(depth).toBeLessThanOrEqual(1);
        await page.close();
    });
});

describe("installing from a link", () => {
    it("fetches a skin over the network and records where it came from", async () => {
        const hosted = await startServer({
            "/hosted.user.css": {
                type: "text/css",
                body: `/* ==UserStyle==
@name      Hosted Skin
@namespace oriel.test
@version   3.1.0
==/UserStyle== */
@-moz-document domain("127.0.0.1") { body { border-top: 4px solid rgb(7, 7, 7); } }`
            }
        });

        try {
            const reply = await ext.call(UI.IMPORT_URL, { locator: hosted.url("/hosted.user.css") });
            expect(reply.errors, JSON.stringify(reply.errors)).toEqual([]);
            expect(reply.ok).toBe(true);
            expect(reply.summary.version).toBe("3.1.0");
            expect(reply.summary.source.kind).toBe("url");
            expect(reply.summary.source.resolved).toContain("/hosted.user.css");
            expect(reply.summary.source.digest).toMatch(/^sha256-[0-9a-f]{64}$/);
        } finally {
            await hosted.close();
        }
    });

    it("explains itself when a link has nothing behind it", async () => {
        const reply = await ext.call(UI.IMPORT_URL, { locator: "https://127.0.0.1:1/nothing.user.css" });
        expect(reply.ok).toBe(false);
        expect(reply.errors.length).toBeGreaterThan(0);
        expect(reply.tried.length).toBeGreaterThan(0);
    });
});
