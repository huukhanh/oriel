/**
 * Scaffolds a new skin that visibly does something on its target site — a
 * blank stylesheet teaches nothing. Two templates: a single `*.user.css`
 * (the default, and the format most authors want) or a `skin.json` bundle
 * with `style.css` + `layout.dom.json` + `enhance.js`.
 *
 * @module commands/init
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, ArgError } from "../args.js";
import { log } from "../log.js";

const HELP = `oriel init [dir] [options]

Scaffold a new skin.

  --name "<label>"           Skin name (default: the directory name)
  --match "*://x.com/*"      Match pattern for the target site (default: *://example.com/*)
  --format usercss|bundle    Which template to write (default: usercss)
  --force                    Write into a non-empty directory anyway`;

export async function run(argv) {
    let parsed;
    try {
        parsed = parseArgs(argv, {
            flags: { name: "string", match: "string", format: "string", force: "boolean", help: "boolean" }
        });
    } catch (err) {
        if (err instanceof ArgError) { log.error(err.message); return 1; }
        throw err;
    }
    if (parsed.flags.help) { log.raw(HELP); return 0; }

    const format = parsed.flags.format ?? "usercss";
    if (format !== "usercss" && format !== "bundle") {
        log.error(`--format must be "usercss" or "bundle", got "${format}"`);
        return 1;
    }

    const dir = path.resolve(parsed.positional[0] ?? ".");
    const match = parsed.flags.match ?? "*://example.com/*";
    const name = parsed.flags.name ?? deriveName(dir);

    await mkdir(dir, { recursive: true });
    const existing = await readdir(dir);
    if (existing.length && !parsed.flags.force) {
        log.error(`${path.relative(process.cwd(), dir) || "."} is not empty — pass --force to write into it anyway`);
        return 1;
    }

    const files = format === "bundle" ? bundleFiles(name, match) : usercssFiles(name, match);
    for (const [file, content] of Object.entries(files)) {
        const dest = path.join(dir, file);
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, content, "utf8");
    }

    log.ok(`created ${Object.keys(files).length} files in ${path.relative(process.cwd(), dir) || "."}`);
    log.info(`next: cd ${path.relative(process.cwd(), dir) || dir} && npx oriel dev`);
    return 0;
}

function deriveName(dir) {
    const base = path.basename(dir);
    if (!base || base === ".") return "My Skin";
    return base.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "skin";
}

/** Best-effort host for the sample `@-moz-document domain(...)` block. */
function deriveHost(matchPattern) {
    const m = /^[a-zA-Z*]+:\/\/(?:\*\.)?([^/*]+)/.exec(matchPattern);
    if (m && m[1]) return m[1];
    return "example.com";
}

function gitignore() {
    return "node_modules/\n.DS_Store\n";
}

function readme(name, mainFile) {
    return `# ${name}

An [Oriel](https://github.com/huukhanh/oriel) skin.

## Install

Paste this URL into Oriel's "Add skin" screen:

    https://raw.githubusercontent.com/you/${slugify(name)}/main/${mainFile}

(Replace \`you/${slugify(name)}\` with your own GitHub username and repo once you've pushed this.)

## Develop

    npx oriel dev

Open the printed URL, paste it into Oriel, and edit — Oriel picks up every save.

## Check

    npx oriel check
`;
}

function usercssFiles(name, match) {
    const host = deriveHost(match);
    const mainFile = "skin.user.css";
    const css = `/* ==UserStyle==
@name           ${name}
@namespace      github.com/you
@version        0.1.0
@description    A new Oriel skin.
@author         you
@license        MIT
@updateURL      https://raw.githubusercontent.com/you/${slugify(name)}/main/${mainFile}
@preprocessor   default
@var color      accent   "Accent"   #4f8cff
==/UserStyle== */

@-moz-document domain("${host}") {
  :root { --accent: /*[[accent]]*/; }

  /* Replace this with real rules — this one is only here so the skin visibly
     does something the moment it is installed. */
  body { outline: 3px solid var(--accent); outline-offset: -3px; }
}
`;
    return {
        [mainFile]: css,
        "README.md": readme(name, mainFile),
        ".gitignore": gitignore()
    };
}

function bundleFiles(name, match) {
    const id = slugify(name);
    const skinJson = `{
  "$schema": "https://oriel.dev/schema/skin-1.json",
  "format": 1,
  "id": "${id}",
  "name": "${name}",
  "version": "0.1.0",
  "description": "A new Oriel skin.",
  "author": "you",
  "license": "MIT",
  "updateURL": "https://raw.githubusercontent.com/you/${id}/main/skin.json",
  "matches": ["${match}"],
  "css": ["style.css"],
  "dom": "layout.dom.json",
  "js": [{ "file": "enhance.js", "world": "isolated", "runAt": "document_end" }],
  "vars": [
    { "key": "accent", "type": "color", "label": "Accent", "default": "#4f8cff" }
  ]
}
`;
    const styleCss = `:root {
  --accent: #4f8cff; /* overridden live from the "accent" var */
}

/* Replace this with real rules — this one is only here so the skin visibly
   does something the moment it is installed. */
body {
  outline: 3px solid var(--accent);
  outline-offset: -3px;
}
`;
    const domJson = `[
  { "op": "addClass", "select": "body", "class": "oriel-skin-active" }
]
`;
    const enhanceJs = `oriel.log("enhance.js running on", location.hostname);

oriel.watch("body", () => {
  // Runs once now and again for every future match — see docs/SKIN-FORMAT.md §8.1.
});
`;
    return {
        "skin.json": skinJson,
        "style.css": styleCss,
        "layout.dom.json": domJson,
        "enhance.js": enhanceJs,
        "README.md": readme(name, "skin.json"),
        ".gitignore": gitignore()
    };
}
