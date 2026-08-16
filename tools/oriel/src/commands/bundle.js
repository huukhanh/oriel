/**
 * Emits the single self-contained skin.json a user can paste, or a repo can
 * serve raw: every css/dom/js path inlined as text, assets inlined as data
 * URLs. skin-loader.js already resolves paths to text while loading — this
 * command's own job is just asset inlining, size reporting, and the file.
 *
 * @module commands/bundle
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, ArgError } from "../args.js";
import { log, formatDiagnostic } from "../log.js";
import { loadCore } from "../core.js";
import { loadSkin, hasErrors, buildWireSkin } from "../skin-loader.js";

const HELP = `oriel bundle [dir] [--out skin.json] [--inline]

Emit a single self-contained skin.json for the skin in [dir] (default: .).
Every css/dom/js path is inlined as text and every asset as a data URL.

  --out <file>   Where to write it (default: ./skin.json)
  --inline       No-op — bundle always fully inlines. Kept for parity with
                 the {text} form skin.json entries can take.`;

const MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
};

const WARN_BYTES = 512 * 1024;

export async function run(argv) {
    let parsed;
    try {
        parsed = parseArgs(argv, { flags: { out: "string", inline: "boolean", help: "boolean" } });
    } catch (err) {
        if (err instanceof ArgError) { log.error(err.message); return 1; }
        throw err;
    }
    if (parsed.flags.help) { log.raw(HELP); return 0; }

    const dir = parsed.positional[0] ?? ".";
    const core = await loadCore();
    const loaded = await loadSkin(dir, core);

    for (const d of loaded.diagnostics) log.raw(formatDiagnostic(d));
    if (hasErrors(loaded.diagnostics)) {
        log.error("cannot bundle: fix the errors above first");
        return 1;
    }

    const wire = buildWireSkin(loaded);
    if (wire.assets) {
        for (const [name, absPath] of Object.entries(wire.assets)) {
            wire.assets[name] = await assetDataUrl(absPath);
        }
    }

    const json = `${JSON.stringify(wire, null, 2)}\n`;
    const outPath = path.resolve(parsed.flags.out ?? "skin.json");
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, json, "utf8");

    const bytes = Buffer.byteLength(json);
    log.ok(`wrote ${path.relative(process.cwd(), outPath)} (${formatBytes(bytes)})`);
    if (bytes > WARN_BYTES) {
        log.warn(`${formatBytes(bytes)} is a lot to hold in extension storage on a phone — consider trimming assets`);
    }
    return 0;
}

async function assetDataUrl(absPath) {
    const buf = await readFile(absPath);
    const mime = MIME_TYPES[path.extname(absPath).toLowerCase()] ?? "application/octet-stream";
    return `data:${mime};base64,${buf.toString("base64")}`;
}

export function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
