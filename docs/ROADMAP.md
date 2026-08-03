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

**Status:** not started · **Milestone:** `Phase 0` · 1 issue, 1 throwaway PR

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

**Exit criteria.** If background audio holds on device: Phase 4 is built around
it and §7.3 visibility-spoofing becomes an enhancement. If it fails: **stop and
re-plan** Phase 4 around the tap-to-PiP path (§7.1 row 1), which is the one
mechanism rated reliable, and the app's pitch narrows to "PiP for any site".

Nothing else starts until this reports back.

---

## Phase 1 — Verifiable core

**Status:** blocked on Phase 0 · **Milestone:** `Phase 1`

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

**Status:** blocked on Phase 1 · **Milestone:** `Phase 2`

First phase with unverifiable code. Small PRs from here on; each one is a guess
until the user builds it.

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

**Status:** blocked on Phase 2 · **Milestone:** `Phase 3`

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

## Phase 4 — Media *(provisional — scope set by Phase 0 and the missing §7.5+)*

**Status:** blocked · **Milestone:** `Phase 4`

Known from §7.1 as it survives in the truncated file:

- PiP button driven by a **real user gesture** — the one mechanism rated
  reliable. Auto-PiP on backgrounding via JS silently fails and must not be
  attempted.
- `AVAudioSession` lifecycle + `UIBackgroundModes: audio`, scoped by Phase 0.
- `document.hidden` / `visibilityState` spoofing as a built-in script — high
  value and orthogonal to the above; fixes page-initiated pause.
- Now Playing info, sleep timer, `isIdleTimerDisabled` while media plays.

Native `AVPlayer` handoff (§7.5) is cut off mid-sentence in the source document
and is not planned until the full text is available.

---

## Phase 5 — Authoring UX *(provisional)*

**Status:** blocked · **Milestone:** `Phase 5`

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
