/**
 * Validates one or more skins and exits non-zero on any error. All the
 * actual validation lives in skin-loader.js (which defers to the real
 * extension/src/core modules where they exist); this command is just the
 * reporting shell around it — plus, for a `skins/index.json` gallery file,
 * the one check that's specific to it: `path` and `install` have to name
 * the same file (docs/SKIN-FORMAT.md §10).
 *
 * @module commands/check
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs, ArgError } from "../args.js";
import { log, formatDiagnostic } from "../log.js";
import { loadCore } from "../core.js";
import { loadSkin, hasErrors } from "../skin-loader.js";
import { lineFromJsonError, indexJsonLines } from "../textpos.js";

const HELP = `oriel check [path...] [--json]

Validate one or more skins (a directory, a *.user.css/skin.json file, or a
skins/index.json gallery). Defaults to the current directory. Exits non-zero
if any has an error.

  --json   Print structured results instead of "path:line: message" lines.`;

export async function run(argv) {
    let parsed;
    try {
        parsed = parseArgs(argv, { flags: { json: "boolean", help: "boolean" } });
    } catch (err) {
        if (err instanceof ArgError) { log.error(err.message); return 1; }
        throw err;
    }
    if (parsed.flags.help) { log.raw(HELP); return 0; }

    const paths = parsed.positional.length ? parsed.positional : ["."];
    const core = await loadCore();

    const results = [];
    for (const p of paths) {
        try {
            results.push(path.basename(p) === "index.json" ? await checkGalleryIndex(p) : await checkSkin(p, core));
        } catch (err) {
            results.push({ path: p, name: undefined, diagnostics: [{ path: p, line: 1, message: err.message, severity: "error" }] });
        }
    }

    if (parsed.flags.json) {
        log.raw(JSON.stringify(results.map(toJson), null, 2));
    } else {
        printLines(results);
    }

    return results.some((r) => hasErrors(r.diagnostics)) ? 1 : 0;
}

async function checkSkin(p, core) {
    const loaded = await loadSkin(p, core);
    return { path: p, name: loaded.name, diagnostics: loaded.diagnostics };
}

/**
 * `path` is relative to the repository root, which this resolves as the
 * current working directory — `oriel check` is meant to be run from there,
 * the same way `check skins/hn-rebuilt` already is.
 */
async function checkGalleryIndex(indexPath) {
    const rel = path.relative(process.cwd(), path.resolve(indexPath)) || indexPath;
    const raw = await readFile(indexPath, "utf8");

    let doc;
    try {
        doc = JSON.parse(raw);
    } catch (err) {
        return { path: rel, name: "index", diagnostics: [{ path: rel, line: lineFromJsonError(err, raw), message: `invalid JSON: ${err.message}`, severity: "error" }] };
    }
    if (!Array.isArray(doc)) {
        return { path: rel, name: "index", diagnostics: [{ path: rel, line: 1, message: "must be a JSON array of gallery entries", severity: "error" }] };
    }

    const lines = indexJsonLines(raw);
    const diagnostics = [];
    const seenIds = new Set();

    doc.forEach((entry, i) => {
        const line = lines.get(`[${i}]`) ?? 1;
        const push = (message) => diagnostics.push({ path: rel, line, message, severity: "error" });

        if (!entry || typeof entry !== "object") { push("entry must be an object"); return; }
        if (!entry.id) push('missing "id"');
        else if (seenIds.has(entry.id)) push(`duplicate id "${entry.id}"`);
        else seenIds.add(entry.id);
        if (!entry.name) push('missing "name"');
        if (!entry.path) push('missing "path"');
        if (!entry.install) push('missing "install"');
        if (!entry.path || !entry.install) return;

        if (!existsSync(path.resolve(process.cwd(), entry.path))) {
            push(`"path" does not exist: ${entry.path}`);
        }

        let installURL;
        try {
            installURL = new URL(entry.install);
        } catch {
            push(`"install" is not a valid URL: ${entry.install}`);
            return;
        }
        const wantSuffix = `/${entry.path.replace(/^\/+/, "")}`;
        if (!installURL.pathname.endsWith(wantSuffix)) {
            push(`"install" and "path" disagree — install (${entry.install}) does not end with "path" (${entry.path})`);
        }
    });

    return { path: rel, name: "index", diagnostics };
}

function printLines(results) {
    let any = false;
    for (const r of results) {
        for (const d of r.diagnostics) {
            log.raw(formatDiagnostic(d));
            any = true;
        }
    }
    if (!any) {
        log.ok(`${results.length} ${results.length === 1 ? "target" : "targets"} checked, no problems`);
    }
}

function toJson(r) {
    return { path: r.path, ok: !hasErrors(r.diagnostics), name: r.name, diagnostics: r.diagnostics };
}
