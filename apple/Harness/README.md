# The typecheck harness

There is no Xcode, no simulator and no iOS SDK on the machine this project is
developed on. There **is** a Swift compiler. This directory is what closes as
much of that gap as a Linux box can.

```sh
swift build --package-path apple                 # as iOS;   ~10s cold
swift build --package-path apple/Harness/macOS   # as macOS; ~10s cold
```

`apple/Package.swift` compiles `apple/Sources/Browser` — **the real files,
unmodified, not a copy** — against hand-written stubs of the four frameworks it
imports. XcodeGen ignores a `Package.swift` sitting beside `project.yml`, so the
shipping build and this one coexist without knowing about each other.

## Two flavours, one source set

The browser is iOS and macOS from one directory, with about twenty lines inside
`#if canImport(UIKit)` / `#elseif canImport(AppKit)`. The iOS package proves the
first branch of each of those. It says nothing whatsoever about the second — an
unexercised conditional branch is only *parsed*, never typechecked, so an
invented `NSColor.systemBackground` would sit there compiling perfectly until a
ten-times-billed macOS runner reached it.

So `apple/Harness/macOS/Package.swift` compiles the same sources again with the
**AppKit** stub where UIKit was. The mechanism is blunt: `canImport(UIKit)` is
true whenever the UIKit stub is reachable, so the macOS package must not depend
on it, directly or transitively — and does not.

Two packages rather than two targets in one, because the sources say
`import SwiftUI` and `import WebKit` and a single SwiftPM package cannot hold
two targets named `SwiftUI`. Nothing is duplicated: `Harness/macOS/Sources/` is
five symlinks, and each stub file branches on `canImport` internally to pick the
flavour its manifest handed it.

Both must be green. Green in one and red in the other is what a platform bug
looks like here, and it is the normal shape of the first failure.

## What green means

**It proves:** the Swift parses; its types line up; every symbol it names is one
it can reach; every call site matches the signature it is calling; the property
wrappers, result builders and protocol conformances all resolve — on **both**
platforms. Empirically, that is most of what goes wrong when writing Swift
blind. A negative control — renaming `stopLoading()` to `stopLoadingNow()` and
giving `reload()` an argument — fails the build with exactly those two errors.

The two-flavour claim has its own negative control, and it is worth re-running
whenever a stub grows a platform branch, because a harness that silently
compiles the same branch twice is worse than no harness:

| Change | iOS package | macOS package |
|---|---|---|
| `PlatformColor.windowBackgroundColor` → `.systemBackground` in the AppKit branch | green | **red**: `'PlatformColor' (aka 'NSColor') has no member 'systemBackground'` |
| `.systemBackground` → `.windowBackgroundColor` in the UIKit branch | **red**: `(aka 'UIColor') has no member 'windowBackgroundColor'` | green |
| `makeNSView` renamed | green | **red**: does not conform to `NSViewRepresentable` |

Note that a *syntax* error fails both packages regardless of which branch it is
in — Swift parses inactive `#if` branches. Only a semantic error distinguishes
them, which is why the controls above are misspelled members rather than
misspelled Swift.

**It does not prove** that the stubbed API surface is Apple's. The stubs are
this project's *belief* about UIKit, WebKit, SwiftUI and Combine, written from
memory. A wrong belief compiles perfectly here and fails on a Mac.

So the stubs are not scaffolding to skim past — they are **the list of claims a
human should check against Xcode's autocomplete**, and that check takes seconds
per symbol. Everything not in the stubs is machine-verified.

## Stubs must be platform-conditional too

A stub that declares an iOS-only symbol unconditionally makes both flavours
compile and hides exactly the error this second package exists to find.

That is not hypothetical. `WKWebViewConfiguration.allowsInlineMediaPlayback` is
iOS-only; the stub declared it for both, both harnesses went green, and the
error surfaced on a macOS runner instead — the expensive place. The stub now
declares it inside `#if canImport(UIKit)`, and using it unconditionally
reproduces the runner's error here in under a second.

So: when a symbol exists on one platform and not the other, fence it in the
stub. An unfenced declaration is a claim that Apple ships it everywhere.

## The rule that keeps this honest

When the harness reports an error, the fix goes in `Sources/Browser`, not in the
stub — unless the stub is genuinely wrong about Apple's API. Loosening a stub to
make code compile (widening a type, dropping a label, making a parameter
optional) turns the harness from a check into a rubber stamp, and the macOS
build then fails on something already marked "verified". If a stub does have to
change, that symbol belongs in the PR's Tier 2 assumptions list, because it
means a judgement call was made about a signature.

An unused stub declaration is an unchecked claim. Keep them minimal.

## Deliberate divergences

Four, all forced by Linux, all recorded in the stub file headers:

- **Language mode.** `Package.swift` is `swift-tools-version:6.0` so that
  `.swiftLanguageMode(.v5)` is available, and every target sets it. Without the
  pin, tools-version 6.0 would typecheck under Swift 6 strict concurrency —
  rules `apple/project.yml` never applies — and the harness would report errors
  that do not exist on a Mac.
- **`@objc` protocols.** `WKScriptMessageHandler` and `WKNavigationDelegate`
  are `@objc` on Apple platforms; here they are plain protocols refined from
  `NSObjectProtocol`.
- **Optional requirements.** `WKNavigationDelegate`'s methods are
  `@objc optional` on Apple platforms, which Linux has no equivalent for. The
  five this project implements are declared **required**, which is stricter than
  the real protocol — the useful direction, since a signature that does not
  match becomes an error here instead of a method that silently never fires.
- **`URLRequest`.** Part of Foundation on Apple platforms, part of
  FoundationNetworking in swift-corelibs-foundation. The WebKit stub re-exports
  it so the real source does not have to know.

## Layout

```
apple/Package.swift                    the iOS manifest; package root is apple/
apple/Sources/Browser/                 the real, shipping source (target: Browser)
apple/Harness/Sources/SwiftUI/         stub — UIViewRepresentable or NSViewRepresentable
apple/Harness/Sources/UIKit/           stub
apple/Harness/Sources/AppKit/          stub — nothing here has ever met real AppKit
apple/Harness/Sources/WebKit/          stub — read this one first
apple/Harness/Sources/Combine/         stub — ObservableObject and @Published
apple/Harness/macOS/Package.swift      the macOS manifest
apple/Harness/macOS/Sources/           five symlinks to the directories above
```

The SwiftUI and WebKit stubs are each compiled twice, once by each manifest, and
branch on `canImport` internally: SwiftUI declares `UIViewRepresentable` or
`NSViewRepresentable`, and `WKWebView` inherits from `UIView` or `NSView`.
`AppKit` deserves the most suspicion of the five — it is the only stub no build
of this project has ever checked against Apple's headers, even once.

`Combine` has its own target rather than living inside the SwiftUI stub because
that distinction is real and it already caught a bug: `ObservableObject` and
`@Published` are Combine's, and three files declaring them imported only
Foundation. SwiftUI re-exports Combine, which is exactly why that mistake is
easy to make and easy to miss.

CI runs both on every pull request as the `swift typecheck` job in
`.github/workflows/ci.yml`. `.github/workflows/apple.yml` is still the first
thing that sees a real SDK, and now builds both schemes.
