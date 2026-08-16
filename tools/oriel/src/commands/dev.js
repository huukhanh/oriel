/**
 * The authoring loop: serve a skin directory, watch it, and never let a
 * syntax error take the server down. `/skin.json` and `/version` are what
 * the extension itself polls once you paste the install URL in; `/` is for
 * the human sitting at the editor.
 *
 * @module commands/dev
 */

import http from "node:http";
import { watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { exec } from "node:child_process";
import path from "node:path";
import { parseArgs, ArgError } from "../args.js";
import { log, formatDiagnostic } from "../log.js";
import { loadCore } from "../core.js";
import { loadSkin, hasErrors, buildWireSkin } from "../skin-loader.js";

const HELP = `oriel dev [dir] [--port 7373] [--open]

Serve the skin in [dir] (default: .) for live preview. Paste the printed
install URL into Oriel; it polls /version and refetches /skin.json when it
changes.

  --port <n>   Port to listen on (default 7373)
  --open       Open the status page in the default browser`;

const DEBOUNCE_MS = 100;
const POLL_MS = 500;
const IGNORED_DIRS = new Set(["node_modules", ".git"]);

export async function run(argv) {
    let parsed;
    try {
        parsed = parseArgs(argv, { flags: { port: "string", open: "boolean", help: "boolean" } });
    } catch (err) {
        if (err instanceof ArgError) { log.error(err.message); return 1; }
        throw err;
    }
    if (parsed.flags.help) { log.raw(HELP); return 0; }

    const dir = path.resolve(parsed.positional[0] ?? ".");
    const port = Number(parsed.flags.port ?? 7373);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        log.error(`bad --port: ${parsed.flags.port}`);
        return 1;
    }

    const core = await loadCore();
    const state = { rev: 0, name: null, targetsDesc: "unknown", diagnostics: [], wire: null, stale: false };

    async function revalidate() {
        state.rev += 1;
        try {
            const loaded = await loadSkin(dir, core);
            state.name = loaded.name ?? null;
            state.diagnostics = loaded.diagnostics;
            state.targetsDesc = describeTargetsSafe(core, loaded.targets);
            if (hasErrors(loaded.diagnostics)) {
                state.stale = state.wire !== null;
            } else {
                state.wire = buildWireSkin(loaded);
                state.stale = false;
            }
        } catch (err) {
            state.diagnostics = [{ path: path.relative(process.cwd(), dir) || ".", line: 1, message: err.message, severity: "error" }];
            state.stale = state.wire !== null;
        }
        for (const d of state.diagnostics) log.raw(formatDiagnostic(d));
        if (!state.diagnostics.length) log.ok(`rev ${state.rev}: ok`);
        else if (state.stale) log.warn(`rev ${state.rev}: still serving the last good version`);
    }

    await revalidate();

    const server = http.createServer((req, res) => handleRequest(req, res, state, port));
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
    });

    const url = `http://127.0.0.1:${port}/`;
    log.ok(`serving ${path.relative(process.cwd(), dir) || "."} at ${url}`);
    log.info(`install URL: ${url}skin.json`);
    if (parsed.flags.open) openBrowser(url);

    let timer = null;
    const scheduled = () => {
        clearTimeout(timer);
        timer = setTimeout(revalidate, DEBOUNCE_MS);
    };

    const stopWatching = startWatching(dir, scheduled);

    return new Promise((resolve) => {
        const shutdown = () => {
            clearTimeout(timer);
            stopWatching();
            server.close(() => resolve(0));
        };
        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
    });
}

function handleRequest(req, res, state, port) {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const noStore = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };

    if (url.pathname === "/skin.json") {
        res.writeHead(200, { "Content-Type": "application/json", ...noStore });
        res.end(JSON.stringify(state.wire ?? {}));
        return;
    }
    if (url.pathname === "/version") {
        res.writeHead(200, { "Content-Type": "application/json", ...noStore });
        res.end(JSON.stringify({ rev: state.rev }));
        return;
    }
    if (url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(statusPage(state, port));
        return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
}

function describeTargetsSafe(core, targets) {
    try {
        return core.describeTargets(targets);
    } catch {
        return "unknown";
    }
}

/**
 * `fs.watch(..., {recursive: true})` works on macOS and Windows but not on
 * most Linux filesystems, where it throws synchronously. Falling back to a
 * stat poll is what keeps `dev` usable there at all.
 */
function startWatching(dir, onChange) {
    try {
        const watcher = watch(dir, { recursive: true }, onChange);
        return () => watcher.close();
    } catch {
        let prev = null;
        const timer = setInterval(async () => {
            const next = await snapshot(dir);
            if (prev) {
                const changed = next.size !== prev.size || [...next].some(([file, mtime]) => prev.get(file) !== mtime);
                if (changed) onChange();
            }
            prev = next;
        }, POLL_MS);
        return () => clearInterval(timer);
    }
}

async function snapshot(dir) {
    const files = new Map();
    async function walk(current) {
        let entries;
        try {
            entries = await readdir(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (IGNORED_DIRS.has(entry.name)) continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) await walk(full);
            else {
                try {
                    files.set(full, (await stat(full)).mtimeMs);
                } catch {
                    // deleted between readdir and stat — next poll will settle
                }
            }
        }
    }
    await walk(dir);
    return files;
}

function openBrowser(url) {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start \"\"" : "xdg-open";
    exec(`${cmd} ${JSON.stringify(url)}`, () => {
        // best-effort — a missing opener just means the author copies the URL themselves
    });
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function statusPage(state, port) {
    const name = state.name ?? "(unnamed skin)";
    const installUrl = `http://127.0.0.1:${port}/skin.json`;
    const problems = state.diagnostics
        .map((d) => `<li class="${d.severity === "warning" ? "warning" : "error"}">${escapeHtml(`${d.path}:${d.line ?? 1}`)} — ${escapeHtml(d.message)}</li>`)
        .join("\n");

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="2">
<title>oriel dev — ${escapeHtml(name)}</title>
<style>
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  code { background: #f2f2f2; padding: .15em .4em; border-radius: 4px; font-size: .95em; }
  .stale { color: #b45309; font-weight: normal; font-size: .7em; }
  ul { padding-left: 1.2em; }
  li.error { color: #b91c1c; }
  li.warning { color: #b45309; }
</style>
</head>
<body>
<h1>${escapeHtml(name)} ${state.stale ? '<span class="stale">(stale — showing the last good version)</span>' : ""}</h1>
<p>rev ${state.rev} &middot; targets: ${escapeHtml(state.targetsDesc)}</p>
<p>Install URL — paste into Oriel:<br><code>${escapeHtml(installUrl)}</code></p>
${state.diagnostics.length ? `<h2>Problems</h2><ul>${problems}</ul>` : "<p>No problems.</p>"}
</body>
</html>
`;
}
