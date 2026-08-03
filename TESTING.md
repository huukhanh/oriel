# Testing

The dev box is headless Ubuntu with no Xcode, no simulator, and no compiler.
Everything in this file runs on a Mac and an iPhone.

Read `docs/api-notes.md` before the first build. Every Apple API in this app is
**asserted, not verified** — the Linux typecheck harness proves the code is
internally consistent, not that Apple's signatures match what it assumes.

---

## 1. What is proven, and what is not

Being precise about this saves build cycles. **Every row below except the last
is checked automatically on every push** — `linux-checks.yml` and
`ios-build.yml`.

| Layer | Status | How |
|---|---|---|
| `@match` matching, metadata parsing, wrapper generation, settings-rebuild logic, the store, URL normalisation | **proven** | 86 Linux tests |
| Injection runtime, SPA re-entry, CSP behaviour, `visibility-spoof`, `playsinline`, the media bridge | **proven in a real WebKit engine** | 31 Playwright/WebKit tests |
| **The app compiles** against the real iOS SDK, Swift 6 mode, strict concurrency | **proven** | macOS runner, `xcodebuild build` |
| **Content worlds and the message-handler bridge** | **proven at runtime** | 7 simulator tests against a real `WKWebView` |
| **The app launches and its screens work** | **proven** | 7 XCUITests driving the real app |
| PiP actually opening a window, background audio, lock screen, AirPlay | **unverified** | needs hardware — §6 |

The last row is the only one left. Everything above it is machine-checked, so
if you are chasing a bug, start by assuming those layers are fine.

## 2. Setup

**Requires:** Xcode 16+ (deployment target is iOS 18) and
[XcodeGen](https://github.com/yonaskolb/XcodeGen).

No `.xcodeproj` is checked in. Project files are generated from `project.yml`,
because hand-authoring `project.pbxproj` with no Xcode corrupts it in ways that
are slow and confusing to diagnose.

```sh
brew install xcodegen        # once
git clone git@github.com:huukhanh/oriel.git
cd oriel
```

### Signing

Where first builds die. Per `docs/decisions/001-distribution.md` this is
personal signing with a **free** Apple account:

1. Xcode → Settings → Accounts → add your Apple ID.
2. Open the generated project, select the target → **Signing & Capabilities**.
3. **Team**: your personal team. **Signing**: Automatic.
4. On *"Unable to register bundle identifier"*, change
   `PRODUCT_BUNDLE_IDENTIFIER` in `App/project.yml` and re-run `xcodegen`.

Free accounts: builds **expire after 7 days**, and there is a cap of 10 App IDs
per 7 days — so reuse one bundle id rather than minting a new one per
experiment.

> `xcodegen generate` **overwrites the project file**, resetting the Team you
> picked in the UI. Either re-select it, or add
> `DEVELOPMENT_TEAM: XXXXXXXXXX` under `settings: base:` in `project.yml`.

### Capabilities

**Background Modes → Audio** should already be ticked, from `UIBackgroundModes`
in `project.yml`. If that row is missing entirely, the `info:` block did not
apply — stop and say so, because every audio test would then fail for a reason
unrelated to the code.

---

## 3. Build

```sh
cd App
xcodegen generate
open Oriel.xcodeproj
```

Pick your iPhone as the destination, ⌘R.

Command line, so output can be pasted back verbatim:

```sh
cd App
xcodegen generate
xcodebuild -project Oriel.xcodeproj -scheme Oriel \
           -destination 'generic/platform=iOS' build 2>&1 | tail -40
```

> `App/Package.swift` in that same directory is **not** the app. It is the Linux
> typecheck harness — stub `SwiftUI`/`UIKit`/`WebKit`/`AVFoundation` modules that
> let the app sources compile on a machine with no Xcode. Do not open it in
> Xcode and do not add it as a package dependency.

The same build runs in CI on every push, so it should not surprise you. If it
fails locally but passes in CI, the difference is your Xcode version or signing,
not the code.

---

## 4. Smoke test — the five things that prove it is not fundamentally broken

Simulator is fine for all of these except where noted. Under two minutes.

1. **Launch.** Expect: the address bar, a webview loading m.youtube.com, and a
   toolbar along the bottom.
   *Fail signal:* a blank white webview usually means the page loaded but no
   content — check the Log (step 4) before assuming a crash.

2. **Type `example.com` in the address bar and submit.** Expect: it loads
   `https://example.com`. Then type `hello world`. Expect: a DuckDuckGo search,
   not a failed navigation. (This path is Linux-tested in `URLNormalizerTests`,
   so a failure here means the wiring is wrong, not the parsing.)

3. **Open the scripts sheet** (the `{}` button — its number is how many scripts
   match the current page). Expect: **"Keep playing in background"** and
   **"Force inline playback"**, both enabled, both labelled `built-in`.
   *Fail signal:* an empty list means the built-in `.js` files did not make it
   into the bundle. Check step 4 for a `missing from the bundle` line.

4. **Open the Log** (the lines button). Expect: no `error` entries.
   *This is the highest-value screen in the app when anything is wrong* — it
   captures document-start activity that Safari's Web Inspector will miss if
   you attach late.
   *Fail signal:* `prelude.js is missing from the bundle — no user script can
   run` means the resources phase is wrong and **nothing else below will work**.

5. **Open Settings, toggle "Desktop site", then toggle "Autoplay".** Expect: the
   first applies without reloading; the second **reloads the page**, because it
   is under "Reloads the page". That difference is the whole of §4.2 — a
   configuration flag cannot change on a live webview, so the app rebuilds it.
   *Fail signal:* if "Autoplay" does *not* reload, the rebuild path is not
   wired and that setting is silently doing nothing.

---

## 5. Scripts and injection (simulator is sufficient)

1. In the scripts sheet, tap **New**. A template appears with a metadata block.
2. Change `@match` to `*://*.example.com/*` and the body to
   `GM_log("it ran")`. Save.
3. Navigate to `example.com`. Open the Log.
   Expect: a line from your script id saying `it ran`.
4. Navigate to `wikipedia.org`. Reload. Expect: **no** new line — the guard
   should stop it running off-match.
5. Turn the script off in the list, return to `example.com`, reload.
   Expect: no line. Turn it back on: the line returns.
6. Type a deliberately broken `@match` such as `nonsense`. Expect: a warning
   under the editor naming the line, and the list shows **"matches nothing —
   will never run"**. It must not silently match everything.

## 6. Media — **real device only**

Simulator media behaviour does not reflect the device; a simulator pass here
proves nothing.

1. Play a video on YouTube. Lock the screen.
   Expect: *possibly* audio continues. Per
   `docs/decisions/004-background-audio-unverified.md` this is **opportunistic
   and unproven** — record what happens, do not treat failure as a bug.
2. With the video playing, switch to another app and back.
   Expect: the video is **still playing**, not paused. This one is not
   opportunistic — `visibility-spoof` is verified in a real WebKit engine, and
   its job is exactly this. If the page paused itself, check the scripts sheet
   to confirm "Keep playing in background" is enabled and on-match.
3. Turn that script **off**, repeat step 2. Expect: YouTube now pauses. That
   contrast is the proof the script is doing its job.

## 7. Known broken

- **Smart quotes in the editor** (`docs/api-notes.md`). `TextEditor` has no
  `smartQuotesType`, so iOS may replace `"` with a curly quote that is not valid
  JavaScript — invisibly. Until a `UITextView` wrapper lands, type script
  sources carefully or paste them in.
- **`GM_setValue`/`GM_getValue` are not implemented** — see
  `docs/userscript-api.md`.
- Phase 0's background-audio question is still unanswered
  ([#1](https://github.com/huukhanh/oriel/issues/1)).
