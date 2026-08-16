# Oriel on iPhone, iPad and Mac

Safari extensions are not files you download. They ship inside an app, and the
app has to be signed by someone. Apple's model, not a choice this project made —
it is the reason this page is longer than "install the extension".

## What you need

- **A Mac**, once, to sign the app. Any Mac with Xcode's command line tools.
- **A free Apple ID.** No paid developer account. The trade is that a free
  signature **expires after seven days** and the app has to be re-signed.
- An iPhone or iPad running **iOS 16.0 or later**.

If you only want Oriel on a Mac, it is considerably simpler — skip to
[On a Mac](#on-a-mac).

## The short version

```sh
git clone https://github.com/huukhanh/oriel && cd oriel
pnpm install && pnpm build
brew install xcodegen && cd apple && xcodegen generate && open Oriel.xcodeproj
```

In Xcode: select the **Oriel** scheme, pick your device, set your team on both
the `Oriel` and `Oriel Extension` targets under Signing & Capabilities, and press
Run.

Then on the phone:

1. **Settings → Apps → Safari → Extensions** (on iOS 17 and earlier:
   **Settings → Safari → Extensions**).
2. Turn on **Oriel**.
3. Tap it, and set the sites you want it to change to **Allow**. Oriel cannot
   touch a page it has not been given access to.
4. In Safari, tap the **page menu** at the left of the address bar, then
   **Oriel**.

## Without a Mac of your own

CI builds an unsigned `.ipa` on every tagged release:
**[releases/latest](https://github.com/huukhanh/oriel/releases/latest)**, or run
the `apple` workflow manually to build one from any commit.

An unsigned `.ipa` still needs signing before a phone will run it. Tools that do
it with your own Apple ID: [SideStore](https://sidestore.io),
[AltStore](https://altstore.io), [Sideloadly](https://sideloadly.io). After
installing, **Settings → General → VPN & Device Management** and trust the
certificate.

The seven-day expiry applies here too. When Oriel stops opening, re-sign it —
your skins are stored by Safari and survive.

## On a Mac

The same project builds a Mac app. Build and run it once, then
**Safari → Settings → Extensions** and tick Oriel. Safari on macOS will warn that
the extension is from an unidentified developer until you enable
**Develop → Allow Unsigned Extensions**, which resets when Safari restarts.

## When something is wrong

**Oriel is not in the Extensions list.** The app did not install, or the
extension did not get embedded in it. Check that `dist/safari/manifest.json`
existed before the Xcode build — the build fails loudly if it did not, but a
stale build directory can hide that. `pnpm build` then build again.

**Oriel is listed but nothing happens on any site.** Almost always site access.
Settings → Apps → Safari → Extensions → Oriel, and check the site is set to
Allow. Safari defaults to asking, and "Ask" means "no" until you answer.

**A skin's JavaScript does nothing, but its colours work.** Expected on some
platforms and not a bug in the skin. Open the manager → Settings → Capabilities;
it says in one line whether this browser lets extensions run code they
downloaded. Whether Safari does is
[an open question](VERIFICATION.md#the-one-platform-fact-that-was-measured-rather-than-assumed)
— if you are testing on a device, that line is the single most useful thing you
can report back.

**A skin applies, but the page flashes unstyled first.** Worth reporting with
the site name. Oriel injects at `document_start`, but on Safari it cannot push
stylesheets at navigation-commit time the way it can elsewhere, so a slow page
has a window where this is possible.

**Everything worked and now the app will not open.** Seven days passed. Re-sign.

## What Oriel sends anywhere

Nothing, except when you ask it to fetch a skin. Installing from a link fetches
that URL with no cookies attached; update checks fetch the skin's `updateURL` on
the schedule you chose in Settings, and can be turned off entirely. Skins are
stored on the device by Safari. There is no account and no server.
