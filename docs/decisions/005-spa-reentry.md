# 005 — Scripts run once per match, not once per route change

**Date:** 2026-08-03
**Status:** accepted

## Decision

A user script's body runs when its `@match` **starts** matching, and its
cleanups run when the pattern **stops** matching. While the URL keeps matching,
navigating around inside the site does **not** re-run the body.

Scripts that need to react to route changes ask for it explicitly with
`GM_onRouteChange(fn)`.

This deliberately departs from the wrapper sketched in brainstorm §5.2, which
resets `ran = false` on every history change and re-runs the body.

## Why

The sketch's behaviour breaks pasted scripts, which are the main input this app
is designed to accept (§1: "I want to paste existing userscripts").

Third-party userscripts are written for Tampermonkey, and **Tampermonkey does
not re-run on SPA navigation** — it runs once per document. So every
well-written YouTube script already installs its own `MutationObserver` or
`yt-navigate-finish` listener to handle route changes. Re-running the body on
top of that gives the page two observers, then three, then four. The
`webkit-injection` skill names this as the most likely source of "the app gets
slow and weird after browsing for a while", and it is invisible while it
develops: nothing errors, the page just degrades.

Matching Tampermonkey's semantics means a pasted script behaves in this app the
way it behaved where it was written. That is worth more than matching the
brainstorm's sketch.

What the sketch was *right* about is the case Layer A cannot handle: an SPA
route change into a URL the script matches, with no new document. That still
works here — the pattern went from not-matching to matching, so the body runs.
That is the actual load-bearing behaviour, and it is preserved.

## Consequences

- **Re-entry is driven by the match, not the URL.** `watch → home → watch` on a
  script matching `*://*.youtube.com/*` runs the body once. On a script matching
  `*://*.youtube.com/watch*` it runs, cleans up, and runs again — because the
  pattern genuinely stopped matching in between.
- `GM_onCleanup(fn)` is called before a script stops, and again before it
  re-runs. Listeners registered through the runtime are torn down automatically.
- `GM_onRouteChange(fn)` is the supported way to do per-route work without
  re-running the whole script.
- **Pasted scripts that register no cleanup still work**, because they are not
  re-run. This is the whole point — the failure mode the sketch introduced does
  not arise.
- The one case where this is *less* convenient: a script written specifically
  for this app that wants "just re-run everything on each video" must call
  `GM_onRouteChange` instead of getting it implicitly. That is a one-line cost
  paid by scripts we control, in exchange for correctness on scripts we don't.
- Documented in `docs/userscript-api.md`, which is the contract pasted scripts
  are judged against.

## Alternatives considered

- **The brainstorm's re-run-on-every-history-change.** Rejected above: it
  silently multiplies listeners in third-party scripts, which are the primary
  input.
- **Re-run whenever `location.href` changes at all.** Strictly worse — it fires
  on query-parameter changes too, so a script re-runs when the user seeks a
  video or the site appends a tracking param.
- **Never re-run under any circumstance (pure Tampermonkey).** Rejected: it
  loses the SPA-route-into-match case, which is exactly the gap Layer B exists
  to close. A script matching `/watch*` would never start on a video the user
  navigated to from the home page.

Related: [[002-builtin-script-storage]]
