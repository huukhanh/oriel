---
name: github-flow
description: Branch, commit, PR, review-response and merge conventions for this project, including the device-verification gate that decides when a PR may be merged. Use this skill whenever creating a branch, writing commits, opening or updating a pull request, responding to the user's build results, or merging anything. Trigger it any time the user says "make a PR", "merge it", "ship it", "it builds", "it's broken", or asks about repo state. It defines when merging is and is not allowed — check it before every merge, no exceptions.
---

# Git and PR flow

Uses `gh`. Confirm auth once per session with `gh auth status`; if it fails, ask the user for a token rather than guessing at credentials.

## Branches

`<type>/<issue>-<slug>` — `feat/12-match-compiler`, `fix/31-double-listener`, `spike/1-background-audio`, `chore/8-ci`.

Types: `feat`, `fix`, `spike`, `chore`, `docs`, `refactor`.

Branch from up-to-date `main`. One issue per branch. If a task turns out to be two things, split the branch — a PR that mixes provable Core work with blind platform work forces the user to review both at the strictness of the blind half.

## Commits

Conventional commits, scoped to the module: `feat(core): compile @match globs to NSRegularExpression`.

Body explains *why* when the reason isn't obvious from the diff. Note anything unverified:

```
fix(injection): patch history.pushState once in the prelude

Each wrapper patching independently produced N nested wrappers and
re-entrant fire() calls. Prelude now patches once and dispatches
__inj:navigate; wrappers listen.

Unverified on device. web/ tests cover the single-patch invariant.
```

Never use `--no-verify`. Never force-push a branch the user has already pulled to their Mac — they lose their local build state and the reason will not be obvious.

## PR body template

`.github/pull_request_template.md` holds this; fill every section.

```markdown
## What
One paragraph. Closes #12.

## Design notes
Non-obvious choices and rejected alternatives.

## Proven on Linux
Core: 23/23 · web: 11/11 · lint clean
(or: nothing — this PR is platform-only)

## NOT proven
Everything under App/. No compiler on the dev box.

## Assumptions (Tier 2 API — check these first)
- `WKUserContentController.addScriptMessageHandler(_:contentWorld:name:)` — label order assumed

## New files (add to the Xcode target)
- App/Injection/PreludeInstaller.swift

## Device test plan
1. Build to a real device (not simulator — this touches PiP).
2. Open youtube.com, play a video, tap PiP in the toolbar.
   Expect: PiP window appears, audio continues.
3. Lock the screen. Expect: audio continues ≥ 30s.
4. Reopen the app. Expect: video resumes inline, no duplicate audio.

Report back: pass/fail per step, plus any Xcode errors verbatim.
```

## Labels

`needs-device-check` — contains platform code, blocked on the user.
`linux-verified` — the automated half passed.
`device-verified` — the user confirmed on hardware.
`spike` — throwaway, may be merged or closed unmerged; either is fine.

## The merge gate

This is the part that keeps `main` trustworthy.

**Merge without asking** when the PR touches only `Core/`, `web/`, `docs/`, or CI config, and Linux checks pass. These are proven; blocking them on a human wastes the one scarce resource on the project.

**Never merge on your own** any PR containing files that only Xcode can compile — `App/`, `.xcodeproj`, `project.yml`, `Info.plist`, entitlements. Merge only after the user has confirmed a successful build, ideally as a PR comment or an explicit "it builds, merge it". A verbal pass on the test plan counts; silence does not.

The reason is narrow and worth stating: `main` should always be a state the user can build. If unbuildable code lands, the next branch inherits it, and the failure is discovered later attached to the wrong change. Keeping the gate means a broken build is always attributable to exactly one PR.

Squash merge. Delete the branch. Comment on the issue with what shipped and what remains.

## Handling the user's build report

**Pass** → apply `device-verified`, merge, close the issue, report the next task.

**Compile errors** → read the first error, fix forward on the same branch, push, ask for one more build. Record any corrected API signature in `docs/api-notes.md` — that file is the project's memory of what the compiler actually accepts, and it should be read before writing platform code.

**Builds but behaves wrong** → this is design information, not a typo. Before patching, say what you expected to happen and ask which part of the observed behavior differs. Guessing at runtime behavior you can't observe is how a one-round fix turns into five.

**Two failed rounds on the same PR** → stop. Say plainly that the model of the API is wrong rather than the code, and propose one of: shrink the PR to the smallest thing that could work, have the user paste the relevant Xcode autocomplete or docs, or drop the approach.

## Releases

Tag `v0.x.0` when a phase completes. Release notes list what was device-verified — not what was merged.
