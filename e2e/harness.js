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
import { build as esbuild } from "esbuild";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, existsSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
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
    // Playwright validates host dependencies against the dpkg database, which
    // knows nothing about a hand-staged prefix. The libraries are there; the
    // bookkeeping is not.
    process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "1";

    // Headless WPE aborts with "Could not create WPE EGL display" when there is
    // no GPU. Disabling the renderer is not enough on its own — Mesa still has
    // to be pointed at the staged prefix's drivers and EGL vendor config, or it
    // finds nothing and the web process dies before the first page opens,
    // reported as "Target page, context or browser has been closed".
    process.env.LIBGL_DRIVERS_PATH = join(lib, "dri");
    process.env.__EGL_VENDOR_LIBRARY_DIRS = join(prefix, "usr", "share", "glvnd", "egl_vendor.d");
    process.env.WEBKIT_DISABLE_DMABUF_RENDERER = "1";
    process.env.WEBKIT_DISABLE_COMPOSITING_MODE = "1";
    process.env.LIBGL_ALWAYS_SOFTWARE = "1";
    process.env.GALLIUM_DRIVER = "llvmpipe";

    stageFonts(prefix);
}

/**
 * Give the browser something to render text with.
 *
 * This box has no fonts and no `/etc/fonts` at all, and the symptom is not the
 * one you would guess: Chromium loads a page fine, then *closes it* a second
 * later while shaping text, reported to the test as "Target page, context or
 * browser has been closed". No crash event, no console error, nothing to
 * attribute it to. The staged prefix already carries both a fontconfig and two
 * hundred font files, so this only has to point at them.
 */
function stageFonts(prefix) {
    const fontConfig = join(prefix, "etc", "fonts");
    const fonts = join(prefix, "usr", "share", "fonts");
    if (!existsSync(fontConfig) || !existsSync(fonts)) return;

    process.env.FONTCONFIG_PATH = fontConfig;

    // fontconfig's stock configuration looks in `$XDG_DATA_HOME/fonts`, which
    // is a directory this user owns even with no root anywhere.
    const share = join(process.env.HOME ?? "", ".local", "share");
    const link = join(share, "fonts");
    if (!existsSync(link)) {
        try {
            mkdirSync(share, { recursive: true });
            symlinkSync(fonts, link, "dir");
        } catch {
            // Already there, or unwritable. Either way the browser will tell us.
        }
    }
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

/**
 * Bundle a snippet of the extension's own source into something a browser can
 * evaluate at document_start.
 *
 * WebKit cannot load an extension, so the engine tests reach the modules the
 * only other way there is: bundle them, hang them off a global, and drive them
 * from the page. What that gives up is the extension plumbing; what it buys is
 * the modules running in JavaScriptCore, on WebCore's DOM, which is where they
 * will actually run on the device this product is aimed at.
 *
 * @param {string} source  ESM, resolved relative to the repository root.
 */
export async function bundleForBrowser(source) {
    const result = await esbuild({
        stdin: { contents: source, resolveDir: repoRoot, loader: "js" },
        bundle: true,
        format: "iife",
        target: ["safari16"],
        write: false
    });
    return result.outputFiles[0].text;
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
