---
name: linux-verification
description: What can actually be proven on the headless Ubuntu dev box — Foundation-only Swift unit tests for the Core package, Node/jsdom tests for all injected JavaScript, linting, and the harness that runs them. Use this skill before opening any PR, when adding logic that could be tested, when deciding whether something belongs in Core or the app target, and whenever setting up or fixing CI. Trigger it any time you are about to claim something works — it defines the difference between "tested" and "assumed" on this project.
---

# Verification on a machine with no Xcode

Two things run here and nothing else: Foundation-only Swift, and Node. Everything provable must be pushed into one of them.

## Layout

```
Core/                    swift build && swift test  ← runs on Linux
  Sources/Core/          Foundation only. No WebKit/UIKit/SwiftUI/SwiftData.
  Tests/CoreTests/
web/                     npm test                   ← runs on Linux
  src/                   prelude.js, wrapper-runtime.js, gm-shim.js, builtins/*.js
  test/                  vitest + jsdom
App/                     unbuildable here. Keep thin.
```

Both `Core/` and `web/` are consumed by the app as resources/dependencies. The app target should be glue: create the webview, ask `Core` what to inject, hand it the strings.

## The pressure to apply

When a task looks like platform work, find the provable kernel inside it and move that kernel to `Core` or `web`. Examples:

| Task as stated | Provable kernel |
|---|---|
| "Inject matching scripts on navigation" | `Matcher.scripts(for: URL, from: [Script]) -> [Script]` |
| "Parse pasted userscripts" | metadata block parser → struct, with fixtures |
| "Wrap user source in a URL guard" | `WrapperBuilder.wrap(source:patterns:runAt:) -> String`, snapshot-tested |
| "Keep video playing in background" | the visibility-spoof JS itself, tested in jsdom |
| "Store scripts" | `Codable` structs + migration functions; only the `@Model` shell is blind |
| "Show which scripts affect this page" | same `Matcher`, different caller |

If a PR contains platform code and zero test changes, ask whether the kernel was missed.

## Swift tests

```bash
cd Core && swift build && swift test
```

Cover at minimum:
- Glob → regex: `*://*.example.com/*` matching and, more importantly, **not** matching `https://evil.com/?x=example.com`, `https://notexample.com/`, `https://example.com.evil.com/`. Over-matching is a privacy bug — it ships the user's scripts to sites they didn't authorize.
- Scheme, subdomain wildcard, path wildcard, trailing-slash, query-string, and fragment cases.
- Metadata parsing: missing block, duplicate `@match`, unknown keys (must be ignored with a warning, never fatal), CRLF line endings, no trailing newline.
- Wrapper generation: snapshot tests. Generated JS is a string; diff it. Then feed the generated string to the Node suite (below) so the snapshot is also *executed*, not just compared.

## JavaScript tests

```bash
cd web && npm test
```

jsdom gives a DOM, `history`, `location`, and events — enough to test the genuinely tricky parts:

- The wrapper runs its body when `location.href` matches and does not when it doesn't.
- A simulated `pushState` to a matching route re-runs; to a non-matching route does not.
- **Re-entry does not double-register.** Navigate away and back, assert one listener/observer, not two. This is the bug most likely to ship otherwise.
- Cleanup handlers fire before re-run.
- `history.pushState` is patched exactly once even with ten scripts loaded.
- The GM shim's `postMessage` calls go to a stubbed `window.webkit.messageHandlers`, so the bridge contract is pinned by tests on both sides.
- Console capture forwards and still calls through to the original console.
- The visibility-spoof script: `document.hidden` reads false and `visibilitychange` doesn't fire after a simulated background event.

jsdom is not WebKit — it won't catch real-site behavior. It does catch logic errors, which is most of what goes wrong here.

## Lint

```bash
swift-format lint --recursive Core App    # if installed; catches unbalanced syntax even in App
npx eslint web/src web/test
node --check web/src/*.js                 # zero-dependency syntax gate
```

`node --check` on every generated wrapper string is cheap and catches template-string mistakes in the Swift generator — pipe the snapshot output through it in CI.

## CI

GitHub Actions, `ubuntu-latest`, on every PR: Swift build + test, npm test, lint. There is no macOS job — say so in the workflow comments so nobody assumes the green check means it builds for iOS. Name the workflow `linux-checks` rather than `build` for the same reason.

## Reporting

In every PR, state both halves plainly:

```
Proven here:  Core 23/23, web 11/11, lint clean
Not proven:   everything in App/ — needs Xcode
```

Never let "CI is green" stand in for "it works". On this project those are unrelated claims, and the user is relying on you not to blur them.
