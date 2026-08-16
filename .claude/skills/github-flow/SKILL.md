---
name: github-flow
description: Branch, commit, PR, review-response and merge conventions for this project, including the verification gate that decides when a PR may be merged. Use this whenever creating a branch, writing commits, opening or updating a pull request, responding to a device report, or merging anything. Trigger it any time the user says "make a PR", "merge it", "ship it", "it builds", "it's broken", or asks about repo state. It defines when merging is and is not allowed — check it before every merge.
---

# Git and PR flow

Uses `gh`. Confirm auth once per session with `gh auth status`.

## Branches

`<type>/<issue>-<slug>` — `feat/12-usercss-vars`, `fix/31-spa-teardown`,
`chore/8-ci`. Types: `feat`, `fix`, `spike`, `chore`, `docs`, `refactor`.

Branch from up-to-date `main`. One issue per branch. If a task turns out to be
two things, split it — a PR that mixes provable web work with blind Swift forces
the whole thing to be reviewed at the strictness of the blind half.

## Commits

Conventional commits, scoped to the module: `feat(core)`, `fix(content)`,
`test(e2e)`, `feat(tools)`, `docs`.

The body explains **why**, and says what is unverified. The most valuable commit
messages in this repository are the ones recording a measurement — that Chromium
blocks `eval` in content scripts, that a `<style>` element loses to
`style-src 'self'`. Those cost hours to find and a sentence to record.

Never use `--no-verify`. Never force-push a branch the user has already pulled.

## PR body

`.github/pull_request_template.md` holds the shape. Fill every section, and be
exact in the two that matter:

```
## Proven
lint clean · 724 unit · 24 e2e (chromium + webkit)

## Not proven
Everything under apple/ — no Swift toolchain here.
Everything about Safari's extension host — no Safari anywhere in the loop.
```

If a change alters behaviour on Safari specifically, say what you expect and how
a person with a phone could tell whether it happened.

## The merge gate

**Merge on your own** when CI is green and the PR touches only `extension/`,
`tools/`, `test/`, `e2e/`, `skins/`, `docs/` or CI config. These are proven here;
blocking them on a human wastes the one scarce resource on the project.

**Do not merge on your own** a PR whose *behaviour on a device* is the point —
anything changing how skins reach the page on Safari, the container app's setup
flow, or the extension's permissions. Those need a device report first.

`apple/` compiles in CI (`.github/workflows/apple.yml`, manual and tag-only,
macOS runners are ten times the price). A green run means the Swift builds and
the web extension landed inside the `.appex`. It does **not** mean anything
works on a phone — only issue #61-style device reports do that.

Squash merge and delete the branch, unless the PR is a large piece of work whose
individual commits carry reasoning worth keeping; then use a merge commit and
say why.

Comment on the issue with what shipped and what remains.

## Handling a device report

**Pass** → merge, close the issue, say what is now known that was not.

**Build errors** → read the *first* error only; Swift cascades are noise after
it. Fix forward on the same branch, push, ask for one more build.

**Builds but behaves wrong** → this is design information, not a typo. Say what
you expected before proposing a patch. Guessing at runtime behaviour you cannot
observe is how a one-round fix turns into five.

**Two failed rounds on the same PR** → stop. Say plainly that the model of the
platform is wrong rather than the code, and propose shrinking the change to the
smallest thing that could work.

Record anything learned about the platform in the `extension-injection` skill or
`docs/VERIFICATION.md`. Those files are the project's memory of what is actually
true, and they should be read before writing platform code, not after.

## Releases

Tag `v0.x.0`. The `apple` workflow builds and attaches an unsigned `.ipa` on a
tag. Release notes list what was **device-verified** — not what was merged.
