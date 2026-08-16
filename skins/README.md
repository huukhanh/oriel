# Oriel skin gallery

Example and starter skins for [Oriel](https://github.com/huukhanh/oriel). Each
one is a real, working skin — read one to learn the format, or use `oriel
init` to start your own from scratch.

| Skin | Format | What it shows |
|---|---|---|
| [`hn-rebuilt`](hn-rebuilt) | bundle (`skin.json`) | A full redesign: CSS + six kinds of DOM op + vars driving a colour system |
| [`reader`](reader) | UserCSS (`*.user.css`) | Multiple `@-moz-document` sections, a multi-line `@var select` |
| [`dim`](dim) | UserCSS (`*.user.css`) | The smallest possible skin — read this one first |

The format itself is normative in [`../docs/SKIN-FORMAT.md`](../docs/SKIN-FORMAT.md).

## Installing one

Paste the skin's `install` URL (below, or in [`index.json`](index.json)) into
Oriel's "Add skin" screen, or give Oriel the GitHub page URL directly — it
resolves to the same raw file.

- Hacker News, rebuilt: `https://raw.githubusercontent.com/huukhanh/oriel/main/skins/hn-rebuilt/skin.json`
- Reader mode: `https://raw.githubusercontent.com/huukhanh/oriel/main/skins/reader/reader.user.css`
- Dim everything: `https://raw.githubusercontent.com/huukhanh/oriel/main/skins/dim/dim.user.css`

## Adding a skin to this gallery

1. Write it — `npx oriel init skins/<your-skin>` scaffolds one, or copy the
   closest existing example.
2. `npx oriel check skins/<your-skin>` until it's clean.
3. Add an entry to [`index.json`](index.json):

   ```json
   {
     "id": "your-skin",
     "name": "Human-readable name",
     "description": "One sentence.",
     "author": "you",
     "path": "skins/your-skin/skin.json",
     "install": "https://raw.githubusercontent.com/huukhanh/oriel/main/skins/your-skin/skin.json",
     "matches": ["*://example.com/*"],
     "tags": ["a-few", "short", "tags"]
   }
   ```

4. `path` is relative to the repository root and names the skin's entry file
   itself — `skin.json` for a bundle, the `*.user.css` file for UserCSS —
   not its directory. `install` is that same file's raw URL on the `main`
   branch — the same URL a user would paste into Oriel. The two must agree;
   `npx oriel check skins/index.json` verifies it, along with `updateURL`
   inside the skin matching (`npx oriel publish skins/<your-skin>` prints
   that check too).
5. Open a PR. CI runs `oriel check` over every skin in this directory.
