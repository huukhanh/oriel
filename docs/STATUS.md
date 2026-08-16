# Where the rework stands

Working branch: `feat/rework-extension`. `main` is still the old iOS browser.

## The change in direction

Oriel was a scriptable iOS browser. It is now a **cross-browser extension that
stores and applies skins** — packages that completely change a website's
interface — installed by pasting source or by giving a GitHub link, and authored
on a desktop with a CLI. The old `App/`, `Core/` and `web/` trees are gone.
[`SKIN-FORMAT.md`](SKIN-FORMAT.md) is the contract and is normative.

## Built and proven

```
lint clean · 724 unit tests · 24 end-to-end tests in real browsers
```

| Piece | State |
|---|---|
| `core/target.js` | Six rule kinds, Chrome match patterns. 235 tests, mutation-checked. |
| `core/domops.js` | 15 layout operations, each with an inverse. 81 tests. |
| `core/usercss.js`, `core/vars.js` | Stylus-compatible parsing and variables. 93 tests. |
| `core/userscript.js` | Tampermonkey/Violentmonkey metadata. 52 tests. |
| `core/source.js`, `core/version.js` | GitHub link resolution, loose-semver comparison. 84 tests. |
| `core/skin.js` | The funnel: four input formats in, one `Skin` out. 41 tests. |
| `core/wrapper.js` | Generated source for the user-script world. 15 tests. |
| `background/*` | Store, capability probe, install, updates, apply, router. |
| `content/*` | The engine: stylesheets, the `oriel` API, single-page re-entry. |
| `ui/*` | Popup and manager, as pure render functions. 73 tests. |
| `tools/oriel` | The authoring CLI. 26 tests. |
| `skins/` | Three worked examples, installed by the e2e suite. |
| `apple/` | Container app and Safari Web Extension target, XcodeGen. **Never compiled.** |
| CI | `ci.yml` on every push; `apple.yml` manual and tag-only. |

## What running it in real browsers changed

Six things that would otherwise have shipped looking correct. They are the
argument for the e2e suites existing at all:

1. **Chromium blocks `eval` in content scripts.** Skin JavaScript therefore has
   a layered strategy and a capability probe, not one mechanism.
2. **A `<style>` element is blocked by `style-src 'self'`;** a constructed
   stylesheet is not. The fallback path was rewritten around that.
3. **A content script cannot see the page's own `pushState`** — separate
   worlds. Route changes need events, a background signal and a poll.
4. **The early CSS push could never be undone,** because `removeCSS` matches on
   exact text. Removed.
5. **Adopted-sheet removal mistook its own sheet for the page's** and kept it
   forever.
6. A skin's stylesheet has to survive a document with **no root element yet**.

## Left to do

1. **A device test.** Nothing here can touch Safari, and the open question that
   decides how much of the format works on iOS — whether Safari lets an
   extension run code it downloaded — is one line in the Capabilities panel.
   [`VERIFICATION.md`](VERIFICATION.md#what-a-device-test-is-for) lists what is
   worth a build cycle.
2. **`apple/` has never been compiled.** `apple.yml` is written and has never
   run. Expect the first run to fail on something small.
3. **Smaller gaps.** `oriel check <gallery-dir>` does not recognise an
   `index.json`; there is no test for the background's storage layer; the
   manager's editor is a textarea with a line number rather than anything
   cleverer.
