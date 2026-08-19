# Where the project stands

Working branch: `feat/63-browser-shell` ([PR #63](https://github.com/huukhanh/oriel/pull/63)).
`main` holds the extension version.

## What Oriel is

A **browser for iOS and macOS** that stores and applies **skins** — packages of
CSS, declarative layout operations and JavaScript that completely change a
website's interface.
Installed by pasting a file or giving a GitHub link; authored on a desktop with
`tools/oriel`; published to GitHub like any other file.

It is a browser rather than an extension because an extension cannot reliably
run a skin's JavaScript, cannot see the page's own navigation, and cannot touch
the browser's own interface —
[decision 001](decisions/001-browser-not-extension.md).

Two documents are normative: [`SKIN-FORMAT.md`](SKIN-FORMAT.md) for what a skin
*is*, [`BROWSER-API.md`](BROWSER-API.md) for what it can *do*.

## Proven

```
lint clean · 767 unit tests · 26 end-to-end tests in real browsers
```

| Piece | State |
|---|---|
| `engine/core/` | Targeting (235), layout operations (81), UserCSS + variables (93), userscripts (52), sources + versions (84), the skin funnel (41), the wrapper (15). Pure, and lint-enforced pure. |
| `engine/host/` | The seam a shell must satisfy, plus a recording test host. 24 tests. |
| `engine/runtime/` | The in-page engine. **Still speaks the extension's message protocol** — see below. |
| `hosts/apple/` | The native bridge: wire format, both WebKit reply mechanisms, timeouts. 19 tests. |
| `hosts/extension/` | Demoted to a test host. The only way to run the engine in a real browser here. |
| `browser/ui/` | Manager and popup, as pure render functions. 73 tests. |
| `browser/chrome/` | The browser's own interface, as a document rather than SwiftUI. |
| `apple/Sources/Browser/` | The Swift shell: tabs, web views, the bridge. One source set; UIKit and AppKit branches, both typechecked. **Builds for iOS and macOS against the real SDKs.** |
| `tools/oriel` | The authoring CLI. 26 tests. |
| `skins/` | Three worked examples, installed by the e2e suite. |

## What running it in real browsers changed

Six things that would otherwise have shipped looking correct, and are the reason
the e2e suites exist:

1. **Chromium blocks `eval` in content scripts** — which is most of why Oriel is
   now a browser.
2. **A `<style>` element is blocked by `style-src 'self'`;** a constructed
   stylesheet is not.
3. **A content script cannot see the page's own `pushState`** — separate worlds.
4. **The early CSS push could never be undone**, because `removeCSS` matches on
   exact text.
5. **Adopted-sheet removal mistook its own sheet for the page's.**
6. A stylesheet has to survive a document with **no root element yet**.

## Next, in order

1. **Wire `engine/runtime` to the Host.** It still talks to the extension's
   message protocol, so the browser cannot run the engine yet —
   `hosts/apple/main.js` establishes the bridge and stops at an honest line. This
   is the piece between here and a browser that actually skins a page.
2. **Close the remaining Apple TODOs.** A transparent chrome web view on macOS
   (`NSView.isOpaque` is get-only and the honest alternative was not certain
   enough to guess), and the handful of `TODO(api:)` namespaces in
   `Bridge.swift` that still answer `unsupported`.
3. **A device test.** [#61](https://github.com/huukhanh/oriel/issues/61) is
   written for the extension build and needs rewriting. The question that
   matters most is now different: an extension had to ask whether skin
   JavaScript runs at all; a browser is supposed to guarantee it, and if it does
   not then decision 001's premise is wrong.

## Smaller gaps

- No test for the background's storage layer.
- `oriel check <gallery-dir>` does not recognise an `index.json`.
- The manager's editor is a textarea with a line number, nothing cleverer.
