# API notes

Signatures the compiler has actually accepted or rejected. Append after every
build failure caused by a wrong guess. Read this before writing platform code.

Since `ios-build.yml` landed, this file has a real source: a **macOS runner with
the actual SDK** builds the app and runs simulator tests on every push. The
"substitute for having a compiler" framing is retired — there is a compiler.

---

## Confirmed by the real SDK

| Symbol | Verdict |
|---|---|
| `WKUserContentController.add(_:contentWorld:name:)` | ✅ correct — label order and overload both exist |
| `WKUserScript(source:injectionTime:forMainFrameOnly:in:)` | ✅ correct — `in:` is last |
| `WKWebView.evaluateJavaScript(_:in:in:completionHandler:)` | ✅ correct — frame, then content world |
| `WKNavigationDelegate` is `@MainActor` | ✅ correct |
| `UIViewRepresentable` is `@MainActor` and refines `View` | ✅ correct |
| `WKWebsiteDataStore.default()` / `.nonPersistent()` | ✅ static methods |
| `AVAudioSession.setCategory(_:mode:options:)` / `setActive(_:options:)` | ✅ both throw |
| `webView.isInspectable` under `#if DEBUG` | ✅ compiles for iOS 18 |
| `.onChange(of:) { old, new in }` | ✅ two-parameter form |
| `Section(_:content:)`, `TextEditor(text:)`, `.swipeActions`, `ToolbarItem(placement: .bottomBar)` | ✅ all compile |
| The whole app under `SWIFT_STRICT_CONCURRENCY: complete`, Swift 6 mode | ✅ zero errors, zero warnings |

**Verified at runtime on the simulator**, not merely compiled — these are the
two that fail *silently* and no compiler could settle:

| Behaviour | Verdict |
|---|---|
| the prelude reaches the `.page` world | ✅ `typeof window.__inj === "object"` |
| `GM_setValue`/`GM_getValue` round-trip through the reply handler | ✅ value written, read back, scoped per script |
| the script editor disables smart quotes, dashes and insert/delete | ✅ asserted against a real `UITextView` |
| the app launches and its screens present | ✅ 7 XCUITests |
| a handler added with `contentWorld: .page` is visible to a script in that world | ✅ `GM_log` arrives on the Swift side |
| the match guard keeps an off-match script from running | ✅ a youtube.com script does not run on example.com |
| a disabled script is not injected at all | ✅ zero registered entries |
| `visibility-spoof` installs its override in a real `WKWebView` | ✅ `document.hidden === false`, own property present |

## Corrected by the real SDK

| Symbol | Wrong assumption | Correct form | Learned |
|---|---|---|---|
| `MPNowPlayingInfoCenter`, `MPRemoteCommandCenter` | that they come with `AVFoundation` | **`import MediaPlayer`** — separate framework | first macOS build |
| `evaluateJavaScript` result in a `CheckedContinuation` | that `Any` could cross the boundary | it is not `Sendable`; convert inside the closure | first simulator test build |
| `WKScriptMessageHandlerWithReply` isolation | that it is `@MainActor`, like `WKNavigationDelegate` | it is **not** — the delegates differ | GM storage build |
| `WKScriptMessageHandlerWithReply` method shape | `(…, replyHandler: @escaping (Any?, String?) -> Void)` | Swift imports it as **`async -> (Any?, String?)`** | GM storage build |
| `XCUIApplication` | usable from a synchronous `setUp()` | it is `@MainActor`; use `setUp() async throws` | UI test build |
| `UIAction` handler | `() -> Void` | `UIActionHandler` is **`(UIAction) -> Void`** | accessory row build |

## Found by running, not by compiling

| Bug | Why nothing else caught it |
|---|---|
| The runtime was only injected into worlds derived from **enabled** scripts, so disabling every script left `window.__inj` undefined — killing the PiP button and Now Playing | Compiles identically. Logs nothing. Playwright has no `WKUserContentController` to model it with. Only a real `WKWebView` shows it. |

---

## Still unverified

Needs real hardware; a simulator cannot answer any of these:

- Whether PiP actually opens a window. `webkitSetPresentationMode` is exercised
  through a stub in the WebKit suite and reports `no-media`/`unsupported`
  honestly, but the real presentation path is untested.
- Whether background audio survives lock and backgrounding
  ([#1](https://github.com/huukhanh/oriel/issues/1)). Simulator media behaviour
  does not reflect the device.
- Now Playing on the lock screen, AirPlay, route changes, interruptions.

### Known gap, unrelated to any API

**`smartQuotesType` is not addressed.** §6 calls it critical: iOS may replace
`"` with a curly quote that is not valid JavaScript, invisibly, in the script
editor. `TextEditor` has no such property — solving it needs a `UITextView`
wrapped in `UIViewRepresentable`.
