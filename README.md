# Oriel

**Rebuild any website's interface, and share the result as a file on GitHub.**

Oriel is a browser extension that stores and applies **skins** — packages of
CSS, declarative layout operations and optional JavaScript that change a site's
interface completely. Not a dark mode. A different front end for someone else's
website.

Install a skin by pasting it, or by giving Oriel a GitHub link:

```
https://github.com/you/hn-rebuilt/blob/main/hn.user.css
you/hn-rebuilt
```

[![ci](https://github.com/huukhanh/oriel/actions/workflows/ci.yml/badge.svg)](https://github.com/huukhanh/oriel/actions/workflows/ci.yml)

---

## Why it exists

The web is full of sites that are useful and unpleasant to use, and there is
usually nothing you can do about it. Userstyles fix colours. Userscripts can fix
anything but need a desktop, and on a phone they need a browser that does not
exist.

Oriel is the other shape of that idea: **the skin is the unit**, it is a file in
a Git repository, and it works on a phone. Someone who can write CSS can rebuild
a site's interface, commit it, and send you a link.

## What a skin can do

| | |
|---|---|
| **CSS** | Restyle and relayout, injected before first paint, unaffected by the page's own Content-Security-Policy. |
| **Layout operations** | Move a node into another parent, wrap it, delete it, re-order children, rewrite text. Declarative JSON, interpreted by Oriel — so it works even where the browser forbids extensions from running downloaded code. |
| **JavaScript** | The escape hatch, with a small API for the things every skin needs. Runs where the platform permits it; Oriel says plainly when it does not. |
| **Settings** | A skin declares its variables; Oriel generates the settings UI and applies changes to the open page live. |

The full contract is [`docs/SKIN-FORMAT.md`](docs/SKIN-FORMAT.md).

## Install the extension

**Chrome, Edge, Brave, Firefox** — build it and load it unpacked:

```sh
pnpm install && pnpm build
```

- Chromium: `chrome://extensions` → Developer mode → *Load unpacked* → `dist/chrome`
- Firefox: `about:debugging` → *This Firefox* → *Load Temporary Add-on* → `dist/firefox/manifest.json`

**Safari, iPhone and Mac** — see [`docs/SAFARI.md`](docs/SAFARI.md). A Safari
Web Extension ships inside a container app, so this one needs a Mac to sign and
a sideloading step to install. CI builds the unsigned app on every push.

## Write a skin

```sh
npx oriel init my-skin --match "*://news.ycombinator.com/*"
cd my-skin
npx oriel dev            # serves the skin with live reload
```

Paste `http://127.0.0.1:7373/skin.json` into Oriel once. From then on every save
re-applies to the page you are looking at.

When it is good, publish it the way you publish anything:

```sh
npx oriel check          # validate before anyone else has to
npx oriel publish        # prints the git commands and the install URL
git add . && git commit -m "hn: card layout" && git push
```

Your users install it with the GitHub URL. [`docs/AUTHORING.md`](docs/AUTHORING.md)
is the long version, and [`skins/`](skins/) holds worked examples — start with
[`skins/dim`](skins/dim), which is thirty lines.

## Sharing skins

A skin is one file. That is deliberate — it means the whole distribution story
is Git, and no part of it needs Oriel to run a server:

- **One skin** — commit a `*.user.css` or `skin.json`; users paste the file's
  GitHub URL.
- **Many skins** — a directory per site plus an `index.json`; users paste the
  repo URL and Oriel finds them. [`skins/index.json`](skins/index.json) is the
  format.
- **Updates** — put an `@updateURL` in the metadata. Oriel checks it on the
  schedule the user chose, shows a diff, and installs nothing until they say so.

## How it is verified

There is no Mac and no iPhone in this project's development loop, so
verification is unusually load-bearing. Every push runs:

| What | Where |
|---|---|
| Targeting, parsers, layout operations, variables, versioning — unit tests | Node |
| The built extension in a **real Chromium**: service worker, content script, message router, skinning a live page through a strict CSP | Playwright |
| The injection engine in a **real WebKit** — the engine Safari on iOS uses | Playwright |
| All three manifests build and parse | CI |

What that cannot cover — Safari's own extension host, and anything about an
iPhone — is [`docs/VERIFICATION.md`](docs/VERIFICATION.md), which is explicit
about where the evidence stops.

## Repository layout

```
extension/   The extension. `src/core/` is pure logic with no browser APIs — that is
             what makes most of this provable without a browser at all.
tools/oriel/ The authoring CLI: scaffold, live-reload dev server, validate, bundle.
skins/       Worked examples, and the gallery format.
test/        Unit tests.
e2e/         Playwright: the built extension in Chromium, the engine in WebKit.
apple/       The Safari Web Extension container app for iOS and macOS.
docs/        The skin format, authoring guide, and what is and is not verified.
```

## Licence

MIT.
