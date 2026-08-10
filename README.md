# Oriel

A minimal iOS browser that lets you **run your own scripts on any page**, and
**force Picture-in-Picture and background playback** for video.

One webview, a bookmark launcher, and an injection engine — the scripting layer
is the product. The media features are not a separate system: they are built-in
scripts that the settings toggles enable.

[![linux-checks](https://github.com/huukhanh/oriel/actions/workflows/linux-checks.yml/badge.svg)](https://github.com/huukhanh/oriel/actions/workflows/linux-checks.yml)
[![ios-build](https://github.com/huukhanh/oriel/actions/workflows/ios-build.yml/badge.svg)](https://github.com/huukhanh/oriel/actions/workflows/ios-build.yml)
[![release](https://github.com/huukhanh/oriel/actions/workflows/release.yml/badge.svg)](https://github.com/huukhanh/oriel/actions/workflows/release.yml)

## Install it on your iPhone

**No Mac required.** CI builds an installable `.ipa` on every push.

1. Download the latest build:
   **[releases/latest](https://github.com/huukhanh/oriel/releases/latest)**
2. Install it with [SideStore](https://sidestore.io),
   [AltStore](https://altstore.io) or [Sideloadly](https://sideloadly.io) and
   your own free Apple ID.
3. **Settings → General → VPN & Device Management → Trust.**

Full steps, including what to do when something fails:
**[TESTING.md](TESTING.md)**.

**Building it yourself on a Mac?** One command:

```sh
brew install xcodegen && ./scripts/install-device.sh
```

Setup that a script cannot do — Developer Mode, pairing, signing, trusting the
certificate — plus the errors you will actually hit:
**[docs/DEVICE-SETUP.md](docs/DEVICE-SETUP.md)**.

> The build is unsigned on purpose — you sign it with your own Apple ID, so no
> Apple certificates live in this repo. With a free Apple ID the signature
> lasts 7 days before it needs re-signing.

## What it does

- **Userscripts** — paste a Tampermonkey script, or write one on the phone.
  `@match`, `@run-at`, `@world`, a GM shim, and an in-app log so you can see
  what your script did. See [`docs/userscript-api.md`](docs/userscript-api.md).
- **Keep playing in background** — stops sites that pause themselves the moment
  you switch away. Shipped as an editable built-in script, so when a site
  changes you patch the script instead of waiting for an app update.
- **Force inline playback**, a **Picture-in-Picture** button, an **AirPlay**
  picker, and lock-screen controls that actually drive the page.
- **Playback speed** on any video, remembered per site, and a **sleep timer**.
- **Persistent logins**, desktop/mobile user agent, bookmark launcher.

## How it is verified

There is no Mac in this project's development loop, so verification is
unusually load-bearing. Every push runs:

| What | Where |
|---|---|
| 86 unit tests — matching, parsing, wrapper generation, storage | Linux |
| 31 tests in a **real WebKit engine** (Playwright's WPE/GTK build) | Linux |
| Compile against the **real iOS SDK**, Swift 6, strict concurrency | macOS CI |
| 16 tests against a **real `WKWebView`** — content worlds, the JS↔Swift bridge | iOS Simulator |
| 7 UI tests driving the app | iOS Simulator |
| `.ipa` is arm64, has its executable, contains every script | packaging |

What that cannot cover — PiP actually opening a window, and whether audio
survives a screen lock — is [TESTING.md §4](TESTING.md#4-the-media-features--what-to-actually-check).

## Repository layout

```
Core/     Foundation-only Swift. Matching, parsing, wrappers, storage. Fully tested on Linux.
web/      Injected JavaScript: the runtime, the built-in scripts, and their tests.
App/      The iOS app. Also a stub-framework harness that typechecks it on Linux.
docs/     Roadmap, the userscript API contract, and decision records.
```

Design decisions that shaped the app — and the reasoning behind the ones that
went against the original plan — are in
[`docs/decisions/`](docs/decisions/).
