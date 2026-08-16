# What is proven, and what is not

This project is developed on a headless Linux box. There is no Mac, no iPhone,
and no Safari anywhere in the loop — and Safari on iOS is the browser Oriel is
aimed at. That gap is the central fact about this codebase, and most of its
design follows from it.

The response is not optimism. It is to push as much of the product as possible
into places that *can* be checked here, and then to be exact about the part that
cannot.

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

### 2. Chromium — the extension

Chromium is the only engine on this machine that can load a WebExtension, so it
is where the parts that are not logic get proven. `e2e/extension.e2e.test.js`
builds `dist/chrome`, loads it, and drives it through the real message protocol
from a real extension page:

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

**The Swift.** `apple/` cannot be compiled here. It is kept as small as it can
possibly be for exactly that reason: one view, one row, one handler that does
nothing. The CI job in `.github/workflows/apple.yml` is the first thing that has
ever compiled it, and it also checks that the built extension actually landed
inside the `.appex` — because an extension bundle missing its `manifest.json`
installs fine and then does nothing at all.

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

1. Does the extension appear in Settings, and does granting site access work?
2. Does the capability line say JavaScript runs, or that it is suspended?
3. Does a skin apply before the page paints, or is there a visible flash?
4. Is the manager usable with a thumb, and does the editor work with the iOS
   keyboard covering half the screen?
5. Does the background context survive long enough for an import from GitHub to
   finish?

Each of those changes a design decision. Anything that does not is not worth a
build cycle.
