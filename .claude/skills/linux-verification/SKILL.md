---
name: linux-verification
description: What can actually be proven on the headless Linux dev box — Node unit tests for all pure logic, the built extension in a real Chromium, the injection engine in a real WebKit, and the lint rule that keeps the core testable. Use this before opening any PR, when adding logic that could be tested, when deciding where a piece of code belongs, and whenever setting up or fixing CI. Trigger it any time you are about to claim something works — it defines the difference between "tested" and "assumed" on this project.
---

# Verification on a machine with no Safari

Three things run here. Everything provable has to be pushed into one of them.

```
pnpm lint       # node --check on every file, plus the core purity rule
pnpm test       # Node + jsdom, milliseconds
pnpm build      # dist/{chrome,firefox,safari}
pnpm test:e2e   # real Chromium with the extension loaded, and real WebKit
```

## Layout

```
extension/src/core/       Pure. No chrome.*, browser.*, window, localStorage, fetch.
extension/src/shared/     The message protocol and the API shim. Touches chrome.*.
extension/src/background/ Service worker. Not directly testable; keep it thin.
extension/src/content/    The engine. Takes its document as an argument where it can.
extension/src/ui/         views.js and varsform.js are pure functions of data → DOM.
tools/oriel/              The authoring CLI. Zero dependencies, imports core/ for real.
test/                     vitest. Everything above except background/.
e2e/                      Playwright. The built extension, and the engine.
apple/                    Unbuildable here. Three short Swift files, and that is the point.
```

## The purity rule is load-bearing

`scripts/lint.mjs` fails the build if anything in `core/` touches `chrome.*`,
`browser.*`, `window.*`, `localStorage` or `fetch(`. That single rule is why the
targeting engine, four parsers, the layout engine, the variable system and the
GitHub resolver are all testable in Node — which is most of the product and
nearly all of the subtle part.

`document` is allowed, because core modules take one as an argument. Keep that
convention; it is what lets `domops.js` be tested in jsdom and run in a content
script unchanged.

**When a task looks like plumbing, find the provable kernel and move it.** If a
PR contains engine code and no test changes, ask what was missed.

## The two e2e suites, and why there are two

**Chromium** is the only engine on Linux that can load a WebExtension. It proves
the manifest parses, the service worker boots, the content script runs at
`document_start`, and the message router answers — driven through a real
extension page rather than by reaching into the worker, so an unreachable
handler fails.

**WebKit** shares JavaScriptCore and WebCore with Safari on iOS. It cannot load
an extension, so `bundleForBrowser()` bundles the modules and hangs them off a
global. This is where engine-level claims get settled: the HTML parser the
sanitizer faces, the URL parser matching faces, real `requestAnimationFrame`,
real CSP.

Neither is Safari. `docs/VERIFICATION.md` says what that leaves.

## Three environment traps, each of which names nothing when it bites

This box has no root. `scripts/setup-browsers-linux.sh` stages browser
dependencies into `~/.local/pwdeps`, and `e2e/harness.js` puts them on the
loader path automatically — nothing needs sourcing. But:

- **Extensions need `channel: "chromium"`.** Playwright's headless default is
  `chrome-headless-shell`, which has no extension support at all. The symptom is
  a service worker that never appears.
- **WebKit needs Mesa pointed at the staged prefix** — `LIBGL_DRIVERS_PATH` and
  `__EGL_VENDOR_LIBRARY_DIRS`, not just `WEBKIT_DISABLE_DMABUF_RENDERER`.
  Otherwise "Could not create WPE EGL display" and the web process dies.
- **With no fonts installed, Chromium loads a page and then closes it** a second
  later while shaping text. No crash event, no console error — the test sees
  only "Target page, context or browser has been closed". `stageFonts()` points
  fontconfig at the staged fonts.

## Writing tests that are worth their place

- Table-drive the security boundary. `target.js` has 235 tests because
  over-matching ships a stranger's CSS onto a page the user never authorised.
- Assert the *undo*, not just the change. Every layout operation is tested by
  applying it and then asserting `document.body.innerHTML` is byte-identical.
- Prove a test is not vacuous. Mutate the implementation and check the test
  fails; several tests here were verified that way and the practice caught a
  dedupe that was doing nothing.
- Test the path the e2e suite *cannot* reach. Chromium always takes the
  browser-injection path, so the constructed-stylesheet and `<style>` fallbacks
  — the ones Safari will use — are only ever covered by unit tests.

## Reporting

State both halves, always:

```
Proven:     lint clean · 724 unit · 24 e2e (chromium + webkit)
Not proven: everything under apple/, and everything about Safari's extension host
```

Never let "CI is green" stand in for "it works". On this project those are
unrelated claims, and the user is relying on you not to blur them.
