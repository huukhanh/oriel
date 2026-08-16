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
import { cp, mkdir, rm, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestFor, TARGETS, VERSION } from "../hosts/extension/manifest.config.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
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
    { in: join(root, "hosts", "extension", "background", "main.js"), out: "background" },
    { in: join(root, "engine", "runtime", "main.js"), out: "content" },
    { in: join(root, "browser", "ui", "popup.js"), out: "popup" },
    { in: join(root, "browser", "ui", "manager.js"), out: "manager" }
];

/** Copied verbatim, path preserved relative to the second element. */
const COPY = [
    [join(root, "browser", "ui"), ["popup.html", "manager.html", "theme.css"], ""],
    [join(root, "assets", "icons"), null, "icons"]
];

async function copyStatic(outDir) {
    for (const [dir, names, sub] of COPY) {
        if (!existsSync(dir)) continue;
        const list = names ?? (await readdir(dir));
        for (const name of list) {
            const from = join(dir, name);
            if (!existsSync(from)) continue;
            const to = sub ? join(outDir, sub, name) : join(outDir, name);
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
 * Every file the manifest names must actually be in the output. A manifest
 * pointing at a file that is not there produces a browser error that names the
 * manifest, not the missing file, and on a phone there is no console to read it
 * in anyway.
 *
 * The message protocol is checked separately and statically, in
 * test/protocol.test.js — by the time the bundle exists the constants have been
 * inlined and grepping for them proves nothing.
 */
async function checkManifestFiles(outDir, target) {
    const manifest = manifestFor(target);
    const referenced = [
        ...(manifest.background?.service_worker ? [manifest.background.service_worker] : []),
        ...(manifest.background?.scripts ?? []),
        ...(manifest.content_scripts ?? []).flatMap((entry) => [...(entry.js ?? []), ...(entry.css ?? [])]),
        ...(manifest.action?.default_popup ? [manifest.action.default_popup] : []),
        ...(manifest.options_ui?.page ? [manifest.options_ui.page] : []),
        ...Object.values(manifest.icons ?? {})
    ];
    return referenced.filter((file) => !existsSync(join(outDir, file))).map((file) => `${target}: missing ${file}`);
}

const built = [];
for (const target of targets) {
    built.push([target, await buildTarget(target)]);
}

let failed = false;
for (const [target, outDir] of built) {
    for (const problem of await checkManifestFiles(outDir, target)) {
        process.stderr.write(`build: ${problem}\n`);
        failed = true;
    }
}

if (!watch) {
    process.stdout.write(`built ${built.map(([, dir]) => relative(root, dir)).join(", ")}\n`);
}
if (failed) process.exit(1);
