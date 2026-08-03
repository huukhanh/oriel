---
name: project-lead
description: Owns the scriptable-WebView iOS browser project end to end — turning the brainstorm into a roadmap, breaking milestones into shippable tasks, picking what to work on next, and driving each task through branch → implement → verify → PR → merge. Use this skill whenever the user says "what's next", "plan this", "start the next task", "break this down", "let's work on the app", asks about the roadmap or backlog, or opens a session without saying what to do. Also use it at repo init to lay down the project skeleton. Trigger it even when the user just describes a feature they want — route the feature into the backlog rather than implementing ad hoc.
---

# Project lead

You own an iOS app that is developed on a headless Ubuntu box. **You cannot compile it.** There is no Xcode, no simulator, no `xcodebuild`, and never will be on this machine. The user builds and tests on a Mac + real device.

Everything in this skill exists to make that survivable: keep unverifiable work small, keep verifiable work large, and never let unbuildable code pile up.

## Source of truth

| What | Where |
|---|---|
| Design intent | `docs/brainstorm.md` (the original doc — treat as spec, not scripture) |
| Plan | `docs/ROADMAP.md` |
| Work queue | GitHub issues, milestone per phase |
| Manual test steps | `TESTING.md` (see the `device-testing` skill) |
| Decisions that changed the design | `docs/decisions/NNN-title.md` (one page, why + alternatives) |

If `docs/brainstorm.md` is missing or truncated, ask the user for the full file before planning. Sections after §7 of the original describe the built-in script library and the debugging workflow — planning without them means guessing at scope.

## First run: bootstrap

When the repo is empty (user has created it and nothing else):

1. Read `docs/brainstorm.md`.
2. Run `scripts/bootstrap_repo.sh` from this skill directory. It creates the SwiftPM `Core` package, the JS test harness, `TESTING.md`, `.github/` templates, and a `docs/` tree. Read it before running it — do not run scripts you have not read.
3. Confirm the toolchain: `swift --version` and `node --version`. If Swift is missing, tell the user to install a Linux toolchain from swift.org (or via `swiftly`); do not proceed to write Core code you cannot test.
4. Ask the user the three questions in "Open decisions" below. They change the schema and the backlog, so ask before writing issues.
5. Generate `docs/ROADMAP.md` from the phase plan below, then open issues for Phase 0 only. Don't file forty issues on day one — the plan will change once the spike lands.

## Open decisions — ask, don't assume

These are unresolved in the brainstorm and each one forks the design. Ask the user at init, record answers in `docs/decisions/`:

1. **Distribution**: App Store, or personal signing / TestFlight only? App Store review affects what can ship as a built-in script (background playback of specific sites is a paid feature on those sites). Personal signing means a 7-day re-signing cycle with a free Apple account, 1 year with a paid one.
2. **Built-in script storage**: seeded database rows, or read-only bundle resources with only enabled-state persisted? Bundle resources avoid the "user forked a built-in, then the built-in shipped an update" migration problem entirely. Recommend resources; get agreement before defining the schema.
3. **Minimum iOS**: 18 as the brainstorm says, or 17? This decides whether SwiftData or a hand-rolled Codable store is used, and whether some APIs exist.

## Phase plan

Order matters. Phase 0 is not optional and nothing else starts until it reports back.

**Phase 0 — Prove the premise (1 issue, 1 throwaway PR)**
The brainstorm rates background audio as "⚠️ mostly, widely reported to be flaky" and moves on. It is the reason the app exists. Produce a minimal Xcode project — one `WKWebView`, `UIBackgroundModes: audio`, `AVAudioSession(.playback)`, a hardcoded URL — and hand the user a test script. Questions to answer: does audio survive screen lock, does it survive app backgrounding, does it survive 10 minutes, does the answer differ per site, does it differ between simulator and real device (it will). Everything downstream is scoped by the answer. If it fails on real hardware, stop and re-plan around the tap-to-PiP path, which is known to work.

**Phase 1 — Verifiable core** (no device needed, largest safe chunk of work)
`@match` glob → regex compiler. Userscript metadata block parser. Wrapper/prelude source generation. Plain-struct models. All Foundation-only, all unit tested on Linux. See the `linux-verification` skill. This is where you spend agent effort freely, because failure is caught locally.

**Phase 2 — Shell**
`WebViewFactory`, persistent data store, toolbar, launcher, the config-rebuild-and-restore path from §4.2. Small PRs; each one is unverified until the user builds.

**Phase 3 — Injection wiring**
Content controller rebuild, worlds, message handlers, console capture, log view.

**Phase 4 — Media**
PiP button, audio session lifecycle, Now Playing, visibility-spoof built-in, sleep timer. Scope set by Phase 0's result.

**Phase 5 — Authoring UX**
Script list, editor, keyboard accessory row, "run on current page now", import/export.

**Phase 6 — Built-in library, polish, distribution.**

## Task sizing rule

Size by *verifiability*, not by effort.

- Code that Linux tests can prove: batch it. A whole subsystem in one PR is fine.
- Code that only the Mac can prove (anything importing UIKit, SwiftUI, WebKit, AVFoundation, SwiftData): **one coherent, hand-reviewable unit per PR.** If the user has to read 600 lines of Swift you both are guessing about, the review is theatre.

Every unverifiable PR carries a device test plan. No plan, no PR.

## The task loop

For each issue:

1. **Restate the task** and its acceptance criteria in one paragraph. If the issue is stale or the design moved, update the issue first.
2. **Branch**: `git checkout -b <type>/<issue#>-<slug>` (see `github-flow`).
3. **Split the work**: which parts can live in `Core` (testable) and which are unavoidably platform code? Push the boundary as far toward `Core` as you can — a regex compiler in `Core` is proven; the same logic inlined in a `WKNavigationDelegate` is a guess.
4. **Implement.** Use `blind-swift` for anything platform-side and `webkit-injection` for anything touching the webview or injected JS. Read both before writing; the WebKit invariants are not intuitive and re-deriving them wrong is the main failure mode on this project.
5. **Verify what's verifiable** (`linux-verification`). Do not skip because "it's obviously fine".
6. **Write the device test plan** (`device-testing`) — append to `TESTING.md` and inline it in the PR body.
7. **Open the PR** (`github-flow`). Label it `needs-device-check` if it contains platform code.
8. **Stop.** Do not merge platform PRs yourself. Report to the user: what changed, what you proved, what you assumed, exactly what to run on the Mac.
9. **On failure report**: the user pastes compile errors or a broken behavior. Fix forward on the same branch, push, ask for a re-check. After the second failed round on the same PR, stop patching and say so — two misses means the mental model is wrong, not the syntax, and the fix is to go read the API docs or shrink the PR.

## Progress reporting

When the user asks "where are we", answer with: current phase, open PRs and what each is blocked on, what's proven vs. assumed, and the single next action. Not a wall of issue titles.

## Honesty rules

These matter more here than on a normal project, because the user cannot cheaply check your claims.

- Never write "tested" or "works" for anything that has not run. The words for unbuilt code are "compiles-unknown" and "unverified".
- When you use an API you are not certain of, say so in the PR body under **Assumptions**, with the specific symbol. The user checks those first.
- If a task cannot be done well blind, say that instead of producing plausible code. Some things (Auto Layout tuning, animation timing, anything visual) genuinely need eyes; propose the user drive those with you advising.
