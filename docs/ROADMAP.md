# Roadmap

Derived from [`brainstorm.md`](./brainstorm.md). Phase order is not negotiable:
Phase 0 gates everything, and each later phase assumes the one before it landed.

**Development constraint that shapes this whole plan:** the app is developed on
a headless Ubuntu box with no Xcode, no simulator, and no compiler. Only the
`Core` SwiftPM package (Foundation-only) and `web/` JavaScript can be verified
here. Everything else is *compiles-unknown* until the user builds it on a Mac.
So the plan front-loads provable work and keeps unprovable work in small,
hand-reviewable PRs. See the `linux-verification` and `blind-swift` skills.

> ⚠️ **`docs/brainstorm.md` is truncated.** It ends mid-table in §7.1, at the
> row for native `AVPlayer` handoff. Sections §7.5 onward — the rest of the
> media mechanisms, the starter script library (§10), and the debugging
> workflow (§12) — are missing. **Phases 0–3 below are fully specified by what
> is present. Phases 4–6 are provisional** and will be rewritten once the full
> document is available.

## Decisions in force

| # | Decision | Effect on this plan |
|---|---|---|
| [001](./decisions/001-distribution.md) | Personal signing, free Apple account | No review constraints on built-in scripts. 7-day re-sign cycle. |
| [002](./decisions/002-builtin-script-storage.md) | Built-ins are read-only bundle resources | No seeding, no fork/update migration. Store holds state only. |
| [003](./decisions/003-minimum-ios.md) | iOS 18, SwiftData, Swift 6 | Models are `Codable` structs in `Core`; SwiftData is a thin shell. |

---

## Phase 0 — Prove the premise

**Status:** built, delivered, **unanswerable** · **Milestone:** `Phase 0`

> The spike is built and handed off ([#1](https://github.com/huukhanh/oriel/issues/1),
> [PR #3](https://github.com/huukhanh/oriel/pull/3)) but **no device tester is
> available**, so it will not report. Per
> [decision 004](./decisions/004-background-audio-unverified.md) the project
> stops waiting: **Phase 4 is planned PiP-first**, and background audio is
> treated as an enhancement that may not work rather than a foundation.
> The PR stays open; if a device run ever happens, the answer is one afternoon
> away and Phase 4 gets revisited.
>
> Phases 1–3 never depended on the answer. That was the point of front-loading
> them, and they proceed unchanged.

The brainstorm rates `UIBackgroundModes: audio` + `AVAudioSession(.playback)`
as "⚠️ mostly, widely reported to be flaky" (§7.1) and moves on. That row is
the reason the app exists. Everything in Phase 4 is scoped by whether it holds
on real hardware.

Deliverable: a throwaway Xcode project — one `WKWebView`, `UIBackgroundModes:
audio`, `AVAudioSession(.playback)`, a hardcoded URL — plus a device test
script for the user to run.

Questions it must answer:

- Does audio survive **screen lock**?
- Does audio survive **app backgrounding** (home / app switcher)?
- Does it survive **10 minutes** backgrounded, or does the media process get
  suspended partway?
- Does the answer **differ per site**? (YouTube vs. a plain `<video>`/`<audio>`
  tag vs. one MSE-based player.)
- Does it differ between **simulator and real device**? It will. Only the
  device answer counts.

**Exit criteria (resolved by decision 004).** An unanswerable question and a
failed answer have the same planning consequence — you cannot build
load-bearing structure on either. So the "it fails" branch was taken: Phase 4
is re-planned around tap-to-PiP, and the app's pitch narrows honestly to
"PiP and scripting for any site".

Nothing else starts until this reports back.

---

## Phase 1 — Verifiable core

**Status:** ✅ complete · **Milestone:** `Phase 1` · #4 #5 #6 shipped

Everything below landed with tests. Two notes on where it differs from the
original plan:

- **`Binding` was not built.** The §3 diagram has a type joining scripts to
  sites, but a script's scope *is* its `@match` patterns — a binding table would
  be a second, derived source of truth for the same fact, free to disagree with
  the first. Scope lives in one place.
- **Re-entry departs from the §5.2 sketch**, per
  [decision 005](./decisions/005-spa-reentry.md). Scripts run once per *match*,
  not once per route change.

The largest safe chunk of work in the project, and the only phase where agent
effort can be spent freely — every failure is caught locally.

All Foundation-only, all unit-tested on Linux, in the `Core` package:

- **`@match` glob → regex compiler** (§5.2). The Chrome/Tampermonkey subset
  (`*://*.example.com/*`). Do not invent syntax — pasted userscripts must work.
  Table-driven tests including the adversarial cases: `*` in the scheme,
  leading-dot host matching, path-only wildcards, and patterns that must *not*
  match (`*://example.com/*` vs `evil-example.com`).
- **Userscript metadata block parser** (§5.4). `@name`, `@match`, `@run-at`,
  `@world`, `@description`, `@noframes`. Unknown keys are preserved and
  surfaced as soft warnings, never dropped silently.
- **Wrapper / prelude source generation** (§5.2). Swift emits the URL-guard
  wrapper around user source. Golden-file tests on the generated string, and
  the emitted JS is syntax-checked under Node.
- **Plain-struct models** — `Script`, `Site`, `Binding` as `Codable` value
  types, per [003](./decisions/003-minimum-ios.md). Round-trip tests.
- **Prelude JS** (`web/src/prelude.js`) — history patching, `__inj:navigate`,
  GM shim surface, console capture. Tested under Node + jsdom.

The Swift and JS halves meet at the generated wrapper: Swift produces it, Node
proves it parses and behaves. That seam is the highest-value test in Phase 1.

---

## Phase 2 — Shell

**Status:** ✅ **written and typechecked**, unbuilt · **Milestone:** `Phase 2`

**It builds, and it runs.** A macOS CI job compiles the app against the real
iOS SDK in Swift 6 mode with strict concurrency (zero errors, zero warnings) and
runs XCUITests that launch it in the simulator.

The Linux stub harness (`App/Package.swift`) is still there and still useful as
a fast local check, but it is no longer the last word — `docs/api-notes.md`
records what the real SDK confirmed, corrected, and exposed.

First phase with unverifiable code — and with no one building on a Mac, every
PR from here lands in `main` only after someone confirms it compiles. Per the
merge gate that is not a formality: unbuildable code in `main` is inherited by
the next branch, and the failure then surfaces attached to the wrong change.

Small PRs from here on; each one is a guess until built.

- `WebViewFactory.make(settings:)` — the single place a `WKWebView` is born,
  with the §4.1 config flags.
- Persistent store (SwiftData shell over Core structs).
- Toolbar: back · home · reload · share · PiP · AirPlay · fullscreen · scripts.
- Launcher / bookmarks grid.
- **The config-rebuild-and-restore path (§4.2)** — `WKWebViewConfiguration` is
  copied at webview creation, so inline-playback / PiP / autoplay toggles
  cannot affect a live webview. Capture URL + scroll offset, rebuild, restore,
  reload. Settings UI groups these under a "Reloads page" header.
- `isInspectable = true` in DEBUG.

---

## Phase 3 — Injection wiring

**Status:** ✅ **written; the JavaScript half is proven in a real WebKit engine**
· **Milestone:** `Phase 3`

`web/webkit/` runs the injection engine in Playwright's WebKit — the same
JavaScriptCore and WebCore that back `WKWebView` — settling document-start
timing, CSP behaviour, history interception and SPA re-entry.

**Content worlds and the message-handler bridge are now proven too**, by
simulator tests against a real `WKWebView` (`App/Tests/`). Those were the two
riskiest entries in `docs/api-notes.md` because they fail *silently*; they are
verified rather than assumed, and the same suite caught a real bug — the runtime
was only injected into worlds derived from *enabled* scripts, so disabling
everything killed the PiP button.

Where Phase 1's proven logic meets WebKit. Read the `webkit-injection` skill
before touching any of it — these invariants are counter-intuitive and
re-deriving them wrong is this project's main failure mode.

- Content controller rebuild — user scripts are a *set*, not individually
  addressable (§5.1). `removeAllUserScripts()` + re-add, wholesale, from the
  desired set held in Swift.
- Layer A matching: recompute the set before `load()` and on
  `decidePolicyFor(navigationAction)` for a new document.
- Content worlds (§5.3), defaulting to `.page`, with a per-script picker.
- `.atDocumentStart` injection — mandatory, not a nicety, for the media scripts.
- Message handlers, `WKScriptMessageHandlerWithReply` for GM get/set.
- Console capture → in-app Log view, filterable by script (§5.5).

---

## Phase 4 — Media, PiP-first *(provisional — §7.5+ still missing)*

**Status:** load-bearing half ✅ **built**; opportunistic half written ·
**Milestone:** `Phase 4`

Re-planned per [decision 004](./decisions/004-background-audio-unverified.md).
Ordered by how reliable the mechanism is, so the app is useful even if
everything below the line never works:

**Load-bearing (mechanisms that are known to work):**

1. **PiP button driven by a real user tap.** §7.1 rates this ✅ reliable and it
   is what a comparable shipped app uses. Every PiP entry routes through this
   one button. Auto-PiP from `visibilitychange` fails *silently* and must not
   be attempted or "fixed" later.
2. **`document.hidden` / `visibilityState` spoofing** — ✅ **built and proven in
   real WebKit** (`web/src/builtins/visibility-spoof.js`). Promoted from
   enhancement to headline: it is *orthogonal* to the audio session, and fixes
   page-initiated pause — a real failure that hits YouTube whether or not the
   media process survives. The Swift half (a settings toggle that enables it) is
   all that remains.
3. `isIdleTimerDisabled` while media plays, cleared on pause and teardown.

**Already delivered, JS half proven:** `visibility-spoof` and `playsinline` are
written, wrapped by the real generator, and verified in a real WebKit engine
(`web/webkit/builtins.webkit.test.js`) — including that switching one off
restores the page exactly. They need only a toggle to reach the user.

**Opportunistic (ships, but nothing depends on it):**

4. `AVAudioSession` lifecycle + `UIBackgroundModes: audio`. Cheap, required for
   PiP audio to behave anyway, and works if the platform cooperates. No other
   feature's correctness may depend on it.
5. Now Playing info and remote commands — owned by `MediaCoordinator` in Swift,
   fed by JS events over the bridge, never implemented in JS.
6. Sleep timer.

Native `AVPlayer` handoff (§7.5) is cut off mid-sentence in the source document
and is not planned until the full text is available.

Native `AVPlayer` handoff (§7.5) is cut off mid-sentence in the source document
and is not planned until the full text is available.

---

## Phase 5 — Authoring UX *(provisional)*

**Status:** core loop ✅ built · **Milestone:** `Phase 5`

Built: the merged list with per-script toggles and match summaries, the editor
with live metadata warnings, **"Run on this page now"**, duplicate-a-built-in,
delete, and the bookmark launcher.

Not built: import/export, the keyboard accessory row, drag-to-reorder, and —
called out in `docs/api-notes.md` — **`smartQuotesType`**, which §6 flags as
critical. `TextEditor` has no such property, so solving it needs a `UITextView`
wrapper. Until then iOS may silently replace `"` with a curly quote that is not
valid JavaScript.

- Scripts list — built-ins and user scripts merged, drag to reorder (order =
  injection order), per-section grouping.
- Editor — `TextEditor` + `.monospaced()`, `autocorrectionDisabled`,
  `textInputAutocapitalization(.never)`, and **`smartQuotesType = .no`**, which
  is critical: smart quotes silently corrupt JS.
- Keyboard accessory row: `{ } ( ) [ ] ; = > ' " ⇥`, undo/redo.
- **"Run on current page now"** — `evaluateJavaScript` against the live
  webview. The feature that makes on-device authoring bearable.
- Import/export: `.user.js` via `fileImporter`, clipboard, `ShareLink`,
  import-from-URL with a preview step — never auto-run a fetched script.
- Per-site view from the toolbar's scripts button.

---

## Phase 6 — Built-in library, polish, distribution *(provisional)*

**Status:** blocked · **Milestone:** `Phase 6`

The starter library is §10 of the brainstorm, which is **missing from the
truncated file**. This phase cannot be planned until that section is available.

Also here: personal-signing setup and the 7-day re-sign workflow
([001](./decisions/001-distribution.md)), and the §12 debugging workflow, also
missing.

---

## Working agreement

- Size tasks by **verifiability**, not effort. Linux-provable work batches into
  large PRs; platform code is one coherent, hand-reviewable unit per PR.
- Every PR containing platform code carries a device test plan in the body and
  in `TESTING.md`, and is labeled `needs-device-check`. No plan, no PR.
- Platform PRs are **never** merged by the agent. The user builds, then says so.
- Uncertain API usage is declared in the PR body under **Assumptions**, naming
  the specific symbol. Confirmed signatures are appended to
  [`api-notes.md`](./api-notes.md) after every build.
- The words for unbuilt code are "compiles-unknown" and "unverified" — never
  "tested" or "works".
