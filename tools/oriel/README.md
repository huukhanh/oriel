# oriel-cli

Author, preview, and publish [Oriel](https://github.com/huukhanh/oriel) skins
from a desktop. Zero dependencies — it runs anywhere `npx` does.

```
npx oriel init my-skin
cd my-skin
npx oriel dev
```

Paste the printed URL into Oriel's "Add skin" screen. Every save re-validates
and reloads it.

## Commands

### `oriel init [dir] [options]`

Scaffold a new skin.

```
--name "<label>"           Skin name (default: the directory name)
--match "*://x.com/*"      Match pattern for the target site (default: *://example.com/*)
--format usercss|bundle    Which template to write (default: usercss)
--force                    Write into a non-empty directory anyway
```

`usercss` writes a single `*.user.css` file. `bundle` writes a `skin.json`
plus `style.css`, `layout.dom.json` and `enhance.js` — reach for it when you
need DOM operations or JavaScript. Both templates visibly do something the
moment they're installed, and both come with a `README.md` and `.gitignore`.

### `oriel dev [dir] [options]`

```
--port <n>   Port to listen on (default 7373)
--open       Open the status page in the default browser
```

Serves the skin in `[dir]` on `127.0.0.1:<port>`:

- `GET /skin.json` — the skin, bundled and fully inlined, exactly as the
  extension would fetch it.
- `GET /version` — `{"rev": <n>}`, incremented on every change. Paste
  `http://127.0.0.1:<port>/skin.json` into Oriel and it polls this.
- `GET /` — a status page: name, targets, the install URL, and any
  validation errors. Auto-refreshes.

Watches the directory (`fs.watch`, falling back to a stat poll on
filesystems that don't support recursive watching) and re-validates on every
change, debounced 100ms. A syntax error never takes the server down — it's
printed, and the last good version keeps being served, marked stale on the
status page, until the fix lands.

### `oriel check [path...] [--json]`

Validates one or more skins (a directory, a `skin.json`, or a `*.user.css`
file) and exits non-zero if any has an error. Defaults to the current
directory. Prints one `path:line: message` per problem; pass `--json` for
structured output instead.

Catches: a missing name; missing or empty targets; a target rule that won't
compile; an unknown DOM op or one missing a required field; an unknown var
type or a default outside its own min/max; a `js` entry with an unknown
`world`; a referenced file that doesn't exist; and CSS referencing a
`/*[[var]]*/` placeholder for a var that isn't declared.

### `oriel bundle [dir] [--out skin.json] [--inline]`

Emits the single self-contained `skin.json` a user can paste, or a repo can
serve raw: every `css`/`dom`/`js` path inlined as text, every asset inlined
as a data URL. Reports the output size and warns above 512KB — a lot to hold
in extension storage on a phone.

### `oriel publish [dir]`

Touches neither the network nor the working tree. Prints the files that
would be published, the `updateURL` the skin should carry (derived from the
`origin` remote and current branch) and whether it's already correct, the
`git add`/`commit`/`push` commands to run, and the finished install URL for
your README.

A skin that ships without a correct `updateURL` can never be offered an
update once installed — this is the check that catches it before you push.

## How validation works

This tool never reimplements Oriel's own rules. `src/core.js` dynamically
imports `engine/core/{target,usercss,domops,vars,types}.js` — the
same modules the extension ships — and only falls back to its own minimal
copy (`src/core-fallback.js`) for whichever of those aren't written yet, with
a one-time warning saying so. As each one lands, this tool starts validating
against it for real, with no code change here required.
