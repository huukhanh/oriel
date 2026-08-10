# Testing Oriel on a real iPhone

**You do not need a Mac.** GitHub Actions builds the app; you install it from
your phone. First-time setup is about ten minutes, most of it waiting for one
download.

---

## 1. Get the app

Every push to `main` builds an installable `.ipa`. Two ways to get it:

**From a release** — a normal download link, works on the phone:

> https://github.com/huukhanh/oriel/releases/latest

**From the latest build** — any commit, needs a GitHub login:

> Actions → **release** → newest run → Artifacts

The artifact downloads as a `.zip` containing the `.ipa`; unzip it first.

Each release carries two files:

| File | For |
|---|---|
| `Oriel-unsigned.ipa` | A real iPhone — sideload it, or use `scripts/install-device.sh` |
| `Oriel-Simulator.zip` | The iOS Simulator on a Mac — `scripts/run-simulator.sh`, no Apple ID needed |

### Why it is unsigned, and what that means for you

Apple will not run an app that nobody has signed. Signing *in CI* would mean
uploading an Apple certificate and provisioning profile as repository secrets —
both tied to one Apple ID and a fixed list of device serial numbers. Instead the
`.ipa` ships unsigned and **you sign it on your own device with your own free
Apple ID**, using one of the tools below. No secrets are stored anywhere.

The trade: with a **free** Apple ID the signature expires after **7 days** and
the app stops opening until re-signed — one tap in SideStore/AltStore, and they
can do it automatically over Wi-Fi. A paid Apple Developer account ($99/yr)
extends that to a year.

---

## 2. Install it

Pick one. **SideStore** is the least painful if you have no Mac.

### Option A — SideStore (on-device; no computer after setup)

1. Install SideStore: <https://sidestore.io> — follow their one-time setup.
2. SideStore → **My Apps** → **+** → pick `Oriel-unsigned.ipa`.
3. Sign in with your Apple ID when asked. It is used only to sign the app.
4. Wait for the install, then find **Oriel** on your home screen.

### Option B — AltStore (computer running AltServer on the same Wi-Fi)

Same flow: <https://altstore.io>

### Option C — Sideloadly (one-off, computer + cable)

<https://sideloadly.io> — drag the `.ipa` in, enter your Apple ID, plug in the
phone, click Start.

### Option D — You have a Mac

Two one-command routes, both in `scripts/`:

```sh
git clone https://github.com/huukhanh/oriel.git && cd oriel

./scripts/run-simulator.sh      # iOS Simulator. No Apple ID, no signing.
./scripts/install-device.sh     # onto a connected iPhone.
```

**`run-simulator.sh`** downloads the simulator build from the latest release,
boots a simulator, installs and launches it. Nothing to sign and no Apple ID at
all — the fastest way to see the app. Add `--build` to compile this checkout
instead of downloading.

*It cannot test PiP, background audio or lock-screen behaviour* — simulator
media behaviour does not reflect a device. That is §4, and it needs real
hardware.

**`install-device.sh`** signs the release `.ipa` with a development identity
from your keychain and installs it over the cable. If you have never built an
iOS app on this Mac you will not have one, and it will tell you so; in that case
use:

```sh
./scripts/install-device.sh --build
```

which builds from source and lets Xcode handle provisioning — more reliable,
because Xcode can register the bundle id against your Apple ID and a
hand-signed `.ipa` cannot.

Both scripts stop with a specific message and a fix when a prerequisite is
missing, rather than half-working.

<details>
<summary>Manual Xcode route</summary>

```sh
brew install xcodegen
cd App && xcodegen generate && open Oriel.xcodeproj
```

Select your iPhone, set **Signing & Capabilities → Team** to your personal team,
press ⌘R.
</details>

### The address bar is hidden

By design — it makes the app feel like an app rather than a browser. Use the
**house** button to go somewhere else, and turn on **Settings → Show address bar
(debug)** when you are working on a script.

### First launch: "Untrusted Developer"

Expected with a personal signature. **Settings → General → VPN & Device
Management → [your Apple ID] → Trust.** Once per Apple ID, not per app.

---

## 3. Two-minute smoke test

Each step names how it fails, because "it didn't work" is not actionable.

| # | Do this | Expect | If it fails |
|---|---|---|---|
| 1 | Launch Oriel | YouTube loading, six buttons along the bottom, **no address bar** | Immediate crash → not signed correctly; reinstall |
| 2 | Tap the **lines** button (Log) | Empty — *"No output yet"* | A red `prelude.js is missing from the bundle` means the build is broken. Report it; nothing below will work |
| 3 | Tap the **{}** button | Three built-ins: **Keep playing in background**, **Force inline playback**, **Playback speed** | An empty list means the scripts did not reach the bundle |
| 6 | Settings → tap **30 minutes** under Sleep timer | The row changes to *Stops in 30 minutes*, with a Cancel | — |
| 4 | Tap the **house** button, type `example.com`, press Go | Loads `https://example.com` | — |
| 5 | House button again, type `hello world` | A DuckDuckGo **search**, not a failed navigation | — |
| 6 | House button again | The site you just visited is under **Recent** | — |

All five passing means the app and its injection engine work.

---

## 4. The media features — what to actually check

The part no automated test can reach, and the reason a real device matters.
**Two of these should work. One is genuinely unknown.**

### 4.1 Page-initiated pause — *should work*

The most valuable single test in this document.

1. Play any YouTube video.
2. **Switch to another app**, wait ~10 seconds, come back.

**Expect: still playing.** YouTube normally pauses itself the moment it thinks
you looked away; the built-in `visibility-spoof` prevents that, and it is
verified in a real WebKit engine.

**Then prove the script is what did it:** open `{}`, turn **"Keep playing in
background"** off, repeat. YouTube should now pause. That contrast is the real
test — identical behaviour both ways means the script is not running.

### 4.2 Picture in Picture — *should work*

1. Play a video.
2. Tap the **PiP** button in the toolbar (rectangle-with-arrow).

**Expect:** a floating video window that keeps playing when you leave the app.

**If nothing happens, open the Log first.** It says which half failed:

- `Picture in Picture: no-media` — no video found on the page
- `Picture in Picture: unsupported` — the site's player refuses it
- nothing logged — PiP was requested and the system declined

### 4.3 Lock screen and AirPlay — *should work*

1. Play a video, then lock the screen.
2. **Expect:** a Now Playing card with the page title, and **play/pause that
   actually stops and starts the video** — that is the part that was broken
   until v0.10.0. The 15-second skip buttons should move it too.
3. Squeeze the headphone remote, if you have one. That sends
   `togglePlayPause`, which is a different command from play or pause and was
   doing nothing at all before.
4. Tap the **AirPlay** button in the toolbar. Expect the system picker, and
   audio moving to whatever you choose.

**If the card appears but the buttons do nothing**, that is the exact shape of
the old bug — worth reporting with the model and iOS version.

### 4.4 Background audio with the screen locked — *unknown, please record*

Never verified on hardware. Per
[decision 004](docs/decisions/004-background-audio-unverified.md) the app is
deliberately built so nothing else depends on it.

1. Play a video. **Lock the screen** with the side button.
2. Listen for 60 seconds, then for 10 minutes.

Record which happened — different causes, different fixes:

| What you hear | What it means |
|---|---|
| Continues indefinitely | It works. |
| Stops **immediately** on lock | The audio session is not taking effect. |
| Stops after **~30s–3min** | WebKit's media process is being suspended. **Note the timing** — "died at 25 seconds" and "good for 8 minutes" imply different apps. |

Post the result on [issue #1](https://github.com/huukhanh/oriel/issues/1) with
your **iPhone model and iOS version** — behaviour differs across both.

### 4.5 Sleep timer

Settings → **Sleep timer** → a preset. Play something and leave it.

**Expect:** playback stops when the deadline passes, *including if the phone was
locked the whole time*. It is checked against a wall-clock deadline rather than
a countdown, precisely because a timer does not run while the app is suspended.

---

## 5. Writing a script (the point of the app)

1. `{}` → **New**. The template already changes the page, so it demonstrates
   itself.
2. Change `@match` to `*://*.example.com/*`.
3. Tap **Run on this page now** — no save, no reload.
4. Open the Log. Expect `it ran`.
5. Go to `wikipedia.org` and reload. Expect **nothing** — the match guard is
   stopping it, which is the whole safety mechanism.
6. Type a broken `@match` such as `nonsense`. Expect a warning naming the line,
   and the list showing **"matches nothing — will never run"**. It must never
   silently match everything.

**If a script throws**, the Log button in the toolbar turns into an orange
warning with a count. You do not have to go looking.

### Playback speed

On any page with a video, a small `−  1x  +` control sits above the toolbar.
It goes to 4x, remembers your choice per site, and re-applies itself when a
site swaps the player — which is what makes it stick on an SPA where the
built-in menu resets every video.

**`@run-at` matters more than it looks.** `document-end` is the default and is
what you want for anything that reads or changes the page — at
`document-start` there is no `document.body` yet, so a DOM tweak throws. Use
`document-start` only to override page behaviour before the site's own scripts
run.

Pasted Tampermonkey scripts generally work as-is. Differences are in
[`docs/userscript-api.md`](docs/userscript-api.md) — most importantly
`GM_getValue` is `async` here.

---

## 6. Debugging with a Mac (optional, but the strongest tool available)

`isInspectable` is on in debug builds, so Safari can attach to the app's webview
and give you a real console on the device.

1. iPhone: **Settings → Safari → Advanced → Web Inspector** on.
2. Mac Safari: **Settings → Advanced → Show features for web developers** on.
3. Connect by cable, run the app, then Mac Safari → **Develop** → *your iPhone*
   → the page.

If a bug is inside injected JavaScript this turns guesswork into a stack trace.
Grab the in-app Log too — it captures document-start activity that Web Inspector
misses if you attach late.

---

## 7. Reporting a problem

Post to [Issues](https://github.com/huukhanh/oriel/issues) with:

1. **Which step** failed, and what happened instead.
2. **iPhone model and iOS version** — essential for anything media-related.
3. **The Log contents** (Log sheet → **Copy**), verbatim rather than summarised.
4. Any **install** error verbatim, if it never launched.

---

## 8. What is already proven, so you can skip suspecting it

Checked automatically on every push.

| Layer | How |
|---|---|
| Match compiling, metadata parsing, wrapper generation, settings, storage, URL parsing | 86 unit tests |
| Injection runtime, SPA re-entry, CSP, both built-ins, media bridge | 31 tests in a **real WebKit engine** |
| Compiles against the real iOS SDK, Swift 6, strict concurrency | macOS CI |
| Content worlds, the message bridge, `GM_setValue`, the editor's smart-quote settings | 16 tests against a real `WKWebView` |
| The app launches and its screens present | 7 UI tests in the simulator |
| The `.ipa` is arm64, has its executable, contains all three scripts | packaging checks |

**Not covered by any of that:** everything in §4. That is where your phone is the
only instrument.
