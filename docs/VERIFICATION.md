# What is proven, and what is not

This project is developed on a headless Linux box. There is no Mac, no iPhone
and no Xcode in the loop — and Oriel is a browser for **iOS and macOS**, so both
of its shipping platforms are ones nobody here can run. That gap is the central
fact about this codebase, and most of its design follows from it.

The gap got wider when Oriel stopped being an extension
([decision 001](decisions/001-browser-not-extension.md)): an extension is mostly
JavaScript and mostly testable, while a browser has a native shell that is
neither. The response was to draw the seam — `engine/host/contract.js` — so that
the untestable half is a transport and every decision sits on the side that can
be tested.

The response is not optimism. It is to push as much of the product as possible
into places that *can* be checked here, and then to be exact about the part that
cannot. There **is** a Swift compiler on the box, and it does more than it
sounds like it should: `swift build --package-path apple` typechecks the real
browser sources against stub frameworks, on both the UIKit and the AppKit
branch. What it cannot do is confirm those stubs describe Apple's actual API.

## Three layers of evidence

### 1. Node — the logic

`engine/core/` is pure: no `chrome.*`, no `browser.*`, no `window`, no
`fetch`. `scripts/lint.mjs` fails the build if any of those appear there. Modules
that need a DOM take one as an argument; modules that need the network take a
URL and hand back a list of candidates for someone else to fetch.

That constraint is what makes the interesting half of the product testable
without a browser at all:

| Module | What the tests settle |
|---|---|
| `target.js` | URL matching, including the over-matching cases that would leak a stranger's CSS onto a bank |
| `domops.js` | Every layout operation, and that every one of them undoes back to a byte-identical DOM |
| `usercss.js`, `userscript.js` | Parsing other people's published styles and scripts without silently mangling them |
| `vars.js` | Variable declarations, coercion, substitution |
| `source.js`, `version.js` | Turning a pasted GitHub link into fetchable URLs; deciding what counts as newer |
| `skin.js` | Four input formats reducing to one internal shape |
| `wrapper.js` | The source generated for the user-script world |

This is the majority of the code and nearly all of the code that is subtle.

### 2. Chromium — the engine inside a real browser

Chromium is the only engine on this machine that can load a WebExtension. That
is why the extension build survives the pivot to a browser: demoted to a test
host, it remains the only way to run the whole engine inside a real browser
here. `e2e/extension.e2e.test.js` builds `dist/chrome`, loads it, and drives it
through the real message protocol from a real extension page:

- the manifest parses and the service worker boots;
- the content script runs at `document_start` on a real HTTP page;
- a pasted UserCSS skin installs and restyles the page;
- it still restyles a page served with `script-src 'self'; style-src 'self'` —
  the CSP case that breaks naive injection;
- declarative layout operations restructure the DOM with no page JavaScript;
- a variable change reaches an already-open page without a reload;
- disabling a skin removes it completely;
- a single-page route change removes a skin that stopped matching and restores
  it when it matches again;
- `history.pushState` is patched exactly once regardless of how many skins load;
- installing from a URL records where it came from, with a digest.

### 3. WebKit — the engine Safari uses

Playwright ships the WPE/GTK port of WebKit, which shares JavaScriptCore and
WebCore with Safari. It cannot load an extension, but it can run the injection
engine as a plain script, which settles timing, CSP behaviour and history
interception on the engine that matters — none of which jsdom can model.

## What none of that covers

**Safari's extension host.** WebKit the engine is not Safari the browser. The
permission model, the popup, the options page, the storage quota, how quickly
the background context is evicted, and whether `scripting.insertCSS` behaves the
same — all of that is Safari's own layer, and nothing here touches it.

**iOS.** Enabling an extension, granting per-site access, the page menu, and
whether any of it is usable one-handed.

**The Swift, but less than before.** `apple/` cannot be *built* here — there is
no iOS or macOS SDK — but it is typechecked on both platform branches on every
push, and `apple.yml` builds both for real on a macOS runner.

The division of labour is worth stating, because a green typecheck is easy to
over-read. The harness catches internal inconsistency and anything that
contradicts what the stubs claim. The real SDK catches what the stubs claim
*wrongly* — which has happened once: `allowsInlineMediaPlayback` is iOS-only,
the stub declared it for both, and a macOS runner found it. The stub is now
platform-conditional and reproduces that error locally in under a second.

The original point stands: `.github/workflows/apple.yml`
is the first thing that ever does, and it also asserts that the built web
extension landed inside the `.appex` — because a bundle missing its
`manifest.json` installs fine and then does nothing at all.

The browser shell makes this the largest unverified surface in the project, and
two decisions exist to keep it small. The browser's own interface — tab strip,
address bar, toolbar — is **a document, not SwiftUI**, so it is tested in jsdom
like any other UI. And the native side is a transport behind
`engine/host/contract.js`, whose rule that a declared capability must have an
implementation is checked in Node against every host profile. What is left in
Swift is a window, a web view per tab, and a message handler.

## The one platform fact that was measured rather than assumed

**Chromium blocks `eval` and `new Function` inside content scripts.** The
extension's own Content-Security-Policy applies to the isolated world,
independent of the page's. This was verified with a throwaway extension in real
Chromium, on a plain page and on one sending `script-src 'self'`; both throw
"Evaluating a string as JavaScript violates the following Content Security
Policy directive".

That is why skin JavaScript has a layered strategy rather than one mechanism,
why `background/caps.js` probes instead of assuming, and why the Chromium E2E
suite asserts `caps.js === "none"` on purpose. Chromium hides
`chrome.userScripts` behind a per-extension switch that no automated test can
flip, so the honest result there is "JavaScript suspended, CSS and layout still
work" — and the UI says so rather than failing silently.

**Safari's behaviour here is unknown and matters.** If Safari permits `new
Function` in a content script, skin JavaScript works there with no further work.
If it does not, and it has no `userScripts` API either, then skins on iOS are
CSS and declarative layout only — still the large majority of what the format
can express, but a real limit that should be documented rather than discovered.
This is the first question any device test should answer; Settings → Capabilities
in the extension reports it in one line.

## What a device test is for

Not "does it work" — the parts that can be checked are checked. A device session
should answer the things that are structurally unknowable from here:

1. Does the app launch, and does the first tab load a page?
2. Does a skin apply before the page paints, or is there a visible flash?
3. **Does a skin's JavaScript run?** The browser is supposed to make this
   unconditional — no extension CSP, no permission switch. If it does not, the
   premise of decision 001 is wrong and needs revisiting immediately.
4. Does the native bridge answer? Every `tabs` call crosses into Swift, and a
   silent bridge is the failure mode the timeout in `hosts/apple/bridge.js` exists
   to make visible rather than fix.
5. Is the chrome usable one-handed — tab strip scrolling, the address bar with
   the keyboard up, reachability of the toolbar on a large phone?
6. Does a skin that restyles the browser's own interface actually change it?
   That is the claim the whole pivot rests on.

Each of those changes a design decision. Anything that does not is not worth a
build cycle.
