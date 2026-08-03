---
name: blind-swift
description: How to write iOS Swift — SwiftUI, WebKit, AVFoundation, SwiftData, UIKit — on a machine with no Xcode, no simulator, and no compiler, so that it builds first try on the user's Mac. Use this skill for every single edit to platform code in this project, including tiny ones. Trigger it whenever writing or modifying a .swift file that imports SwiftUI/UIKit/WebKit/AVFoundation/SwiftData, when the user reports compile errors from their Mac, or when deciding where a piece of logic should live. If you are about to type `import SwiftUI`, you should be using this skill.
---

# Writing Swift you cannot compile

The compiler is a human with a Mac and limited patience. Every build cycle costs them minutes and costs you a round trip. Optimize for first-try success, not for elegance.

## Rule 1: move logic out of the blind zone

Before writing platform code, ask what part of this is actually platform-specific. Usually less than it looks.

```
Blind zone (Mac only)      Provable zone (Linux, tested)
──────────────────────     ─────────────────────────────
WKWebView plumbing         glob → regex compilation
SwiftUI views              metadata block parsing
AVAudioSession calls       wrapper source generation
SwiftData @Model           URL matching decisions
delegate callbacks         script ordering / dedup
```

A `WKNavigationDelegate` that calls `Core.matcher.scripts(for: url)` is three provable lines and one guess. The same delegate with the matching logic inlined is one big guess. Take the first shape every time.

`Core` is Foundation-only. It must not import SwiftUI, UIKit, WebKit, AVFoundation, or SwiftData — those don't exist on Linux and the package will stop building. Model types in `Core` are plain `Codable` structs; the `@Model` persistence wrappers live in the app target and convert.

## Rule 2: three tiers of API confidence

Sort every API you reach for:

- **Tier 1 — memorized cold.** `WKWebViewConfiguration.allowsInlineMediaPlayback`, `WKUserScript(source:injectionTime:forMainFrameOnly:)`, `URL.absoluteString`, standard SwiftUI view modifiers. Use freely.
- **Tier 2 — confident on the concept, fuzzy on the signature.** Exact label order, whether it's `async`, whether it returns optional, which overload takes a content world. Use it, and add it to **Assumptions** in the PR body with the exact symbol name. The user grep-checks these in Xcode's autocomplete in seconds — far cheaper than a failed build.
- **Tier 3 — not sure it exists.** Do not write it. Options, in order: pick a Tier 1 alternative that's uglier but real; ask the user to check autocomplete; leave a `// TODO(api-check):` with a precise question and a working stub around it.

Inventing a plausible method name is the single most expensive mistake available here, because it looks exactly like correct code.

## Rule 3: prefer boring, old, stable API

Prefer APIs that shipped several versions before the deployment target. Newest-SDK API is where memory is least reliable and availability annotations bite. If you find yourself reaching for something introduced in the last year or two, treat it as Tier 3 regardless of how confident you feel.

Same for language features: obvious, verbose Swift beats clever Swift. Result builders, heavy generics, property-wrapper composition, and macro use all fail in ways that are hard to diagnose from a pasted error message.

## Rule 4: Swift 6 concurrency is the top blind-build killer

Under strict concurrency checking, most first-try failures on a project like this come from actor isolation, not from typos. Defensive habits:

- Anything touching `WKWebView`, any `UIView`, or a SwiftUI view model is `@MainActor`. Mark it explicitly rather than relying on inference.
- WebKit delegate methods are main-actor-bound. Don't `await` inside them without thinking about where you are; don't capture non-`Sendable` types across the boundary.
- Types crossing a task boundary need `Sendable`. `Core`'s value types should be `Sendable` structs — that's free and prevents a class of errors.
- Prefer explicit `Task { @MainActor in ... }` over letting inference decide.
- If a design needs an actor to be correct and you can't reason about it confidently, write the synchronous main-actor version. Simple and correct beats concurrent and unbuildable.

If strict concurrency is causing repeated failures, propose to the user that the app target relax to Swift 5 language mode and revisit later. That is a legitimate call, not a defeat.

## Rule 5: syntax hygiene, since nothing checks it

- Balance braces by construction — write the closing brace immediately, then fill the body.
- Explicit types on every stored property and every non-trivial `let`. Type inference errors surface far from their cause and are miserable to debug over chat.
- One file per type. Small files mean a compile error's line number is actionable.
- No force-unwraps outside tests. A crash on device is a worse feedback loop than a compile error.
- Watch for smart quotes in string literals if any content was pasted from a document — they compile as garbage or not at all. Same hazard as the on-device editor described in the brainstorm.
- Run `swift-format lint --recursive` if available (see `linux-verification`). It catches unbalanced syntax even for platform files it can't typecheck.

## Rule 6: the Xcode project file

`project.pbxproj` is generated, order-sensitive, and merge-hostile. Hand-editing it blind will corrupt the project and cost the user real time.

Preferred: **XcodeGen** (`project.yml`) or Tuist, so the project is generated from a text file that is safe to edit and diff. Propose this at bootstrap. If the user declines and keeps a checked-in `.xcodeproj`, then **never edit it** — when you add a new source file, list it in the PR body under "Files to add to the Xcode target" and let the user drag them in. Say this explicitly every time; a new file that isn't in the target fails in a confusing way (symbol not found, not a missing file).

## Rule 7: PR body carries what the compiler can't

Every platform PR ends with:

```markdown
## Assumptions (Tier 2 API — check these first)
- `WKUserContentController.addScriptMessageHandler(_:contentWorld:name:)` — assumed label order and that the reply variant exists on this deployment target
- Assumed `AVAudioSession.setActive(_:options:)` throws rather than returning Bool

## New files (add to Xcode target)
- Core/Sources/Core/MatchPattern.swift
- App/Injection/ContentWorldFactory.swift

## Compile status
Unverified — no toolchain on the dev box. Linux tests for Core pass (14/14).
```

## When the user pastes errors

1. Read the *first* error only. Swift error cascades are mostly noise after the first real failure.
2. Fix the root cause, not the symptom the message names. "Cannot convert value of type X" often means a wrong overload three lines up.
3. Push, and ask for one more build — don't batch speculative fixes for several errors at once unless they're clearly independent.
4. Record the correction: if the mistake was a wrong API signature, add the correct one to `docs/api-notes.md` so the same guess doesn't recur next month. That file is the project's accumulated compiler memory — read it before writing platform code.
