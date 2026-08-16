---
name: blind-swift
description: How to write the small amount of Swift in apple/ — a SwiftUI container app and a Safari Web Extension handler — on a machine with no Xcode and no compiler, so that it builds first try. Use this for every edit to a .swift file, to apple/project.yml, or to an Info.plist, including tiny ones. Trigger it whenever the user reports build errors from Xcode or CI, and whenever deciding whether something belongs in Swift at all.
---

# Writing Swift you cannot compile

The compiler is a macOS CI run and, failing that, a human with a Mac. Optimise
for first-try success.

## Rule 0: almost nothing belongs here

`apple/` exists because iOS requires a container app to install a Safari Web
Extension. That is its entire job. Oriel is a web extension — the product lives
in `engine/`, gets copied into the `.appex` verbatim by a build phase,
and is covered by 700+ tests.

Today `apple/` is three short files: an `App`, a `SetupView`, a `StepRow`, and a
handler that completes every request and does nothing else. **Every line added
here is a line nobody in this project's loop can test.** Before writing Swift,
ask whether the same thing could be a page in the extension instead — it almost
always can, and then it is testable.

There is no native messaging. Do not add any without a reason that survives
this paragraph.

## Rule 1: three tiers of API confidence

- **Tier 1 — memorized cold.** `VStack`, `Text`, `ScrollView`, `Link`,
  `Bundle.main.infoDictionary`, `NSExtensionContext.completeRequest`. Use freely.
- **Tier 2 — right concept, fuzzy signature.** Label order, whether it throws,
  whether it is optional. Use it, and list it under **Assumptions** in the PR
  body with the exact symbol. A grep through Xcode's autocomplete takes seconds
  and is far cheaper than a failed build.
- **Tier 3 — not sure it exists.** Do not write it. Pick an uglier Tier 1
  alternative, or leave a `// TODO(api-check):` with a precise question around a
  working stub.

Inventing a plausible method name is the most expensive mistake available here,
because it looks exactly like correct code.

## Rule 2: boring, old, stable

Prefer API that shipped several versions before the deployment target (iOS
16.4 — Safari gained MV3 and constructable stylesheets there; see
`apple/project.yml`). Verbose Swift beats clever Swift: result builders beyond
plain SwiftUI, heavy generics, property-wrapper composition and macros all fail
in ways that are hard to diagnose from a pasted error.

The extension target is pinned to **Swift 5 language mode** on purpose. Nothing
in `apple/` is concurrent, and Swift 6 strict checking would be a source of
build failures in exchange for safety this target has no use for. Do not raise
it to be modern.

## Rule 3: syntax hygiene, since nothing checks it

- Write the closing brace immediately, then fill the body.
- Explicit types on stored properties. Inference errors surface far from their
  cause and are miserable to debug over chat.
- One file per type. A compile error's line number should be actionable.
- No force-unwraps. A crash on a device is a worse feedback loop than a compile
  error.
- Watch for smart quotes if any text was pasted from a document.

## Rule 4: the project file is generated

`apple/project.yml` is the source of truth and the `.xcodeproj` is not checked
in — it is order-sensitive, merge-hostile, and cannot be edited safely from a
machine with no Xcode. Add a source file by putting it in `apple/Sources/`; the
generator picks it up. Never hand-edit a `.pbxproj`.

Two things in that file are easy to get wrong and fail confusingly:

- The extension's bundle identifier **must** be a child of the app's.
  XcodeGen's default gives a sibling, and the symptom is an extension that
  installs and never appears in Safari's settings.
- The web extension's resources must land at the **root** of the `.appex`
  bundle. The copy phase does that, and `apple.yml` asserts `manifest.json`,
  `background.js`, `content.js` and `manager.html` are actually there — a bundle
  missing its manifest installs fine and then does nothing at all.

## Rule 5: what the PR body carries

```markdown
## Assumptions (Tier 2 — check these first)
- `NSExtensionContext.completeRequest(returningItems:completionHandler:)` — label order

## Compile status
Unverified here. `.github/workflows/apple.yml` is the first thing that compiles it.
```

Run the `apple` workflow before asking a human to build. It is manual and
tag-only because macOS runners bill at ten times the Linux rate, but one run is
far cheaper than one of the user's afternoons.

## When errors come back

Read the **first** error only; the rest is cascade. Fix the root cause, not the
symptom the message names. Push, ask for one more build. After two failed rounds
on the same change, stop and say plainly that the model of the API is wrong
rather than the code.
