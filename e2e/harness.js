/**
 * Running the real extension in a real browser, on this Linux box.
 *
 * Chromium is the only engine here that can load a WebExtension, so it is
 * where the manifest, the service worker, the content script and the message
 * router get proven. It is not Safari — the browser the product is aimed at —
 * and the difference is load-bearing rather than incidental: Chromium refuses
 * to evaluate strings in a content script and Safari does not, which is the
 * single most important behavioural fork in the codebase. What Chromium proves
 * is everything else, which is most of it. See docs/VERIFICATION.md.
 *
 * @module e2e/harness
 */

import { chromium, webkit } from "playwright";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Playwright's browsers need shared libraries this box has no root to install.
 * `scripts/setup-browsers-linux.sh` stages them into a prefix; this puts that
 * prefix on the loader path for the child process. On CI, where the deps are
 * installed properly, the directory does not exist and nothing happens.
 */
export function stageBrowserEnv() {
    const prefix = join(process.env.HOME ?? "", ".local", "pwdeps", "root");
    const lib = join(prefix, "usr", "lib", "x86_64-linux-gnu");
    if (!existsSync(lib)) return;
    process.env.LD_LIBRARY_PATH = [lib, join(prefix, "usr", "lib"), process.env.LD_LIBRARY_PATH]
        .filter(Boolean)
        .join(":");
    process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "1";
    // Headless WPE has no GPU here.
    process.env.WEBKIT_DISABLE_DMABUF_RENDERER = "1";
    process.env.WEBKIT_DISABLE_COMPOSITING_MODE = "1";
    process.env.LIBGL_ALWAYS_SOFTWARE = "1";
}

/** Build the Chrome target once per suite. */
export async function buildExtension() {
    await run(process.execPath, [join(repoRoot, "scripts", "build.mjs"), "--target", "chrome"], { cwd: repoRoot });
    return join(repoRoot, "dist", "chrome");
}

/**
 * A throwaway origin. Real HTTP rather than `data:` for two reasons: content
 * scripts do not run on `data:` URLs at all, and the interesting questions are
 * about headers — `Content-Security-Policy` above all — which a `data:` URL
 * cannot carry.
 *
 * `routes` maps a path to `{ body, headers, type }`.
 */
export function startServer(routes) {
    const server = createServer((request, response) => {
        const path = request.url.split("?")[0];
        const route = typeof routes[path] === "function" ? routes[path](request) : routes[path];
        if (!route) {
            response.writeHead(404, { "Content-Type": "text/plain" });
            response.end("not found");
            return;
        }
        response.writeHead(route.status ?? 200, {
            "Content-Type": route.type ?? "text/html; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            ...(route.headers ?? {})
        });
        response.end(route.body);
    });

    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            resolve({
                origin: `http://127.0.0.1:${port}`,
                url: (path) => `http://127.0.0.1:${port}${path}`,
                close: () => new Promise((done) => server.close(done))
            });
        });
    });
}

/**
 * Launch Chromium with the extension loaded.
 *
 * `channel: "chromium"` rather than the default: Playwright's headless default
 * is `chrome-headless-shell`, which has no extension support at all, and the
 * failure is a service worker that simply never appears.
 */
export async function launchExtension(extensionPath) {
    stageBrowserEnv();
    const profile = mkdtempSync(join(tmpdir(), "oriel-e2e-"));
    const context = await chromium.launchPersistentContext(profile, {
        channel: "chromium",
        headless: true,
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 30_000 });
    const extensionId = new URL(worker.url()).host;

    /**
     * A page inside the extension's own origin, used to speak the protocol from
     * the outside exactly as the manager does. Driving the router through a
     * real extension page rather than reaching into the worker's internals is
     * what makes these tests worth having: a handler that is unreachable
     * because of a typo in `shared/protocol.js` fails here.
     */
    const uiPage = await context.newPage();
    await uiPage.goto(`chrome-extension://${extensionId}/manager.html`);

    const call = (type, payload = {}) =>
        uiPage.evaluate(
            ([t, p]) => chrome.runtime.sendMessage({ type: t, ...p }),
            [type, payload]
        );

    return {
        context,
        worker,
        extensionId,
        uiPage,
        call,
        page: () => context.newPage(),
        async close() {
            await context.close().catch(() => {});
            rmSync(profile, { recursive: true, force: true });
        }
    };
}

/** WebKit, with a script injected at document_start — no extension involved. */
export async function launchWebKit() {
    stageBrowserEnv();
    return webkit.launch();
}

/** A page whose skinning has settled: the engine reports when it has applied. */
export async function waitForSkin(page, id, timeout = 10_000) {
    await page.waitForFunction(
        (skinId) => document.documentElement.getAttribute("data-oriel-applied")?.split(" ").includes(skinId),
        id,
        { timeout }
    );
}

export const HTML = {
    /** A page with enough structure for layout operations to have something to do. */
    article: `<!doctype html><html><head><title>t</title></head><body>
<div id="wrap">
  <header id="masthead"><h1>Site</h1><nav><a href="/a">A</a></nav></header>
  <div id="ads"><span class="ad">buy</span></div>
  <main>
    <article class="post" data-rank="2"><h2>Second</h2><p>body two</p></article>
    <article class="post" data-rank="1"><h2>First</h2><p>body one</p></article>
  </main>
  <footer>footer</footer>
</div></body></html>`,

    /** The same page, served with a CSP strict enough to break naive injection. */
    strictHeaders: {
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'"
    }
};
