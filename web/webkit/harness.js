import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..", "..");

export const preludeSource = readFileSync(join(repoRoot, "web", "src", "prelude.js"), "utf8");
export const goldenWrapper = readFileSync(
    join(repoRoot, "fixtures", "wrapper-golden.js"),
    "utf8"
);

/**
 * A throwaway HTTP server, because the interesting questions are about
 * *headers* — `Content-Security-Policy` above all — and a `data:` URL cannot
 * carry one.
 *
 * `routes` maps a path to `{ body, headers }`.
 */
export function startServer(routes) {
    const server = createServer((request, response) => {
        const path = request.url.split("?")[0];
        const route = routes[path];
        if (!route) {
            response.writeHead(404, { "Content-Type": "text/plain" });
            response.end("not found");
            return;
        }
        response.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            ...(route.headers || {})
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
 * A page with the prelude injected at document-start.
 *
 * `addInitScript` is Playwright's WebKit binding for exactly the mechanism this
 * app uses — a user script evaluated before any of the page's own code. That
 * correspondence is what makes these tests worth more than the jsdom ones.
 */
export async function pageWithPrelude(browser, extraScripts = []) {
    const context = await browser.newContext();
    await context.addInitScript({ content: preludeSource });
    for (const source of extraScripts) {
        await context.addInitScript({ content: source });
    }
    const page = await context.newPage();
    return { context, page };
}

export const LAUNCH_TIMEOUT = 60_000;
