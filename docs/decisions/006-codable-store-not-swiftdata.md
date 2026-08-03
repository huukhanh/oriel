# 006 — Persistence is a Codable file store in `Core`, not SwiftData

**Date:** 2026-08-03
**Status:** accepted — supersedes the persistence half of
[003](./003-minimum-ios.md)

## Decision

Drop SwiftData. All persistence is a plain `Codable` store living in the `Core`
package: one atomically-written JSON document holding scripts, bookmarks,
settings, built-in enabled-state, and per-script `GM_setValue` data.

The deployment target stays iOS 18 and Swift 6 — only the persistence choice
changes.

## Why

Decision 003 chose SwiftData because the brainstorm's §3 diagram says
`ScriptStore (SwiftData)`. It also noted, while rejecting the iOS 17 option,
that hand-rolling a store "would push *more* code into Core and therefore more
code under test, which is genuinely attractive on this project."

That was the right observation attached to the wrong decision, and the reason it
was wrong has since become decisive: **there is no device tester**
([004](./004-background-audio-unverified.md)). Under SwiftData the entire
storage layer — the schema, the fetches, the migrations, every read and write
the app depends on — is code that no one on this project can compile, run, or
test. Under a Codable store in `Core` it is all Foundation, and all of it is
covered by tests that run here in milliseconds.

The trade SwiftData offers is querying and change-tracking at scale. This app
has a few dozen scripts and a handful of bookmarks. It is a list, edited by one
person, on one device. Paying for a database in unverifiable code to manage a
list is a bad trade under any circumstances and an indefensible one here.

## Consequences

- **The storage layer becomes provable.** Round-trips, defaults, corrupt-file
  recovery, and ordering are all Linux-tested. That is a large fraction of
  Phase 2 moved out of the blind zone.
- The app target shrinks to pointing the store at a directory. No `@Model`, no
  `ModelContainer`, no schema, no migration plan.
- **No migration machinery, because there is a real one:** the store carries a
  `version` field and decoding is tolerant — unknown fields are ignored,
  missing fields take defaults. A malformed file is backed up and replaced with
  defaults rather than crashing the app on launch, since an unopenable app
  cannot be used to fix its own data.
- Writes are whole-document and atomic. At this size that costs nothing and
  removes partial-write corruption entirely.
- Nothing about Swift 6 or iOS 18 changes; [003](./003-minimum-ios.md) stands
  apart from its persistence sentence.
- If this app ever grew to thousands of scripts, revisit. It will not.

## Alternatives considered

- **SwiftData as originally planned.** Rejected: it puts the most
  correctness-critical layer in the one place that cannot be verified, in
  exchange for scale this app will never need.
- **SQLite via a Swift wrapper.** Same objection, plus a dependency, and v1 has
  a no-third-party-deps rule.
- **`UserDefaults`.** Fine for a few toggles, wrong for script sources — and it
  would split state across two mechanisms for no gain.

Related: [[003-minimum-ios]] · [[002-builtin-script-storage]]
