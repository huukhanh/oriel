---
name: device-testing
description: Writing the manual test instructions the user runs on their Mac, simulator, and real iPhone — including the build recipe, what the simulator can and cannot prove, per-PR test plans, and how to ask for useful failure reports. Use this skill whenever preparing a PR that contains platform code, when the user asks how to test something, when creating or updating TESTING.md, or when a reported failure needs narrowing down. Trigger it before handing any work back to the user for verification — an untestable handoff wastes their build cycle.
---

# Device testing handoff

The user is the only instrument. A test plan they can't follow without thinking is a wasted round trip, and rounds are the scarce resource.

## TESTING.md

Lives at the repo root, maintained by you, appended to as features land. Structure:

1. **Setup** — Xcode version, clone, `xcodegen generate` if used, signing team, bundle id, which capabilities must be on (Background Modes → Audio, AirPlay, and PiP). Signing and capabilities are where first-time builds die; be specific.
2. **Build recipes** — simulator and device, both from Xcode and from the command line (`xcodebuild -scheme App -destination 'platform=iOS Simulator,name=iPhone 16'`). CLI recipes let the user paste output back verbatim.
3. **Smoke test** — the five steps that prove the app isn't fundamentally broken. Runs after every merge to `main`, takes under two minutes.
4. **Feature suites** — one section per subsystem, grown as features land. Each numbered, each with an explicit expected result.
5. **Known-broken** — things currently failing, with issue links, so the user doesn't re-report them.

## Simulator vs. real device

Getting this wrong burns the user's time on tests that cannot succeed.

**Simulator is sufficient for**: navigation, layout, the script list and editor, storage and migrations, `@match` behavior against real sites, console/log view, import/export, settings persistence, the config-rebuild-and-restore path.

**Real device required for**: anything about Picture-in-Picture, background audio, screen-lock behavior, the Now Playing lock-screen controls, AirPlay, route changes (headphones in/out), interruptions (phone call), idle-timer behavior, and real-world performance on large pages. Simulator media behavior does not reflect the device and a simulator pass here means nothing.

Label every test step with which one it needs. When a whole plan needs hardware, say so in the first line so the user doesn't start in the simulator.

## Writing a plan

Each step: an action, an expected result, and — where it's genuinely ambiguous — how to tell pass from fail. Prefer observations that don't require judgement.

Good:
```
3. With the video playing, lock the screen. Wait 60 seconds.
   Expect: audio continues without a gap; lock screen shows title and artwork
           with working play/pause.
   Fail signals: audio stops immediately (session config), stops after ~30s
           (media process suspension — note the exact timing, it distinguishes
           the two causes), or lock screen shows no controls (Now Playing not
           populated).
```

Weak: "check that background playback works."

Naming the fail modes matters more here than on a normal project: the user's report is the only diagnostic signal available, and "it didn't work" is not actionable, while "it played for about 25 seconds then cut" points straight at a cause.

## Web Inspector is the strongest tool available

`webView.isInspectable = true` in DEBUG (iOS 16.4+) lets Safari on the Mac attach to the app's webview — Develop menu → device name → the page. Real console, real DOM, real breakpoints, on-device.

Whenever a failure is inside injected JS, the ask is not "does it work" but "attach Safari Web Inspector and paste the console output". That converts a guessing game into a stack trace. Put the attach instructions in TESTING.md once, then reference them; don't retype them per PR.

Ask for the in-app log view's contents too, since it captures document-start activity that Web Inspector may miss if attached late.

## Asking for failure reports

Request, in this order:
1. Which step failed, and what happened instead.
2. Verbatim Xcode errors, or verbatim console output — not a summary. Paraphrased error messages lose the part that identifies the cause.
3. Device model and iOS version, if media-related. Behavior differs across versions.
4. Whether it also fails in the simulator, if the test allows it — that narrows platform-specific vs. logic bugs immediately.

Say what you'll do with the answer, so the user knows which detail matters.

## Phase 0 spike plan

The background-audio spike deserves a purpose-built plan, because it decides the roadmap. Test against at least two different sites, on a real device, checking: playback continues after backgrounding; after screen lock; past 60 seconds; past 10 minutes; through an incoming notification; and whether the page pauses itself (visible on reopen as a paused player) versus the audio session dying (audio stops, player still shows playing). Those two failure modes have different fixes and only the second one blocks the roadmap — make sure the plan distinguishes them.
