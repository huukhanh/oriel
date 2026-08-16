# apple/

The iOS side of Oriel: a **browser**, and the Safari Web Extension that is now
kept only as a test host.

`project.yml` is the source of truth. The `.xcodeproj` is generated and not
checked in.

```sh
pnpm install
pnpm build          # must produce dist/ios/ and dist/safari/
cd apple
xcodegen generate
open Oriel.xcodeproj
```

The build **fails loudly** if `dist/ios/engine.js`, `dist/ios/chrome.html` or
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

## The bundle layout

The build phase copies `dist/ios/` into **`Web/`** inside the app bundle. The
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

Swift -> page    window.__oriel_bridge_settle({ id, ok: true,  value })
                 window.__oriel_bridge_settle({ id, ok: false, error: { code, message } })
                 window.__oriel_bridge_event({ event, payload })
```

Replies come back through `evaluateJavaScript` and are matched by `id`, rather
than through `WKScriptMessageHandlerWithReply`. Two reasons: registering the
reply protocol needs a content-world API whose signature cannot be checked on a
machine with no Xcode, and a reply handler cannot push the events the chrome
document needs anyway. One mechanism, both directions.

A small ES5 bootstrap in `WebViewFactory.bootstrapSource` owns the JavaScript
half. It is injected before the engine and defines:

```js
window.__orielBridge.send(namespace, method, args)  // -> Promise
window.__orielBridge.on(function (event, payload) {})
window.__orielBridge.host                           // "ios"
window.__orielSurface                               // "page" | "chrome"
```

**Every command is answered**, including ones this shell has not built. An
unimplemented call resolves to `{ ok: false, error: { code: "unsupported" } }`
so the engine can degrade; a dropped reply would leave a promise pending
forever, which reads as slowness rather than as a bug.

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
- `window.__orielBridge` is an ordinary property, so a hostile page could
  replace it. It only reaches capability this browser already grants that page,
  but the eventual answer is a non-writable definition.

## Compile status

Written on a machine with no Xcode, no simulator and no Swift compiler. The
`apple` workflow in `.github/workflows/apple.yml` is the first thing that
compiles it. That workflow currently runs `pnpm build --target safari` only and
will need `dist/ios/` built too, or the app target's copy phase stops it.
