# 007 — Platform PRs may merge on a green Linux typecheck

**Date:** 2026-08-03
**Status:** accepted — amends the merge gate in `.claude/skills/github-flow`

## Decision

A PR containing platform code (`App/`, `project.yml`, `Info.plist`) may be
merged once CI is green, **including `swift build --package-path App`**, without
waiting for someone to build it in Xcode.

The one exception stays: **`Spike/` is not covered by the typecheck harness**,
so [PR #3](https://github.com/huukhanh/oriel/pull/3) remains unmerged.

## Why

The gate says: *never merge platform code until the user confirms a successful
build*, because "`main` should always be a state the user can build. If
unbuildable code lands, the next branch inherits it, and the failure is
discovered later attached to the wrong change."

Two things have changed since that was written.

**There is no user who builds** ([004](./004-background-audio-unverified.md)).
The gate's condition can never be satisfied, so applied literally it does not
protect `main` — it just means the app never reaches `main` at all. A repository
whose default branch contains no app is not a safer state; it is an emptier one.

**There is now a real build signal.** `App/Package.swift` compiles the actual
app sources, in Swift 6 language mode, against stub frameworks. That catches
typos, type errors, wrong argument labels *within our own code*, and actor
isolation — which is the largest category of blind-Swift failure. It is a much
weaker signal than Xcode, but it is not nothing, and it is a signal the gate's
author did not have.

The gate's real purpose — **attributability**, so a broken build points at one
PR — is preserved either way. All the platform code arrives in one PR, and
`docs/api-notes.md` records exactly which assumptions would be the cause.

## Consequences

- Platform PRs merge on green CI. The `needs-device-check` label still goes on
  them, and they still carry a device test plan, because both are still true.
- **`main` is "typechecked", not "known to build".** Nothing in the repo may
  claim otherwise. `TESTING.md` opens with a table separating proven from
  assumed, and the app's own status stays *compiles-unknown*.
- If someone with a Mac ever builds it and it fails, the first error goes in
  `docs/api-notes.md` and the fix is a normal PR. That is the loop the gate was
  protecting, and it still works — it just starts later.
- **Reverting is easy** if a device tester appears: restore the gate as written,
  since by then the condition would be satisfiable again.

## Alternatives considered

- **Keep the gate literally.** Rejected: it strands the entire app on a branch
  forever in exchange for a guarantee that can no longer be obtained. That is
  following the letter of a rule at the cost of the thing the rule protects.
- **Merge the spike too.** Rejected: `Spike/` has no typecheck coverage at all,
  so the new justification does not apply to it. It is also a throwaway, and the
  gate explicitly allows spikes to stay unmerged.

Related: [[004-background-audio-unverified]]
