# 1. Oriel is a browser, not an extension

**Status:** accepted, 2026-08-16. Supersedes the extension shell shipped in #60.

## The decision

Oriel is a **browser**. Skins customise the pages it loads *and the browser
itself*, and the browser exports a native API that skins call. The WebExtension
build is demoted from "the product" to "a test host" — see
[Keeping the extension](#keeping-the-extension-as-a-test-host).

## Why

An extension is a guest on someone else's runtime, and the ceiling that imposes
turned out to be the whole problem. Three findings from building the extension
version, all measured rather than assumed:

1. **A skin's JavaScript may simply not run.** Chromium applies the extension's
   own Content-Security-Policy to content scripts, so `eval` and `new Function`
   throw there — independent of the page. The only way back in is the
   `userScripts` API, hidden behind a switch the user must find. Safari's
   position was never established. So the format had to treat its most powerful
   feature as optional, and `background/caps.js` exists to explain to users why
   the thing they installed does nothing.
2. **A content script cannot see the page's own `pushState`.** Separate worlds.
   The workaround is a poll.
3. **The browser's own interface is off limits.** An extension can restyle a
   page; it cannot change the tab strip, the address bar, or what happens when
   you long-press a link. "Change a website's UI/UX completely" stops at the
   edge of the content area, and that edge is where a lot of the experience is.

Owning the browser removes all three. We own the web view, so injected code runs
with no extension CSP and correct `document_start` timing. We own the chrome, so
it is skinnable like anything else. And we can expose capabilities no extension
API offers.

## What this does not change

**The engine survives intact.** Targeting, the four parsers, the layout
operation engine, variables, the GitHub resolver, the skin funnel, the wrapper —
around 700 tests' worth — are pure JavaScript that never depended on being in an
extension. `docs/SKIN-FORMAT.md` stands unchanged except for the parts that
apologised for JavaScript being unavailable.

What is replaced is the *shell*: the manifest, the service worker, the content
script's message plumbing, and the capability probe that existed to explain a
restriction we no longer have.

## The shape

```
engine/          Host-agnostic. The skin engine and the in-page runtime.
  core/            Pure logic. Unchanged.
  runtime/         Applies skins to a document; exposes `oriel` to skin JS.
  host/            The Host contract — what a shell must provide.
hosts/
  ios/             The browser. Swift, WKWebView, tabs, chrome.
  extension/       A WebExtension shell, kept only so the engine can be
                   end-to-end tested in a real browser on Linux.
  test/            An in-process host for unit tests.
browser/         The browser's own interface — itself skinnable.
```

A **Host** is the seam. It provides storage, network, tabs, chrome and native
capability; the engine provides skinning. Anything the engine can do through the
Host contract can be tested against the test host in Node, which is how a
browser written in Swift stays verifiable from a Linux box.

## Keeping the extension as a test host

Chromium is the only engine on this machine that can load a WebExtension, and
that is the only way to run the engine inside a real browser here. Deleting the
extension shell would delete the end-to-end suite with it.

So it stays, clearly labelled: `hosts/extension/` is a **test host and a
convenience for desktop authoring**, not a shipping product. It is allowed to be
less capable than the browser — where the engine asks the Host for something an
extension cannot do, the extension host says so and the tests assert that path.

## What it costs

The browser shell is Swift, and there is no Swift toolchain, no Xcode and no
device in this project's development loop. That is a real and permanent
reduction in what can be proven, and it is why the Host contract is drawn where
it is: the Swift side should be a transport, with every decision on the
JavaScript side of the seam where it can be tested.

The honest summary of the trade: an extension is more verifiable and cannot do
the job; a browser can do the job and shifts more of the risk onto a person with
a phone. `docs/VERIFICATION.md` tracks where that line falls.
