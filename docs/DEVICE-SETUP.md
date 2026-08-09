# Running Oriel on your iPhone from a Mac

A checklist, not an essay. The one-time setup a script cannot do, then the
errors you will actually hit.

**If you have no Mac**, skip all of this: download the `.ipa` from
[releases](https://github.com/huukhanh/oriel/releases/latest) and sideload it
from the phone — [TESTING.md §2](../TESTING.md#2-install-it).

---

## The short version

```sh
git clone https://github.com/huukhanh/oriel.git
cd oriel
brew install xcodegen
./scripts/install-device.sh
```

That builds, installs and launches. If a precondition is missing it will say
which, and what to do. The rest of this page is the setup it cannot do for you.

---

## 1. Which Apple account

| | Free Apple ID | Paid Developer Program ($99/yr) |
|---|---|---|
| Cost | none | $99/yr |
| **Signature lasts** | **7 days** | 1 year |
| Apps installed at once | 3 | 100+ |
| App IDs | 10 per 7 days | unlimited |

**The 7-day expiry is the gotcha.** With a free Apple ID the app stops opening
after a week and has to be reinstalled — just re-run the script. Nothing is
lost; the app's own data survives.

A free account is enough for everything in this project. Add it in
**Xcode → Settings → Accounts**.

---

## 2. Developer Mode on the phone

Required since iOS 16. Without it the phone is visible but refuses to install.

1. Connect by cable and unlock the phone.
2. **Settings → Privacy & Security → Developer Mode → on**
3. **Reboot.** The toggle does not take effect until you do.
4. After the reboot, confirm when the phone asks.

If the Developer Mode row is not there at all, connect the phone to a Mac with
Xcode installed once — the row appears after the Mac has talked to it.

Check it worked:

```sh
./scripts/install-device.sh --list
```

The `DEV MODE` column should read `enabled`.

---

## 3. Pairing and trust

First cable connection: the phone asks **"Trust This Computer?"** — tap Trust
and enter the passcode. The phone must be **unlocked** when you plug it in, or
the prompt never appears.

**Wi-Fi** works too and the script treats it the same. Pair over cable first,
then in Xcode → Window → Devices and Simulators, tick *Connect via network*.
Wi-Fi installs are slower and drop out more; cable is worth it while iterating.

---

## 4. Signing

Automatic signing is already configured (`CODE_SIGN_STYLE: Automatic` in
`App/project.yml`), so normally you only pick a team once:

```sh
open App/Oriel.xcodeproj
```

Target **Oriel** → **Signing & Capabilities** → **Team** → your personal team.

> `xcodegen generate` **rewrites the project file** and resets that choice. If
> that gets annoying, put it in `App/project.yml` instead and it survives:
> ```yaml
> settings:
>   base:
>     DEVELOPMENT_TEAM: XXXXXXXXXX
> ```
> Your team id is in Xcode → Settings → Accounts → Manage Certificates.

**Bundle id collisions.** The default is `com.oriel.browser`. If someone else
has registered it, signing fails with *"Unable to register bundle identifier"*.
Change `PRODUCT_BUNDLE_IDENTIFIER` in `App/project.yml` to something personal
and re-run.

---

## 5. Trust the certificate on the phone

**First install with a new Apple ID only.** The app installs, then refuses to
open with *"Untrusted Developer"*.

**Settings → General → VPN & Device Management → [your Apple ID] → Trust**

Once per Apple ID, not per app.

---

## Troubleshooting

### "Untrusted Developer" when tapping the app

Section 5 above. The install worked; the certificate is not trusted yet.

### "Device is ineligible" / "device not eligible for installation"

Developer Mode is off, or on but not rebooted. Section 2.

### "Unable to install — device is locked"

Unlock the phone and re-run. Installs cannot start against a locked device.

### "No profiles for 'com.oriel.browser' were found"

Xcode has not provisioned the bundle id for your account yet. The script passes
`-allowProvisioningUpdates`, which normally handles this; if it does not, open
the project in Xcode once and press Run — Xcode will create the profile, and
the script works from then on.

### "Signing for 'Oriel' requires a development team"

No team selected. Section 4.

### The app was working, now it will not open

The 7-day free-account signature expired. Re-run the script.

### `xcodebuild` fails but nothing obvious is wrong

Stale build products. The script keeps DerivedData in its own directory, so:

```sh
./scripts/install-device.sh --clean
```

### The phone does not appear at all

```sh
./scripts/install-device.sh --list      # what the script sees
xcrun devicectl list devices            # what the system sees
```

Empty in both: it is pairing or Developer Mode — sections 2 and 3. Present in
the second but not the first: please
[open an issue](https://github.com/huukhanh/oriel/issues/new/choose) with the
raw output, because that is a bug in the script's filtering.

### "command line tools are selected, not a full Xcode"

```sh
sudo xcode-select -s /Applications/Xcode.app
```

### It installs and launches, but no scripts run

Check the **Log** button in the app. `prelude.js is missing from the bundle`
means the resources did not make it in — that is a build problem, not a setup
problem, and worth an issue. The script checks for this before installing, so
it should not reach the phone.

---

## Options

```
--list                  paired devices and their UDIDs, then exit
--device <udid|name>    target one explicitly (or set ORIEL_DEVICE)
--scheme <name>         default: Oriel
--configuration <name>  default: Debug
--release               shorthand for --configuration Release
--clean                 discard previous build products
--build-only            install without launching
--logs                  stream the device console after launch
--ipa                   sign and install the latest release .ipa instead of building
```

With several devices paired and no `--device`, it lists them and asks. In a
non-interactive shell it refuses rather than hanging on a prompt.

---

## What to do once it is running

[TESTING.md §3](../TESTING.md#3-two-minute-smoke-test) is a two-minute smoke
test. [§4](../TESTING.md#4-the-media-features--what-to-actually-check) is the
media behaviour — PiP, background audio, the lock screen — which is the part no
simulator and no CI can check, and the reason a physical device matters here.
