# apple/

The Apple side of Oriel: a **browser** for iOS and macOS, and the Safari Web
Extension that is now kept only as a test host.

One source set, not two. `Sources/Browser` is compiled by both app targets;
about twenty of its 1300 lines sit inside `#if canImport(UIKit)` /
`#elseif canImport(AppKit)`, and `Sources/Browser/Platform.swift` holds the
typealiases the rest of the code uses instead of branching. The branches are
written with `canImport` rather than `os(macOS)` so that the typecheck harness,
which runs on Linux where `os(macOS)` is false either way, can compile both
halves.

`project.yml` is the source of truth. The `.xcodeproj` is generated and not
checked in.

```sh
pnpm install
pnpm build          # must produce dist/apple/ and dist/safari/
cd apple
xcodegen generate
open Oriel.xcodeproj   # schemes: Oriel (iOS), OrielMacOS (macOS 13+)
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
| `Sources/Browser/Platform.swift` | The whole iOS/macOS difference: `PlatformView`, `PlatformColor`, an autoresizing mask and a window background colour. |
| `Sources/Browser/ContentWebView.swift` | Swaps the active tab's web view into a container. `UIViewRepresentable` on iOS, `NSViewRepresentable` on macOS, over one shared body. |
| `Sources/Browser/ChromeWebView.swift` | The same shape, around the chrome document's web view. |
| `Sources/Browser/WebViewFactory.swift` | Builds the shared configuration and the user scripts, owns every web view, and is the navigation delegate. |
| `Sources/Browser/Bridge.swift` | `WKScriptMessageHandler`. The transport under the `ios` host in `engine/host/contract.js`. |
| `Sources/Browser/BridgeCommand.swift` | The wire format, both directions. |
| `Sources/Browser/Info.macOS.plist`, `Sources/Browser/Oriel.macOS.entitlements` | macOS only. The sandbox is on and `com.apple.security.network.client` is what lets the web views reach the network at all. |
| `Package.swift`, `Harness/` | A typecheck harness: stub frameworks that let a Linux box compile all of the above, twice — as iOS and as macOS. Not shipped. See `Harness/README.md`. |

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

- **The chrome bar is a fixed band at the bottom** — 96pt on iOS, 72pt on
  macOS, where `chrome.css` drops `--o-tap` from 44px to 30px under
  `(hover: hover) and (pointer: fine)` and takes 14pt off each of the two
  control rows. A skin cannot yet make
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

There is no Xcode and no Apple SDK here, but there is a Swift compiler, and

```sh
swift build --package-path apple                 # as iOS,   against the UIKit stub
swift build --package-path apple/Harness/macOS   # as macOS, against the AppKit stub
```

typecheck `Sources/Browser` — the real files, unmodified — against stub
frameworks in `Harness/`. Both are green, and CI runs both on every pull request
as the `swift typecheck` job. Two commands rather than one because the browser's
sources say `import SwiftUI` and `import WebKit`, and one SwiftPM package cannot
hold two targets called `SwiftUI`; the stub *files* are shared by symlink, so
there is only ever one copy of each. **Read `Harness/README.md` before trusting that.** It
proves the Swift is internally consistent and agrees with the API surface the
stubs describe; it does not prove that surface is Apple's. The stubs are the
list of signatures a human should check against Xcode's autocomplete.

`.github/workflows/apple.yml` is still the first thing that sees a real SDK. It
builds both schemes — `Oriel` for iOS and `OrielMacOS` for macOS — in one job,
because they share a checkout and a `pnpm build` and a second macOS runner would
double a ten-times-billed rate to redo work already on disk.

**Nothing in this project has ever compiled a line of AppKit.** The AppKit stub
is a first-time claim rather than one a Mac build has survived; its file header
lists the three symbols worth checking against Xcode's autocomplete first.
