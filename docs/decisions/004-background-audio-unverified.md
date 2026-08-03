# 004 — Background audio is unverified; Phase 4 is planned PiP-first

**Date:** 2026-08-03
**Status:** accepted (revisit if the spike is ever run)

## Decision

Phase 0's question — does `UIBackgroundModes: audio` +
`AVAudioSession(.playback)` survive lock and backgrounding on real hardware —
**will not be answered**. There is no device tester available for this project.

So the project stops waiting on it. **Phase 4 is planned around tap-to-PiP**,
the one mechanism the brainstorm rates ✅ reliable (§7.1 row 1), with background
audio treated as an **opportunistic enhancement that may not work**, not as a
load-bearing assumption.

The spike itself ([#1](https://github.com/huukhanh/oriel/issues/1),
[PR #3](https://github.com/huukhanh/oriel/pull/3)) stays built and open. If a
device run ever happens, the answer is one afternoon away and this decision
gets revisited.

## Why

The roadmap already specified what to do if Phase 0 failed: re-plan Phase 4
around tap-to-PiP. An unanswerable question and a failed answer have the same
planning consequence — **you cannot build load-bearing structure on it either
way.** Treating "unknown" as "probably fine" is how a project ends up with a
feature set that collapses on first contact with hardware.

The asymmetry decides it:

- Plan PiP-first, and background audio turns out to work → a feature arrives
  early and cheap. The PiP work is not wasted; PiP is independently the more
  reliable mechanism and users want it regardless.
- Plan background-audio-first, and it turns out to be flaky → the app's central
  promise is broken, and the fix is a re-architecture of Phase 4 discovered at
  the worst possible time.

There is no version of this where betting on the unproven mechanism is correct.

## Consequences

- **`document.hidden` / `visibilityState` spoofing is promoted.** §7.1 rates it
  ✅ high value and — critically — *orthogonal* to the audio session. It fixes
  page-initiated pause, which is a real and separate failure that affects
  YouTube whether or not the media process survives. It is now a **Phase 4
  headline feature rather than an enhancement**, because it is the highest-value
  media behaviour in the app that can be reasoned about without a device.
- **PiP entry is routed exclusively through a real tap** on our toolbar button.
  Auto-PiP from `visibilitychange` is not merely unreliable, it fails silently
  (§7.1) — it is not attempted, and a future contributor should not "fix" it.
- Audio-session code still ships. It is cheap, it is required for PiP audio to
  behave, and if the platform cooperates it works. It is simply not something
  any other feature's correctness depends on.
- The app's pitch narrows honestly to **"PiP and scripting for any site"**, with
  background playback as a maybe. Better to under-promise in the README than to
  ship a headline feature that works on the developer's machine only in theory.
- **Nothing else in the project is blocked by this.** Phases 1–3 never depended
  on the answer; that was the point of front-loading them.

## Alternatives considered

- **Hold the whole project until a device run happens.** Rejected: it blocks
  every phase on an event that may never occur, and Phases 1–3 are provable
  work that is ready now.
- **Assume it works and build on it.** Rejected on the asymmetry above.
- **Drop the media features and ship a pure userscript browser.** Rejected —
  §7.1 records tap-to-PiP as reliable, so there is a real, deliverable media
  feature here. Dropping it would discard the working mechanism along with the
  doubtful one.

Related: [[001-distribution]] · [[003-minimum-ios]]
