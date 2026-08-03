# API notes

Signatures the compiler has actually accepted or rejected. Append after every
build failure caused by a wrong guess. Read this before writing platform code —
it is this project's substitute for having a compiler.

| Symbol | Correct form | Learned |
|---|---|---|

---

## Unconfirmed assumptions

`App/Sources/Shims/` is this list made executable. Those stub modules let the
real app sources be typechecked on Linux in Swift 6 language mode — but a stub
encodes what we *believe* an Apple API looks like, so **a green Linux build
means "internally consistent", never "will compile in Xcode"**.

Everything below is asserted, not verified. On the first real build, check these
first; each is a single autocomplete lookup.

### Highest risk — silent failure rather than a compile error

| Symbol | Assumed | Why it matters |
|---|---|---|
| `WKUserContentController.add(_:contentWorld:name:)` | that label order, and that the world-taking overload exists | If the handler lands in a different world than the script, `window.webkit.messageHandlers.scriptLog` is `undefined` on the JS side. **Compiles fine, logs nothing.** |
| `WKUserScript(source:injectionTime:forMainFrameOnly:in:)` | `in:` is the last parameter | Same class of failure — a script in the wrong world sees a different global object. |

### Compile-time risk

| Symbol | Assumed |
|---|---|
| `WKNavigationDelegate` | is `@MainActor` in the iOS 18 SDK. `WebViewContainer.Coordinator` is annotated to match; if Xcode disagrees, change the **stub**, don't drop the annotation |
| `UIViewRepresentable` | is `@MainActor` and refines `View` |
| `WKWebView.evaluateJavaScript(_:in:in:completionHandler:)` | frame first, content world second |
| `WKWebView.isInspectable` | exists on iOS 16.4+ (used under `#if DEBUG`) |
| `WKWebsiteDataStore.default()` / `.nonPersistent()` | static methods, not properties |
| `AVAudioSession.setCategory(_:mode:options:)` | throws; `.moviePlayback` is valid with `.playback` |
| `AVAudioSession.setActive(_:options:)` | throws rather than returning `Bool` |
| `MPNowPlayingInfoCenter.default()` | a static method |
| `.onChange(of:) { old, new in }` | the two-parameter form (iOS 17+) |
| `Section(_:content:)` | pins `Parent == Text, Footer == EmptyView` |
| `TextEditor(text:)` | takes a plain `Binding<String>` |

### Known stub inaccuracies

Places where the Linux check is deliberately *laxer* than the SDK, so a real
error could hide:

- **`smartQuotesType` is not addressed.** It is a `UITextView` property with no
  `TextEditor` equivalent. §6 calls it critical: smart quotes silently replace
  `"` with a curly quote that is not valid JavaScript, and the corruption is
  invisible in the editor — the script just stops working.
  `autocorrectionDisabled` and `textInputAutocapitalization(.never)` are
  applied, but **this specific problem is unsolved** and needs a
  `UIViewRepresentable` wrapper around `UITextView`.
- Stub view modifiers all return one opaque type, so ordering mistakes that
  real SwiftUI would reject by type are not caught here.
- The stub will not reproduce SwiftUI's type-checker timeouts on large view
  bodies.
