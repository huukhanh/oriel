---
name: extension-injection
description: The measured, counter-intuitive rules about getting CSS and JavaScript onto someone else's page from a browser extension — content-script CSP, world isolation, single-page navigation, stylesheet injection under a strict style-src, and where Safari differs. Read this before writing or reviewing anything under extension/src/content/, extension/src/background/, or anything touching how a skin reaches a page. Trigger it whenever a task mentions injection, content scripts, CSP, run-at timing, SPA route changes, userScripts, or a skin not applying. These rules are not derivable from the docs and re-deriving them from first principles produces wrong code that looks right.
---

# Getting a skin onto a page

Everything here was measured in a real browser on this project, most of it after
writing the obvious version first and watching it fail. The obvious version
fails *quietly* in every case below, which is why this file exists.

## 1. A content script cannot evaluate a string on Chromium

The extension's own Content-Security-Policy applies to the isolated world.
`eval("1+1")` and `new Function("return 1")` both throw:

> Evaluating a string as JavaScript violates the following Content Security
> Policy directive…

**Independent of the page's CSP** — it happens on a page with no CSP at all.
Measured on a plain page and on one sending `script-src 'self'`.

So skin JavaScript has no single mechanism. `background/caps.js` probes and
picks:

| Mechanism | Where |
|---|---|
| `chrome.userScripts` | Chromium, *and only after the user flips a per-extension switch no automated test can flip* |
| `new Function` in the isolated world | engines that do not apply the extension CSP there |
| nothing — declarative only | everywhere else, said plainly in the UI |

Safari's position is unverified. Do not assume either way; the Capabilities
panel reports what was actually measured on the device.

**Consequence for design:** anything a skin must be able to do has to be
expressible in CSS or DOM operations. JavaScript is a bonus, never a
foundation. If you find yourself putting load-bearing structure in skin JS,
stop.

## 2. `history.pushState` cannot be patched from a content script

The isolated world has its own global scope. The `pushState` a content script
replaces is not the one the page calls. The patch installs cleanly, the page
navigates, and nothing fires.

This is the single most convincing wrong-looking-right bug in the codebase — a
skin came off the applied list and stayed on the page.

Route changes need all three of:

- `popstate` and `hashchange` — real events, they cross worlds;
- `webNavigation.onHistoryStateUpdated` from the background, where it exists;
- **a poll.** Unfashionable, and the only thing that works everywhere. 300ms,
  one string comparison. Do not remove it to be tidy.

Keep the `history` patch anyway: it works for the one caller that shares the
isolated world, a skin's own JavaScript.

## 3. A `<style>` element is blocked by `style-src 'self'`

A stylesheet element inserted by script is subject to the page's `style-src`.
On a site sending `style-src 'self'` it does nothing. Measured in both WebKit
and Chromium.

A **constructed stylesheet** adopted by the document is not:

```js
const sheet = new CSSStyleSheet();
sheet.replaceSync(css);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
```

Preference order in `content/styles.js`, and the reason for each:

1. `scripting.insertCSS` from the background — belongs to the browser, a page
   cannot see or remove it.
2. A constructed stylesheet — no DOM node, and unaffected by `style-src`.
3. A `<style>` element — only for engines with no constructable stylesheets,
   and it needs a MutationObserver to survive a framework rewriting `<head>`.

Two traps in the removal path:

- **`removeCSS` matches on the exact text that was inserted.** A byte of drift
  and the stylesheet stays on the page forever. This killed an early-CSS-push
  optimisation: the background sent one concatenated sheet, the content script
  sent one per sheet, and nothing could remove what the background inserted.
- **Track sheet ownership explicitly.** Inferring "ours" from what is still
  held means a sheet being removed reads as the page's own and is kept.

## 4. `document_start` is earlier than you think

A content script at `document_start` is specified to run after the root element
exists. Scripts injected by other means are not: in WebKit, a script at the
earliest possible moment sees `document.documentElement === null`. Anything that
appends to the document has to cope, and `document` itself can be observed
before it has children.

## 5. Match patterns

- `*` as a scheme means `http` or `https` **only** — not `file`, not `ftp`.
- `*.example.com` matches `example.com` *and* every subdomain.
- The path is required and is matched against `pathname + search`; **the
  fragment is stripped first**. A pattern containing `#` can never match.
- Ports are Chrome-only and Firefox ignores them — reject them rather than
  matching different pages on different browsers.

Over-matching is the security bug in this product. `*://*.example.com/*` must
not match `https://evil.com/?q=example.com`, `https://notexample.com/`, or
`https://example.com.evil.com/`. The tests for this are not decorative; they are
mutation-checked.

## 6. The background context is not alive between two messages

Safari evicts it aggressively. Every exchange in `shared/protocol.js` is
self-contained, and nothing survives in a module-level variable that could not
be rebuilt from storage. Caches are fine; *state* is not.

Two follow-ons: every UI request needs a timeout, because a request to a dead
worker never settles and users report that as a freeze; and update checks run
when a UI page opens rather than from a timer, because there is no dependable
background scheduling on iOS.

## 7. Where to put logic

`extension/src/core/` is pure — no `chrome.*`, no `browser.*`, no `window`, no
`fetch`; `scripts/lint.mjs` fails the build otherwise. Modules that need a DOM
take one as an argument. That is the whole reason most of this product is
testable on a machine with no browser, and the pressure to keep it that way is
worth applying hard: when a task looks like plumbing, find the provable kernel
and move it into `core/`.

| Task as stated | Provable kernel |
|---|---|
| "Apply matching skins on navigation" | `skinsForUrl` over pure `matchesTargets` |
| "Install from a GitHub link" | `resolveLocator` → an ordered candidate list; the fetch is the caller's |
| "Restructure the page" | `applyOps(ops, { document })`, with an undo journal |
| "Run the skin's code" | the generated wrapper source, asserted as text *and* executed |

## 8. Verification, in order of what it can prove

- **Node** — all of `core/`, plus anything that takes its DOM as an argument.
- **Chromium with the extension loaded** — the only engine on Linux that can.
  Manifest, service worker, content script, message router.
- **WebKit** — same JavaScriptCore and WebCore as Safari on iOS. Cannot load an
  extension; take the modules directly instead. This is where engine-level
  claims get settled.
- **A phone** — everything about Safari's own extension host. Nothing else can
  touch it. See `docs/VERIFICATION.md`.

Never let "CI is green" stand in for "it works on Safari". On this project those
are unrelated claims.
