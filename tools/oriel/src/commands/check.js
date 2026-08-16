/**
 * Validates one or more skins and exits non-zero on any error. All the
 * actual validation lives in skin-loader.js (which defers to the real
 * extension/src/core modules where they exist); this command is just the
 * reporting shell around it.
 *
 * @module commands/check
 */

import { parseArgs, ArgError } from "../args.js";
import { log, formatDiagnostic } from "../log.js";
import { loadCore } from "../core.js";
import { loadSkin, hasErrors } from "../skin-loader.js";

const HELP = `oriel check [path...] [--json]

Validate one or more skins (a directory or a *.user.css/skin.json file).
Defaults to the current directory. Exits non-zero if any has an error.

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
            results.push({ path: p, loaded: await loadSkin(p, core) });
        } catch (err) {
            results.push({ path: p, error: err.message });
        }
    }

    if (parsed.flags.json) {
        log.raw(JSON.stringify(results.map(toJson), null, 2));
    } else {
        printLines(results);
    }

    const failed = results.some((r) => r.error || hasErrors(r.loaded.diagnostics));
    return failed ? 1 : 0;
}

function printLines(results) {
    let any = false;
    for (const r of results) {
        if (r.error) {
            log.error(`${r.path}: ${r.error}`);
            any = true;
            continue;
        }
        for (const d of r.loaded.diagnostics) {
            log.raw(formatDiagnostic(d));
            any = true;
        }
    }
    if (!any) {
        log.ok(`${results.length} skin${results.length === 1 ? "" : "s"} checked, no problems`);
    }
}

function toJson(r) {
    if (r.error) return { path: r.path, ok: false, error: r.error };
    return {
        path: r.path,
        ok: !hasErrors(r.loaded.diagnostics),
        name: r.loaded.name,
        id: r.loaded.id,
        diagnostics: r.loaded.diagnostics
    };
}
