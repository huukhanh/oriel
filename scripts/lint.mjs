#!/usr/bin/env node
/**
 * The zero-dependency gate. Two things, both of which have caught real bugs on
 * projects shaped like this one:
 *
 *   1. Every JavaScript file parses. `node --check` costs nothing and a syntax
 *      error in a content script is invisible until a page fails to skin.
 *   2. `extension/src/core/` stays pure. The moment a core module reaches for
 *      `chrome.*` it stops being testable in Node, and the project's entire
 *      verification story is that the interesting logic is testable in Node.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SKIP = new Set(["node_modules", ".git", "dist", ".pnpm-store", "build"]);

async function* walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(full);
        else if (extname(entry.name) === ".js" || extname(entry.name) === ".mjs") yield full;
    }
}

const problems = [];

for await (const file of walk(root)) {
    try {
        await run(process.execPath, ["--check", file]);
    } catch (error) {
        const message = String(error.stderr || error.message).split("\n").slice(0, 4).join(" ");
        problems.push(`${relative(root, file)}: ${message}`);
    }
}

// The purity rule. `document` is allowed because core modules take one as an
// argument — that is the whole convention — but a *global* reference to the
// extension APIs or to `window` means the module cannot run under vitest.
const FORBIDDEN = [
    [/\bchrome\s*\./, "chrome.* — core must not touch extension APIs"],
    [/\bbrowser\s*\./, "browser.* — core must not touch extension APIs"],
    [/\bwindow\s*\./, "window.* — core runs in Node too"],
    [/(?<![.\w])localStorage\b/, "localStorage — core has no storage of its own"],
    [/(?<![.\w])fetch\s*\(/, "fetch( — core does URL algebra; the caller fetches"]
];

const coreDir = join(root, "extension", "src", "core");
for await (const file of walk(coreDir)) {
    const text = await readFile(file, "utf8");
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const [pattern, why] of FORBIDDEN) {
        if (pattern.test(code)) problems.push(`${relative(root, file)}: ${why}`);
    }
}

for (const problem of problems) process.stderr.write(`lint: ${problem}\n`);
if (problems.length) process.exit(1);
process.stdout.write("lint: clean\n");
