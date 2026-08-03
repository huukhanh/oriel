# Testing

The dev box is headless Ubuntu with no Xcode, no simulator, and no compiler.
Everything in this file runs on your Mac and your iPhone. You are the only
instrument the project has, so each plan below states an action, an expected
result, and the ways it can fail — "it didn't work" is not actionable, but
"the audio cut at about 25 seconds" points straight at a cause.

---

## 1. Setup

**Requires:** Xcode 16 or later (deployment target is iOS 18, per
`docs/decisions/003-minimum-ios.md`), and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

No `.xcodeproj` is checked in. Project files are generated from `project.yml`,
because hand-authoring `project.pbxproj` on a machine with no Xcode corrupts it
in ways that are slow and confusing to diagnose.

```sh
brew install xcodegen        # once
git clone git@github.com:huukhanh/oriel.git
cd oriel
```

### Signing

Signing is where first-time builds die. Per
`docs/decisions/001-distribution.md` this project uses **personal signing with
a free Apple account**:

1. Xcode → Settings → Accounts → add your Apple ID if it isn't there.
2. Open the generated project, select the target → **Signing & Capabilities**.
3. **Team**: your personal team. **Signing**: Automatic.
4. If you get *"Unable to register bundle identifier"*, the ID is taken.
   Change `PRODUCT_BUNDLE_IDENTIFIER` in `Spike/project.yml` to something
   personal (e.g. append your initials) and re-run `xcodegen generate`.

Two things about free accounts that will bite:

- **Builds expire after 7 days.** The app stops launching; rebuild from Xcode.
- **10 App IDs per 7 days.** Don't mint a new bundle ID per experiment — reuse
  one. This is why the spike has an in-app site picker instead of a hardcoded
  URL requiring three separate builds.

> `xcodegen generate` **overwrites the project file**, which resets the Team
> you picked in the UI. After regenerating, re-select the Team. If that gets
> annoying, add `DEVELOPMENT_TEAM: XXXXXXXXXX` under `settings: base:` in
> `project.yml` — your team ID is in Xcode → Settings → Accounts.

### Capabilities

Background audio needs **`UIBackgroundModes: audio` in Info.plist**, which
`project.yml` already sets — it is not an entitlement and does not need a paid
account. You should see **Background Modes → Audio, AirPlay, and Picture in
Picture** already ticked under Signing & Capabilities. If that row is absent
entirely, the generate step didn't pick up the `info:` block; say so, because
every background test below would then fail for a reason that has nothing to do
with WebKit.

---

## 2. Build recipes

### Phase 0 spike

```sh
cd Spike
xcodegen generate
open BackgroundAudioSpike.xcodeproj
```

Then select your iPhone as the destination and ⌘R.

Command line, if you'd rather paste output back verbatim:

```sh
cd Spike
xcodegen generate
xcodebuild -project BackgroundAudioSpike.xcodeproj \
           -scheme BackgroundAudioSpike \
           -destination 'generic/platform=iOS' \
           build 2>&1 | tail -40
```

For a simulator build (useful only for the comparison in step D below):

```sh
xcodebuild -project BackgroundAudioSpike.xcodeproj \
           -scheme BackgroundAudioSpike \
           -destination 'platform=iOS Simulator,name=iPhone 16' \
           build 2>&1 | tail -40
```

---

## 3. Attaching Safari Web Inspector

`isInspectable` is on in DEBUG builds, so Safari on the Mac can attach to the
app's webview and give you a real console, DOM, and breakpoints on device.

1. iPhone: Settings → Safari → Advanced → **Web Inspector** on.
2. Mac Safari: Settings → Advanced → **Show features for web developers** on.
3. Connect by cable, run the app, then Mac Safari → **Develop** → *your iPhone*
   → the page.

Whenever a failure is inside injected JavaScript, this is the ask — attach and
paste the console, rather than describing the symptom. Referenced from later
plans; it isn't repeated.

---

## 4. Phase 0 — background audio spike ([#1](https://github.com/huukhanh/oriel/issues/1))

> **Real device only.** Simulator media behaviour does not reflect the device.
> A simulator pass here proves nothing; it is measured in step D purely to
> document how much it lies.

This plan decides the roadmap. Phase 4 is either "background playback for any
site" or "PiP for any site" depending on the result, and those are different
apps.

### How the app reports

The bottom bar shows:

| Field | Meaning |
|---|---|
| `elapsed` | Wall clock in Swift. Keeps counting no matter what WebKit does. |
| `beats` | Heartbeats from the injected JS probe, one per second. |
| `PLAYING` / `silent` | Whether a media element reports itself as playing. |
| `media t=` | The video/audio element's own `currentTime`. |
| `worst gap` | Longest interval with **no** heartbeat. Red above 3s. |

**`elapsed` and `beats` diverging is the whole measurement.** If 600 seconds
elapse and only 200 beats arrive, JavaScript was frozen for 400 of them.

**Copy transcript** puts the full timestamped log on the clipboard. Paste that
into the issue — it is the deliverable, not your summary of it.

> If `beats` never leaves 0, open **View** first. A `PROBE  Probe.js missing
> from bundle` line means the JS resource didn't make it into the app and the
> measurement is not running — stop, report that, and don't spend ten minutes
> on a test that cannot produce a result.

### The two failure modes, and why they are not the same

This is the distinction the whole spike exists to draw:

| What you observe on returning | Cause | Blocks the roadmap? |
|---|---|---|
| Heartbeats **continued**, `media t=` **did not advance**, player shows paused | **The page paused itself** (YouTube does this on `visibilitychange`). The media process was alive; the site chose to stop. | **No.** Fixed by the `document.hidden` spoof — already planned as a built-in script. |
| Heartbeats **stopped** (`worst gap` ≈ time backgrounded), `media t=` frozen | **WebKit's media process was suspended.** Nothing JS-side was running to pause anything. | **Yes.** This is the one that forces Phase 4 to be re-planned around tap-to-PiP. |
| Heartbeats continued **and** `media t=` advanced ≈ wall time | **It works.** | No — Phase 4 proceeds as planned. |

Record which one you saw. They have different fixes and only the second one
changes the plan.

### Test A — backgrounding (device)

1. Launch, leave the site picker on **Control**, tap **Reset**.
2. Tap **Play**. Confirm the beep, and that the bar shows `PLAYING` green with
   `beats` climbing once a second.
3. Press the **home gesture** to background the app. Keep the screen on.
4. Wait **60 seconds**, listening.
5. Reopen the app. Tap **View**.

   Expect (pass): audio beeped throughout; transcript line reads
   `media advanced ~60.0s while backgrounded`; `worst gap` under 3s.

   Fail signals — note which:
   - Audio stopped **immediately** → audio session category never took effect.
     Check that step 1 of §1 Capabilities actually shows Background Modes.
   - Audio stopped after **~30 seconds** → media process suspension. Note the
     exact timing from the `STALL` line; the number distinguishes causes.
   - Audio continued but `beats` froze → media kept playing while JS was
     suspended. Unusual and worth reporting precisely.

### Test B — screen lock (device)

1. Reset, play again, confirm `PLAYING`.
2. **Lock the screen** with the side button. Do not background first.
3. Wait **60 seconds**, listening.
4. Unlock, reopen, **View**.

   Expect: audio continues through the lock without a gap.

   Note separately whether the **lock screen showed any media controls**. The
   spike does not populate Now Playing, so absent controls are expected — but
   if playback *stops the moment the lock screen appears*, that is the audio
   session, not the media process.

### Test C — ten minutes (device)

The question that most matters, because short tests pass on hardware that
still fails at length.

1. Reset, play, background the app, lock the screen.
2. Leave it **10 minutes**. Do something else.
3. Return, unlock, reopen, **Copy transcript**.

   Expect: `beats` ≈ `elapsed`, `worst gap` under 3s, `media advanced ~600s`.

   If it died: **the transcript's `STALL` line gives the exact second**. That
   number is the single most valuable output of this entire spike — it is the
   difference between "unreliable after 30s" and "good for 8 minutes", and
   those imply different apps.

### Test D — per site, and the simulator comparison

Repeat **Test A** (60 seconds is enough) for each:

1. **Control** — plain `<audio>`, locally generated tone, no network, no MSE.
   The baseline. If this fails, everything fails and the site is not the cause.
2. **YouTube** — tap through to any video. Expect this one to fail *differently*:
   YouTube pauses itself on `visibilitychange`, so watch for the
   heartbeats-continued-but-`media t=`-frozen signature in the table above.
3. **Custom** — type any other media site you actually use. A second real-world
   data point is worth more than a second synthetic one.

Then build to the **simulator** and run Test A once against **Control**. Record
the result. Only the device answers count; this is documentation of the gap.

### Test E — interruption (device)

1. Play, background the app.
2. Trigger a notification with sound, or have someone call you.
3. After it clears, check whether audio resumed.

   Expect: audio ducks or pauses, then resumes. If it never resumes, that is an
   interruption-handling gap — the spike does not handle
   `AVAudioSession.interruptionNotification` yet, and knowing whether it needs
   to is part of Phase 4's scope.

### Reporting back

Paste into [#1](https://github.com/huukhanh/oriel/issues/1):

1. **Device model and iOS version.** Media behaviour differs across versions
   and the result is meaningless without it.
2. **Which of the three outcomes** in the failure-modes table you saw, per site.
3. **The transcript**, verbatim, from Copy transcript — not a summary. The
   `STALL` timings are the finding.
4. Any **Xcode build errors** verbatim, if it didn't build at all.

What happens next with it: if background audio holds, Phase 4 is built around
it and the `document.hidden` spoof becomes an enhancement. If it fails, Phase 4
gets re-planned around tap-to-PiP — the one mechanism rated reliable — and I
rewrite the roadmap before writing any more code.

---

## 5. Smoke test

Not yet — there is no app target, only the Phase 0 spike. This section gets
filled in when Phase 2 lands the shell.

---

## 6. Known broken

Nothing recorded yet. Failures found on device get listed here with their issue
link, so you don't re-report them.
