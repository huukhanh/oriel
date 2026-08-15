#!/usr/bin/env node
/**
 * Bundle the extension into `dist/<target>/`, one directory per browser.
 *
 * Content scripts cannot be ES modules in any current browser, so the source
 * is written as modules and bundled to classic scripts here. That is the only
 * reason this file exists — there is no transpilation, no minification by
 * default, and no dependency graph beyond esbuild.
 *
 * Usage: node scripts/build.mjs [--target chrome|firefox|safari|all] [--watch] [--minify]
 */
import { build, context } from "esbuild";
import { cp, mkdir, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestFor, TARGETS, VERSION } from "../extension/manifest.config.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "extension", "src");
const dist = join(root, "dist");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
};

const targets = value("target", "all") === "all" ? TARGETS : [value("target")];
const minify = flag("minify");
const watch = flag("watch");

/** Entry points, and the filename each must land on — the HTML refers to these by name. */
const ENTRIES = [
    { in: join(src, "background", "main.js"), out: "background" },
    { in: join(src, "content", "main.js"), out: "content" },
    { in: join(src, "ui", "popup.js"), out: "popup" },
    { in: join(src, "ui", "manager.js"), out: "manager" }
];

/** Copied verbatim, path preserved relative to the second element. */
const COPY = [
    [join(src, "ui"), ["popup.html", "manager.html", "theme.css"]],
    [join(root, "extension", "icons"), null]
];

async function copyStatic(outDir) {
    for (const [dir, names] of COPY) {
        if (!existsSync(dir)) continue;
        const list = names ?? (await readdir(dir));
        const sub = relative(join(root, "extension"), dir);
        for (const name of list) {
            const from = join(dir, name);
            if (!existsSync(from)) continue;
            const to = sub === "src/ui" ? join(outDir, name) : join(outDir, sub, name);
            await mkdir(dirname(to), { recursive: true });
            await cp(from, to, { recursive: true });
        }
    }
}

async function buildTarget(target) {
    const outDir = join(dist, target);
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });

    const options = {
        entryPoints: ENTRIES.map((e) => ({ in: e.in, out: e.out })),
        outdir: outDir,
        bundle: true,
        format: "iife",
        target: ["safari16", "chrome120", "firefox128"],
        minify,
        sourcemap: minify ? false : "inline",
        legalComments: "inline",
        // The one build-time switch: code can branch on the browser it was
        // built for without a runtime probe. Used sparingly — capability
        // detection at runtime is more honest and survives a browser update.
        define: { __ORIEL_TARGET__: JSON.stringify(target), __ORIEL_VERSION__: JSON.stringify(VERSION) },
        logLevel: "silent"
    };

    if (watch) {
        const ctx = await context(options);
        await ctx.watch();
    } else {
        await build(options);
    }

    await copyStatic(outDir);
    await writeFile(
        join(outDir, "manifest.json"),
        JSON.stringify(manifestFor(target), null, 2) + "\n"
    );

    return outDir;
}

/**
 * A shipped build must not contain a `sendMessage` type that
 * shared/protocol.js does not declare. Cheap to check, and it catches the
 * class of typo that produces a silent no-op on a phone.
 */
async function checkProtocolUse(outDir) {
    const protocol = await readFile(join(src, "shared", "protocol.js"), "utf8");
    const declared = new Set([...protocol.matchAll(/"((?:page|ui|event)\.[a-zA-Z]+)"/g)].map((m) => m[1]));
    const problems = [];
    for (const name of ["background.js", "content.js", "popup.js", "manager.js"]) {
        const file = join(outDir, name);
        if (!existsSync(file)) continue;
        const text = await readFile(file, "utf8");
        for (const [, used] of text.matchAll(/"((?:page|ui|event)\.[a-zA-Z]+)"/g)) {
            if (!declared.has(used)) problems.push(`${name}: undeclared message "${used}"`);
        }
    }
    return [...new Set(problems)];
}

const built = [];
for (const target of targets) {
    built.push(await buildTarget(target));
}

let failed = false;
for (const outDir of built) {
    const problems = await checkProtocolUse(outDir);
    for (const p of problems) {
        process.stderr.write(`build: ${p}\n`);
        failed = true;
    }
}

if (!watch) {
    process.stdout.write(`built ${built.map((d) => relative(root, d)).join(", ")}\n`);
}
if (failed) process.exit(1);
