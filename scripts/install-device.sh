#!/usr/bin/env bash
# Install Oriel onto an iPhone connected to this Mac.
#
#   ./scripts/install-device.sh
#
# The release .ipa is unsigned, so this signs it with a development identity
# already in your keychain and installs the result. If you have never built an
# iOS app on this Mac you will not have one — see the message this prints, or
# just use --build, which lets Xcode handle signing itself.
#
#   ./scripts/install-device.sh --build     # build and install from source
#
# No Mac? Sideload the .ipa from the phone instead — TESTING.md §2.
set -euo pipefail

REPO="huukhanh/oriel"
BUNDLE_ID="com.oriel.browser"
WORK="${TMPDIR:-/tmp}/oriel-device"
BUILD_LOCALLY=0
[ "${1:-}" = "--build" ] && BUILD_LOCALLY=1

die() { printf '\n\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }
step() { printf '\n\033[36m==>\033[0m %s\n' "$1"; }

[ "$(uname)" = "Darwin" ] || die "this script needs macOS"
command -v xcrun >/dev/null || die "Xcode not found. Install it from the App Store."

step "Looking for a connected device"
DEVICES_JSON="$WORK/devices.json"
mkdir -p "$WORK"
xcrun devicectl list devices --json-output "$DEVICES_JSON" >/dev/null 2>&1 \
    || die "\`xcrun devicectl\` is unavailable. It needs Xcode 15 or later."

DEVICE_ID=$(python3 - "$DEVICES_JSON" <<'PY'
import json, sys
try:
    devices = json.load(open(sys.argv[1]))["result"]["devices"]
except Exception:
    sys.exit(0)
for d in devices:
    props = d.get("deviceProperties", {})
    conn = d.get("connectionProperties", {})
    if conn.get("tunnelState") in ("connected", "available") or props.get("developerModeStatus") == "enabled":
        print(d["identifier"]); break
PY
)

if [ -z "${DEVICE_ID:-}" ]; then
    die "no paired iPhone found.

  1. Connect the phone by cable and unlock it
  2. Tap Trust on the phone if asked
  3. Enable Settings → Privacy & Security → Developer Mode, then reboot

  Then run this again. To check what the Mac can see:
      xcrun devicectl list devices"
fi
echo "  device: $DEVICE_ID"

if [ "$BUILD_LOCALLY" = 1 ]; then
    # Let Xcode sign it. This is the reliable path: it provisions the bundle id
    # against your Apple ID for you, which hand-signing an .ipa cannot do.
    step "Building and installing from source"
    command -v xcodegen >/dev/null || die "xcodegen not found. Install it with: brew install xcodegen"
    ( cd "$(dirname "$0")/../App" && xcodegen generate >/dev/null )
    xcodebuild \
        -project "$(dirname "$0")/../App/Oriel.xcodeproj" \
        -scheme Oriel -configuration Debug \
        -destination "id=$DEVICE_ID" \
        -allowProvisioningUpdates \
        build || die "build failed.

  If it complains about signing, open App/Oriel.xcodeproj in Xcode once and set
  Signing & Capabilities → Team to your personal team, then re-run this."
    echo "  installed by Xcode"
    exit 0
fi

step "Finding a signing identity"
IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null \
    | grep -E "Apple Development|iPhone Developer" | head -1 \
    | sed -E 's/.*"(.*)"/\1/') || true

if [ -z "${IDENTITY:-}" ]; then
    die "no iOS development identity in your keychain.

  The release .ipa is unsigned and a phone will not run it as-is.

  Easiest fix — let Xcode do the signing:
      ./scripts/install-device.sh --build

  Or create an identity once: open Xcode → Settings → Accounts, add your Apple
  ID, then Manage Certificates → + → Apple Development."
fi
echo "  identity: $IDENTITY"

step "Downloading the latest release"
command -v gh >/dev/null || die "GitHub CLI not found. Install it with: brew install gh"
rm -rf "$WORK/payload"; mkdir -p "$WORK/payload"
gh release download --repo "$REPO" --pattern "Oriel-unsigned.ipa" --dir "$WORK" --clobber \
    || die "could not download the release .ipa"

step "Signing"
( cd "$WORK/payload" && unzip -q "$WORK/Oriel-unsigned.ipa" )
APP="$WORK/payload/Payload/Oriel.app"
[ -d "$APP" ] || die "the .ipa did not contain Payload/Oriel.app"

# A development signature needs an embedded provisioning profile naming this
# device. Reuse one Xcode already created; there is no way to mint one here.
PROFILE=$(ls -t ~/Library/MobileDevice/Provisioning\ Profiles/*.mobileprovision 2>/dev/null | head -1) || true
if [ -z "${PROFILE:-}" ]; then
    die "no provisioning profile on this Mac.

  Signing needs one that names this device, and only Xcode can create it.

  Run this instead — it builds and provisions in one step:
      ./scripts/install-device.sh --build"
fi
cp "$PROFILE" "$APP/embedded.mobileprovision"

security cms -D -i "$PROFILE" > "$WORK/profile.plist" 2>/dev/null
/usr/libexec/PlistBuddy -x -c "Print :Entitlements" "$WORK/profile.plist" > "$WORK/entitlements.plist"

codesign --force --sign "$IDENTITY" --entitlements "$WORK/entitlements.plist" \
    --timestamp=none "$APP" \
    || die "codesign failed. The profile may not cover this device — try --build."

codesign --verify --deep --strict "$APP" || die "the signature did not verify"
echo "  signed"

step "Installing"
xcrun devicectl device install app --device "$DEVICE_ID" "$APP" \
    || die "install failed.

  Most often this is the provisioning profile not listing this device.
  The reliable route is:
      ./scripts/install-device.sh --build"

cat <<DONE

  Oriel is installed.

  First launch will say "Untrusted Developer" — that is expected:
    Settings → General → VPN & Device Management → your Apple ID → Trust

  Then run TESTING.md §3 (two minutes), and §4 for the media features —
  §4 is the part no simulator and no CI can check.

  With a free Apple ID the signature expires after 7 days; re-run this then.

DONE
