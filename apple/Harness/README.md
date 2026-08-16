# The typecheck harness

There is no Xcode, no simulator and no iOS SDK on the machine this project is
developed on. There **is** a Swift compiler. This directory is what closes as
much of that gap as a Linux box can.

```sh
swift build --package-path apple      # from the repo root; ~10s cold
```

`apple/Package.swift` compiles `apple/Sources/Browser` — **the real files,
unmodified, not a copy** — against hand-written stubs of the four frameworks it
imports. XcodeGen ignores a `Package.swift` sitting beside `project.yml`, so the
shipping build and this one coexist without knowing about each other.

## What green means

**It proves:** the Swift parses; its types line up; every symbol it names is one
it can reach; every call site matches the signature it is calling; the property
wrappers, result builders and protocol conformances all resolve. Empirically,
that is most of what goes wrong when writing Swift blind. A negative control —
renaming `stopLoading()` to `stopLoadingNow()` and giving `reload()` an argument
— fails the build with exactly those two errors.

**It does not prove** that the stubbed API surface is Apple's. The stubs are
this project's *belief* about UIKit, WebKit, SwiftUI and Combine, written from
memory. A wrong belief compiles perfectly here and fails on a Mac.

So the stubs are not scaffolding to skim past — they are **the list of claims a
human should check against Xcode's autocomplete**, and that check takes seconds
per symbol. Everything not in the stubs is machine-verified.

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
apple/Package.swift                    the manifest; package root is apple/
apple/Sources/Browser/                 the real, shipping source (target: Browser)
apple/Harness/Sources/SwiftUI/         stub
apple/Harness/Sources/UIKit/           stub
apple/Harness/Sources/WebKit/          stub — read this one first
apple/Harness/Sources/Combine/         stub — ObservableObject and @Published
```

`Combine` has its own target rather than living inside the SwiftUI stub because
that distinction is real and it already caught a bug: `ObservableObject` and
`@Published` are Combine's, and three files declaring them imported only
Foundation. SwiftUI re-exports Combine, which is exactly why that mistake is
easy to make and easy to miss.

CI runs this on every pull request as the `swift typecheck` job in
`.github/workflows/ci.yml`. The macOS job in `.github/workflows/apple.yml` is
still the first thing that sees the real SDK.
