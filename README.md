# Oriel

**Rebuild any website's interface, and share the result as a file on GitHub.**

Oriel is a **browser for iOS and macOS** that stores and applies **skins** —
packages of CSS, declarative layout operations and JavaScript that change a
site's interface completely. Not a dark mode. A different front end for someone
else's website.

It is a browser rather than an extension because an extension is a guest: it
cannot reliably run a skin's JavaScript, cannot see the page's own navigation,
and cannot touch the browser's own interface. Oriel's tab strip, address bar and
toolbar are documents, skinnable like any other — and it exports a native API so
a skin can manage tabs, intercept requests, reach the device, and publish
functions for other skins to call.

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

Building it as an extension first was worth doing and is why the engine is well
tested — but it hit a ceiling that could not be worked around, and
[decision 001](docs/decisions/001-browser-not-extension.md) records exactly
where and why.

## What a skin can do

| | |
|---|---|
| **CSS** | Restyle and relayout, injected before first paint, unaffected by the page's own Content-Security-Policy. |
| **Layout operations** | Move a node into another parent, wrap it, delete it, re-order children, rewrite text. Declarative JSON, interpreted by Oriel, so it needs no code execution at all. |
| **JavaScript** | Always available in the browser, with an API for the things every skin needs. |
| **The browser itself** | Tabs, the toolbar, the address bar, context menus, gestures — see [`docs/BROWSER-API.md`](docs/BROWSER-API.md). |
| **Requests** | Block, redirect, rewrite headers, or answer a request outright. |
| **Other skins** | A skin can export functions for other skins to import, so a reader-mode skin's extractor is reusable without either author coordinating. |
| **Settings** | A skin declares its variables; Oriel generates the settings UI and applies changes to the open page live. |

The full contract is [`docs/SKIN-FORMAT.md`](docs/SKIN-FORMAT.md).

## Install it

Oriel is a browser for **iPhone, iPad and Mac** — one app, one engine, the same
skins on both. It is not in any app store; you build it, or you sign a build
with your own Apple ID. [`docs/INSTALL.md`](docs/INSTALL.md) is the full path,
including what to do when something fails.

**On a Mac** — build and run it. macOS 13 or later.

```sh
pnpm install && pnpm build
brew install xcodegen && cd apple && xcodegen generate && open Oriel.xcodeproj
```

**On an iPhone or iPad** — the same project, or take the unsigned `.ipa` CI
builds on every tagged release and sign it yourself, so no Mac is needed.
iOS 16.4 or later.

<details>
<summary>There is also a WebExtension build. It is not the product.</summary>

The same engine builds as a WebExtension, because that is the only way to run it
inside a real browser on a Linux machine — which is what the end-to-end suite
does. It is also a fast way to iterate on a skin's CSS from a desktop. It cannot
do what the browser can: no tabs API of its own, no browser chrome, and Chromium
will not run a skin's JavaScript at all.

- Chromium: `chrome://extensions` → Developer mode → *Load unpacked* → `dist/chrome`
- Firefox: `about:debugging` → *This Firefox* → *Load Temporary Add-on* → `dist/firefox/manifest.json`

</details>

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
engine/      The skin engine. `core/` is pure logic with no browser APIs — that is
             what makes most of this provable without a browser at all. `runtime/`
             applies skins to a document and exposes `oriel` to skin JS.
hosts/       Where a runtime plugs in. `extension/` is a WebExtension shell, kept
             as a test host so the engine can be exercised in a real browser here.
browser/     The browser's own interface — itself skinnable. `ui/` is the popup
             and manager.
assets/      Icons, shared across hosts.
tools/oriel/ The authoring CLI: scaffold, live-reload dev server, validate, bundle.
skins/       Worked examples, and the gallery format.
test/        Unit tests.
e2e/         Playwright: the built extension in Chromium, the engine in WebKit.
apple/       The Safari Web Extension container app for iOS and macOS.
docs/        The skin format, authoring guide, and what is and is not verified.
```

## Licence

MIT.
