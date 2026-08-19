# apple/

The iOS side of Oriel: a **browser**, and the Safari Web Extension that is now
kept only as a test host.

`project.yml` is the source of truth. The `.xcodeproj` is generated and not
checked in.

```sh
pnpm install
pnpm build          # must produce dist/apple/ and dist/safari/
cd apple
xcodegen generate
open Oriel.xcodeproj
```

The build **fails loudly** if `dist/apple/engine.js`, `dist/apple/chrome.html` or
`dist/safari/manifest.json` are missing. That is deliberate: an app that builds
without them installs fine and then does nothing, which is a failure you only
discover on a phone.

## What the Swift is, and is not

The browser's own interface — the tab strip, the address bar, the toolbar — is
**HTML, CSS and JavaScript** in `chrome.html`, loaded from the app bundle into
its own `WKWebView`. It is not SwiftUI, and adding a SwiftUI control here is a
mistake, not a shortcut. Two reasons, both load-bearing:

- Oriel's premise is that a skin can restyle the browser itself. That is only
  true while the browser's chrome is a document a skin can reach.
- Swift is the one part of this project nobody in its development loop can
  test. Every control moved out of Swift is a control that gets tested.

So the Swift is a window, a web view per tab, a web view for the chrome, a
message bridge, and tab lifecycle. Nothing else belongs here. See
`docs/decisions/001-browser-not-extension.md` and `.claude/skills/blind-swift/`.

| File | What it is |
|---|---|
| `Sources/Browser/OrielApp.swift` | `@main`. One `WindowGroup` holding `BrowserView`. |
| `Sources/Browser/BrowserView.swift` | The root: the page area above, the chrome document below. Wires the three objects together in `init`. |
| `Sources/Browser/TabStore.swift` | Tabs and every rule about them — insertion order, close-activates-neighbour, restore on launch. The one file here worth reading. |
| `Sources/Browser/Tab.swift` | A tab as a plain `Codable` value. |
| `Sources/Browser/ContentWebView.swift` | `UIViewRepresentable` that swaps the active tab's web view into a container. |
| `Sources/Browser/ChromeWebView.swift` | `UIViewRepresentable` around the chrome document's web view. |
| `Sources/Browser/WebViewFactory.swift` | Builds the shared configuration and the user scripts, owns every web view, and is the navigation delegate. |
| `Sources/Browser/Bridge.swift` | `WKScriptMessageHandler`. The transport under the `ios` host in `engine/host/contract.js`. |
| `Sources/Browser/BridgeCommand.swift` | The wire format, both directions. |
| `Package.swift`, `Harness/` | A typecheck harness: stub frameworks that let a Linux box compile all of the above. Not shipped. See `Harness/README.md`. |

## The bundle layout

The build phase copies `dist/apple/` into **`Web/`** inside the app bundle. The
Swift looks the two files up by name:

```swift
Bundle.main.url(forResource: "engine", withExtension: "js",   subdirectory: "Web")
Bundle.main.url(forResource: "chrome", withExtension: "html", subdirectory: "Web")
```

`chrome.html` is loaded with `loadFileURL(_:allowingReadAccessTo:)` against the
whole `Web/` directory, so it may reference its own stylesheets and scripts.

## Injection

The engine is installed as a `WKUserScript` at `.atDocumentStart`, with
`forMainFrameOnly: false`, in the **page content world**. The plain
`WKUserScript(source:injectionTime:forMainFrameOnly:)` initialiser is used
rather than the one taking a `WKContentWorld`, because a user script added
without a world already goes into the page world — which is what is wanted, and
is API that has not moved since iOS 8.

That is the whole reason Oriel is a browser rather than an extension: there is
no extension Content-Security-Policy between a skin's JavaScript and the page,
and the timing is exact on the first navigation of a cold start.

## The bridge protocol

The message handler is named `oriel`, in the page world, on every surface.

```
page  -> Swift   window.webkit.messageHandlers.oriel.postMessage(
                   { id, namespace, method, args })

Swift -> page    window.__orielReply(id, true,  { ok: true, value })
                 window.__orielReply(id, false, { error, unsupported, code })

events           window.__oriel.dispatch(channel, data)
```

**The JavaScript half already exists and owns this format.** `hosts/apple/bridge.js`
was written first, is merged, and has tests pinning it; the Swift is written
against it, not the other way round. Two details that are easy to get subtly
wrong and impossible to see failing:

- **`id` is a number.** `createBridge` keys a `Map` with `nextId++`. Echo `"3"`
  instead of `3` and the promise hangs until its ten-second timeout.
- **`args` is positional**, an array, not a named object. `tabs.open(url, opts)`
  arrives as `[url, opts]`.

Swift sends the three arguments as one JSON array and `apply`s them, so an
object, an array, a string or null all cross without a special case.

Replies come back through `evaluateJavaScript` rather than through
`WKScriptMessageHandlerWithReply`. Three reasons: registering the reply protocol
needs a content-world API whose signature cannot be checked on a machine with no
Xcode; a reply handler cannot push the events the chrome document needs anyway;
and `hosts/apple/bridge.js` installs `__orielReply` unconditionally and picks its
path at run time, so taking the older one costs nothing there.

**Every command is answered**, including ones this shell has not built. An
unimplemented call comes back with `unsupported: true`, which the engine turns
into a `HostUnsupportedError` — a *missing capability*, distinct from a bug in
the skin. A dropped reply would leave a promise pending until it times out,
which reads as slowness rather than as a bug.

On the first load of each surface, Swift calls `__oriel.ping()` and logs the
answer. "The bridge is broken" and "the user script never ran" look identical on
a device and are otherwise very hard to separate from a bug report.

### Implemented so far

| Namespace | Methods |
|---|---|
| `tabs` | `list`, `current`, `open`, `close`, `activate`, `move` |
| `page` | `reload`, `stop`, `back`, `forward` |
| `native` | `safeArea` |

`native.safeArea()` answers with `{ top, leading, bottom, trailing }` — SwiftUI's
`EdgeInsets`, in points. Leading and trailing rather than left and right because
that is what SwiftUI reports and it stays correct in a right-to-left layout; the
chrome document maps them.

Everything else in `docs/BROWSER-API.md` — `chrome.*`, `net.*`, `page.evaluate`,
`page.snapshot`, `page.readability`, `tabs.pin`, `tabs.group`, and the rest of
`native` — is marked `// TODO(api):` at the point where it would be handled and
returns `unsupported` today. Nothing is stubbed silently.

## Known gaps

- **The chrome bar is a fixed 96pt band at the bottom.** A skin cannot yet make
  it taller or turn it into an overlay; that needs the chrome document to report
  its own height, and an overlaid transparent web view needs hit-testing that
  lets touches through to the page. `BrowserView.chromeHeight`.
- **New tabs load a blank document**, not a new-tab page. Waiting on
  `oriel.chrome.newTab`.
- **`browser/chrome/chrome.html` will not work from the bundle as it stands**,
  and neither problem is in `apple/`:
  - it loads `chrome.js` with `type="module"`, and WKWebView blocks ES module
    loading over `file://`. The bundle esbuild emits is an IIFE, so dropping
    `type="module"` is enough.
  - it links `../ui/theme.css`, but `IOS_COPY` in `scripts/build.mjs` flattens
    `browser/ui/theme.css` to the root of `dist/apple/`, so the path resolves
    above the bundle's `Web/` directory and outside the granted read access.
- **The engine claims every capability.** `boot()` in `hosts/apple/main.js` calls
  `createAppleHost(bridge)` with no capability list, so it defaults to all of
  `HOST_PROFILES.apple` while most of them answer `unsupported`. Its own comment
  says the list should come from the native side; there is no seam for Swift to
  pass one yet. Until there is, `oriel.can()` over-promises and skins find out
  by catching `HostUnsupportedError`.

## Compile status

There is no Xcode and no iOS SDK here, but there is a Swift compiler, and

```sh
swift build --package-path apple
```

typechecks `Sources/Browser` — the real files, unmodified — against stub
frameworks in `Harness/`. It is green, and CI runs it on every pull request as
the `swift typecheck` job. **Read `Harness/README.md` before trusting that.** It
proves the Swift is internally consistent and agrees with the API surface the
stubs describe; it does not prove that surface is Apple's. The stubs are the
list of signatures a human should check against Xcode's autocomplete.

The macOS job in `.github/workflows/apple.yml` is still the first thing that
sees the real SDK. That workflow currently runs `pnpm build --target safari`
only and will need `dist/apple/` built too, or the app target's copy phase stops
it before the compiler is reached.
