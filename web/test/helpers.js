import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..", "..");

export const preludeSource = readFileSync(join(repoRoot, "web", "src", "prelude.js"), "utf8");

export const fixture = JSON.parse(
    readFileSync(join(repoRoot, "fixtures", "match-cases.json"), "utf8")
);

/**
 * A fresh document at `url`, with the prelude executed in it as a real classic
 * `<script>` — which is what WKUserScript does, and closer than `eval` in a
 * shared global.
 *
 * Per-test windows matter here: the guard reads `location.href`, and a single
 * shared jsdom cannot change origin (cross-origin `replaceState` throws). Each
 * test gets the origin it needs instead of contorting around one.
 */
export async function makeWindow(url) {
    const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
        url,
        runScripts: "dangerously"
    });

    // jsdom starts at readyState "loading" and reaches "complete" a tick later.
    // Waiting matters: the runtime honours @run-at, so a document-end script
    // registered against a still-loading document correctly defers — and a
    // synchronous assertion right after would see nothing. A real page in these
    // tests has finished loading, so the window should behave that way too.
    if (dom.window.document.readyState !== "complete") {
        await new Promise((resolve) => {
            dom.window.addEventListener("load", resolve, { once: true });
            setTimeout(resolve, 500);
        });
    }

    const script = dom.window.document.createElement("script");
    script.textContent = preludeSource;
    dom.window.document.head.appendChild(script);
    script.remove();
    return dom.window;
}

/**
 * Run arbitrary classic-script source in `win`, the way an injected user script
 * is evaluated.
 */
export function evaluateIn(win, source) {
    const script = win.document.createElement("script");
    script.textContent = source;
    win.document.head.appendChild(script);
    script.remove();
}

/**
 * An SPA route change. Always same-origin: a cross-origin navigation creates a
 * new document, so the guard is not involved in one.
 */
export function navigate(win, pathOrURL) {
    win.history.pushState({}, "", pathOrURL);
}
