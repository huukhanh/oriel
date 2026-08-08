#!/usr/bin/env bash
# Run Oriel in the iOS Simulator on a Mac.
#
# No Apple ID, no signing, no device. This is the fastest way to see the app.
#
#   ./scripts/run-simulator.sh              # latest release
#   ./scripts/run-simulator.sh --build      # build from this checkout instead
#
# What it cannot show you: PiP, background audio, or lock-screen behaviour.
# Simulator media behaviour does not reflect a device — see TESTING.md §4.
set -euo pipefail

REPO="huukhanh/oriel"
BUNDLE_ID="com.oriel.browser"
WORK="${TMPDIR:-/tmp}/oriel-sim"
BUILD_LOCALLY=0
[ "${1:-}" = "--build" ] && BUILD_LOCALLY=1

die() { printf '\n\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }
step() { printf '\n\033[36m==>\033[0m %s\n' "$1"; }

[ "$(uname)" = "Darwin" ] || die "this script needs macOS (the iOS Simulator is Mac-only)"
command -v xcrun >/dev/null || die "Xcode command line tools not found. Install Xcode, then: xcode-select --install"
xcrun simctl help >/dev/null 2>&1 || die "simctl is unavailable. Open Xcode once to finish its first-run setup."

rm -rf "$WORK"; mkdir -p "$WORK"

if [ "$BUILD_LOCALLY" = 1 ]; then
    step "Building from this checkout"
    command -v xcodegen >/dev/null || die "xcodegen not found. Install it with: brew install xcodegen"
    ( cd "$(dirname "$0")/../App" && xcodegen generate >/dev/null )
    DEVICE_NAME=$(xcrun simctl list devices available -j \
        | python3 -c 'import json,sys;d=json.load(sys.stdin)["devices"];print([x["name"] for v in d.values() for x in v if x["name"].startswith("iPhone")][-1])')
    xcodebuild build \
        -project "$(dirname "$0")/../App/Oriel.xcodeproj" \
        -scheme Oriel -configuration Debug \
        -destination "platform=iOS Simulator,name=$DEVICE_NAME" \
        -derivedDataPath "$WORK/dd" CODE_SIGNING_ALLOWED=NO >/dev/null \
        || die "build failed — run the same xcodebuild without >/dev/null to see why"
    APP="$WORK/dd/Build/Products/Debug-iphonesimulator/Oriel.app"
else
    step "Downloading the latest simulator build"
    command -v gh >/dev/null || die "GitHub CLI not found. Install it with: brew install gh
Or pass --build to compile from this checkout instead."
    gh release download --repo "$REPO" --pattern "Oriel-Simulator.zip" --dir "$WORK" --clobber \
        || die "no Oriel-Simulator.zip in the latest release.
Releases before v0.3.0 do not have one — pass --build instead."
    ( cd "$WORK" && unzip -q Oriel-Simulator.zip )
    APP="$WORK/Oriel.app"
fi

[ -d "$APP" ] || die "no Oriel.app was produced at $APP"
# A build that installs and silently runs no scripts is the worst outcome here.
for r in prelude.js visibility-spoof.js playsinline.js speed-hud.js; do
    [ -f "$APP/$r" ] || die "$r is missing from the app bundle — this build is broken"
done

step "Booting a simulator"
DEVICE=$(xcrun simctl list devices available -j \
    | python3 -c 'import json,sys;d=json.load(sys.stdin)["devices"];c=[x for v in d.values() for x in v if x["name"].startswith("iPhone")];print(([x for x in c if x["state"]=="Booted"] or c[-1:])[0]["udid"])' 2>/dev/null) \
    || die "no iPhone simulator is installed. Xcode → Settings → Platforms → get an iOS runtime."
xcrun simctl boot "$DEVICE" 2>/dev/null || true
open -a Simulator
xcrun simctl bootstatus "$DEVICE" -b >/dev/null 2>&1 || true

step "Installing"
xcrun simctl install "$DEVICE" "$APP" || die "install failed"

step "Launching"
xcrun simctl launch "$DEVICE" "$BUNDLE_ID" >/dev/null || die "launch failed"

cat <<DONE

  Oriel is running in the Simulator.

  Try the smoke test in TESTING.md §3 — it takes two minutes:
    - the {} button should list two built-in scripts
    - the Log button should be empty, with no red lines
    - typing "hello world" in the address bar should search, not fail

  Console output:
    xcrun simctl spawn $DEVICE log stream --predicate 'process == "Oriel"'

  PiP, background audio and lock-screen behaviour cannot be tested here.
  Those need a real device — TESTING.md §4.

DONE
