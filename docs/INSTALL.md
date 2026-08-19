# Installing Oriel

Oriel is a browser for **iPhone, iPad and Mac**. It is not in any app store —
you build it, or you sign a build someone else made, with your own Apple ID.
That is Apple's model for software distributed outside the store, not a choice
this project made, and it is the reason this page is longer than "download it".

## On a Mac

The easy one. A Mac can build and run it directly.

```sh
git clone https://github.com/huukhanh/oriel && cd oriel
pnpm install && pnpm build
brew install xcodegen
cd apple && xcodegen generate && open Oriel.xcodeproj
```

Pick the **Oriel (macOS)** scheme and press Run. macOS 13 Ventura or later.

Gatekeeper will not complain about an app you built yourself. If you move it to
another Mac it will, and the answer there is right-click → Open, once.

## On an iPhone or iPad

iOS 16.4 or later. Two routes.

**With a Mac** — the same clone as above, then pick the **Oriel** scheme and your
device, set your team on both the `Oriel` and `Oriel Extension` targets under
Signing & Capabilities, and press Run.

**Without a Mac** — CI builds an unsigned `.ipa` on every tagged release:
**[releases/latest](https://github.com/huukhanh/oriel/releases/latest)**, or run
the `apple` workflow manually to get one from any commit. Sign and install it
with [SideStore](https://sidestore.io), [AltStore](https://altstore.io) or
[Sideloadly](https://sideloadly.io) using your own Apple ID, then
**Settings → General → VPN & Device Management** and trust the certificate.

> **A free Apple ID signature lasts seven days.** When Oriel stops opening,
> re-sign it. Your skins are stored on the device and survive.

## What you get

A browser. Open it, type a URL, and it works like any other. The difference is
what you can do to it:

1. Tap the toolbar's Oriel button to open the skin manager.
2. **Add → Paste** a skin's source, or **Add → Link** a GitHub URL:
   `https://github.com/you/hn-rebuilt/blob/main/hn.user.css`, or just
   `you/hn-rebuilt`.
3. Visit a site the skin targets.

Skins can restyle a page, restructure it, and — because Oriel owns the browser
rather than living inside someone else's — change the browser's own interface
too. [`BROWSER-API.md`](BROWSER-API.md) is what a skin can reach.

## The Safari extension

There is also a Safari Web Extension target in the project. **It is not the
product.** It exists so the skin engine can be tested inside a real browser on
a Linux machine, and it is handy for iterating on a skin's CSS on a desktop. It
cannot do what the browser can — no tabs API of its own, no browser chrome, and
on some platforms it will not run a skin's JavaScript at all.

If you want that instead, `pnpm build` produces `dist/chrome` and
`dist/firefox` to load unpacked, and the Safari extension ships inside the iOS
app.

## When something is wrong

**The Xcode build fails on a copy phase.** `dist/apple/` is missing. Run
`pnpm build` at the repository root first. The build fails loudly on purpose:
an app that builds without the web assets installs fine and then does nothing.

**A skin does nothing on a page.** Open the manager's **Log** tab — every skin
has its own log, because on a phone there is no console. If the log is empty the
skin's targeting probably does not match; the skin's detail view shows what it
targets in plain words.

**A skin's JavaScript does nothing but its colours work.** In the browser this
should not happen — it owns the web view and there is nothing in the way. If you
see it, that is a real bug and worth an issue, because it means the premise in
[decision 001](decisions/001-browser-not-extension.md) is wrong.

**Everything worked and now the app will not open.** Seven days passed. Re-sign.

## What Oriel sends anywhere

Nothing, except when you ask it to fetch a skin. Installing from a link fetches
that URL with no cookies attached. Update checks fetch a skin's `updateURL` on
the schedule you choose, and can be turned off entirely. Skins are stored on the
device. There is no account and no server.
