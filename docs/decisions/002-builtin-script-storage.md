# 002 — Built-in scripts ship as read-only bundle resources

**Date:** 2026-08-03
**Status:** accepted

## Decision

Built-in scripts (`visibility-spoof`, `playsinline`, `speed-hud`, and the rest
of §10) ship as **read-only files in the app bundle**. The persistent store
holds only per-built-in *state* — enabled/disabled, ordering, and GM key-value
data — keyed by a stable built-in id. Built-in source is never copied into the
database.

"Duplicate & edit" (§2) creates an ordinary **user** script with a new id,
seeded from the built-in's source. The built-in itself is untouched and stays
enabled or disabled independently.

## Why

The brainstorm wants built-ins to be inspectable, editable, and updatable
without an app update (§2). Seeding them as database rows satisfies the first
two and breaks the third: once a row is user-editable, shipping a new version
of that script means diffing against possible local edits and deciding whose
version wins. That is a migration problem, and it recurs on every release.

Bundle resources make it a non-problem. App source updates with the app; user
edits live in a separate row that was never claimed to be the built-in.

## Consequences

- Schema is smaller: no `isBuiltIn` flag, no `originalSource` column for reset,
  no seed-on-first-launch step, no version field for migration.
- Built-in state rows can outlive their script (built-in removed in a later
  version). State keyed by an unknown id is ignored and pruned — cheap.
- The scripts list UI (§6) reads from two sources and merges: bundle built-ins
  plus stored user scripts. Slightly more work in the list view; a lot less
  work everywhere else.
- Ordering spans both sets, so the order index must live in the store for
  built-ins too, not just user scripts.
- A built-in cannot be edited in place. Editing opens the duplicate flow.
  This must be obvious in the editor UI, not a silent no-op on save.
- Built-in sources are authored in `web/src/builtins/` and unit-tested under
  Node before they are ever bundled — see [[003-minimum-ios]] for why keeping
  logic out of platform code matters here.

## Alternatives considered

- **Seeded database rows** — one code path for the list UI and free in-place
  editing. Rejected: the fork-then-update migration problem is permanent, and
  it buys convenience in the one place (a list view) where merging two arrays
  is trivial.

Related: [[001-distribution]]
