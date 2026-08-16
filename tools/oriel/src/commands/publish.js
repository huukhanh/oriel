/**
 * Publishing is entirely dry: this command touches neither the network nor
 * the working tree. It tells the author what `git` commands to run and
 * whether `updateURL` is already correct — the single most common way a
 * skin ships broken, because a wrong or missing `updateURL` means it can
 * never be offered an update again.
 *
 * @module commands/publish
 */

import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs, ArgError } from "../args.js";
import { log, formatDiagnostic } from "../log.js";
import { loadCore } from "../core.js";
import { loadSkin, hasErrors, sourceFiles } from "../skin-loader.js";

const execFileAsync = promisify(execFile);

const HELP = `oriel publish [dir]

Prints what publishing this skin would involve: the files, the updateURL it
should carry, and the git commands to run. Never touches the network or the
working tree.`;

/**
 * @param {string} remote  Whatever `git config remote.origin.url` returns.
 * @returns {{owner: string, repo: string}|null}
 */
export function parseGitHubRemote(remote) {
    const m = /github\.com[:/]([^/]+)\/([^/]+?)(\.git)?\/?$/.exec(remote.trim());
    return m ? { owner: m[1], repo: m[2] } : null;
}

async function gitInfo(dir) {
    const opts = { cwd: dir };
    const info = { root: null, remote: null, branch: null };
    try {
        info.root = (await execFileAsync("git", ["rev-parse", "--show-toplevel"], opts)).stdout.trim();
    } catch {
        return info;
    }
    try {
        info.remote = (await execFileAsync("git", ["config", "--get", "remote.origin.url"], opts)).stdout.trim();
    } catch {
        // no "origin" remote configured yet — not an error, just nothing to derive from
    }
    try {
        info.branch = (await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], opts)).stdout.trim();
    } catch {
        // detached HEAD or no commits yet
    }
    return info;
}

export async function run(argv) {
    let parsed;
    try {
        parsed = parseArgs(argv, { flags: { help: "boolean" } });
    } catch (err) {
        if (err instanceof ArgError) { log.error(err.message); return 1; }
        throw err;
    }
    if (parsed.flags.help) { log.raw(HELP); return 0; }

    const dir = path.resolve(parsed.positional[0] ?? ".");
    const core = await loadCore();
    const loaded = await loadSkin(dir, core);

    for (const d of loaded.diagnostics) log.raw(formatDiagnostic(d));
    if (hasErrors(loaded.diagnostics)) {
        log.error("cannot publish: fix the errors above first");
        return 1;
    }

    const files = sourceFiles(loaded);
    log.info("Files that would be published:");
    for (const f of files) log.raw(`  ${f}`);

    const info = await gitInfo(dir);
    const expectedUpdateURL = deriveUpdateURL(info, loaded.mainPath);

    let ok = true;
    if (!info.root) {
        log.warn("not inside a git repository — cannot derive a GitHub URL");
    } else if (!info.remote) {
        log.warn('no "origin" remote configured — add one before publishing');
    } else if (!expectedUpdateURL) {
        log.warn(`origin remote (${info.remote}) does not look like a GitHub URL`);
    } else if (!loaded.updateURL) {
        ok = false;
        log.error(`missing "updateURL" — without it this skin can never offer an update once installed. It should be:\n           ${expectedUpdateURL}`);
    } else if (loaded.updateURL !== expectedUpdateURL) {
        ok = false;
        log.error(`"updateURL" points somewhere other than this repo:\n           has:      ${loaded.updateURL}\n           expected: ${expectedUpdateURL}`);
    } else {
        log.ok(`updateURL is correct: ${loaded.updateURL}`);
    }

    const addTarget = path.relative(process.cwd(), dir) || ".";
    log.raw("");
    log.info("To publish:");
    log.raw(`  git add ${addTarget}`);
    log.raw(`  git commit -m "${loaded.name ?? "skin"}: ${loaded.version ?? "0.0.0"}"`);
    log.raw("  git push");

    if (expectedUpdateURL) {
        log.raw("");
        log.info("Install URL for your README:");
        log.raw(`  ${expectedUpdateURL}`);
    }

    return ok ? 0 : 1;
}

function deriveUpdateURL(info, mainPath) {
    if (!info.root || !info.remote) return null;
    const gh = parseGitHubRemote(info.remote);
    if (!gh) return null;
    const relFromRoot = path.relative(info.root, mainPath).split(path.sep).join("/");
    const branch = info.branch || "main";
    return `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${branch}/${relFromRoot}`;
}
