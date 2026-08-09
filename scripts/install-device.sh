#!/usr/bin/env bash
#
# Build Oriel and run it on a physical iPhone.
#
#   ./scripts/install-device.sh                 build, install, launch
#   ./scripts/install-device.sh --list          show paired devices and exit
#   ./scripts/install-device.sh --device UDID   target a specific device
#   ./scripts/install-device.sh --team ABCDE12345   signing team (usually auto)
#   ./scripts/install-device.sh --logs          stream the app's log after launch
#   ./scripts/install-device.sh --release       Release configuration
#   ./scripts/install-device.sh --ipa           install the latest release .ipa instead
#   ./scripts/install-device.sh --help
#
# One-time setup that a script cannot do for you — Developer Mode, pairing,
# signing, trusting the certificate — is in docs/DEVICE-SETUP.md, along with
# the errors you are likely to hit.
#
# No Mac? Sideload the .ipa from the phone instead: TESTING.md §2.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_ID="com.oriel.browser"
GITHUB_REPO="huukhanh/oriel"
WORK="${TMPDIR:-/tmp}/oriel-device"

# xcrun devicectl arrived in Xcode 15; everything below depends on it.
MIN_XCODE_MAJOR=15

SCHEME="Oriel"
CONFIGURATION="Debug"
DEVICE_ARG="${ORIEL_DEVICE:-}"
TEAM_ID="${ORIEL_TEAM_ID:-}"
DO_CLEAN=0
DO_LAUNCH=1
DO_LOGS=0
FROM_IPA=0
LIST_ONLY=0

# ── output ───────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
    RED=$'\033[31m'; YEL=$'\033[33m'; CYA=$'\033[36m'; DIM=$'\033[2m'; OFF=$'\033[0m'
else
    RED=''; YEL=''; CYA=''; DIM=''; OFF=''
fi

step() { printf '\n%s==>%s %s\n' "$CYA" "$OFF" "$1"; }
warn() { printf '%swarning:%s %s\n' "$YEL" "$OFF" "$1" >&2; }
note() { printf '%s    %s%s\n' "$DIM" "$1" "$OFF"; }

# Every failure exits here, so every failure names a fix. A bare non-zero exit
# or a wall of xcodebuild output is not something anyone can act on.
die() {
    printf '\n%serror:%s %s\n' "$RED" "$OFF" "$1" >&2
    if [ $# -gt 1 ]; then
        printf '\n%s\n' "$2" >&2
    fi
    printf '\n%sMore help: docs/DEVICE-SETUP.md%s\n' "$DIM" "$OFF" >&2
    exit 1
}

usage() {
    sed -n '3,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
}

# ── arguments ────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
    case "$1" in
        --help|-h) usage ;;
        --list|-l) LIST_ONLY=1 ;;
        --team)
            [ $# -ge 2 ] || die "--team needs a 10-character Team ID" \
"Find it in Xcode → Settings → Accounts → your Apple ID, or leave it out and
this will detect it from your keychain."
            TEAM_ID="$2"; shift ;;
        --device|-d)
            [ $# -ge 2 ] || die "--device needs a UDID or a device name" \
                "Run with --list to see what is paired."
            DEVICE_ARG="$2"; shift ;;
        --scheme) [ $# -ge 2 ] || die "--scheme needs a value"; SCHEME="$2"; shift ;;
        --configuration|-c)
            [ $# -ge 2 ] || die "--configuration needs a value"; CONFIGURATION="$2"; shift ;;
        --release) CONFIGURATION="Release" ;;
        --clean) DO_CLEAN=1 ;;
        --build-only) DO_LAUNCH=0 ;;
        --logs) DO_LOGS=1 ;;
        --ipa) FROM_IPA=1 ;;
        --build) : ;;   # accepted for compatibility; building is the default
        *) die "unknown option: $1" "Run --help for the list." ;;
    esac
    shift
done

# ── preflight ────────────────────────────────────────────────────────────────
# Fail on the precondition, not three minutes into a build.

[ "$(uname)" = "Darwin" ] || die "this needs macOS" \
"Building for a physical iPhone requires Xcode, which is macOS-only.
On Linux or Windows, sideload the release .ipa from the phone instead —
see TESTING.md §2."

command -v xcodebuild >/dev/null 2>&1 || die "xcodebuild not found" \
"Install Xcode from the App Store, open it once to accept the licence, then:
    sudo xcode-select -s /Applications/Xcode.app"

DEVELOPER_DIR="$(xcode-select -p 2>/dev/null || true)"
case "$DEVELOPER_DIR" in
    *CommandLineTools*)
        die "the command line tools are selected, not a full Xcode" \
"\`xcode-select -p\` points at:
    $DEVELOPER_DIR

The Command Line Tools alone cannot build or install an iOS app. Point at a
full Xcode:
    sudo xcode-select -s /Applications/Xcode.app" ;;
    "") die "no developer directory is selected" \
"Run: sudo xcode-select -s /Applications/Xcode.app" ;;
esac

# Captured whole, then read — not piped through `head`.
#
# `xcodebuild -version | head -1` dies with 134 under `set -o pipefail`: head
# closes the pipe after one line, xcodebuild takes SIGPIPE, and pipefail
# propagates the signal status. macOS ships bash 3.2 where this bites hardest,
# and it aborts the script before it can print anything at all.
XCODE_VERSION_RAW="$(xcodebuild -version 2>/dev/null || true)"
XCODE_VERSION="$(printf '%s\n' "$XCODE_VERSION_RAW" | awk 'NR==1 {print $2}')"
XCODE_MAJOR="${XCODE_VERSION%%.*}"
if [ -z "$XCODE_MAJOR" ] || [ "$XCODE_MAJOR" -lt "$MIN_XCODE_MAJOR" ] 2>/dev/null; then
    die "Xcode ${XCODE_VERSION:-unknown} is too old" \
"This uses \`xcrun devicectl\`, which arrived in Xcode $MIN_XCODE_MAJOR.
Update Xcode, or install to the phone from Xcode's own Run button."
fi

# Everything below this point is about *building*. `--list` only needs
# devicectl, so it skips ahead — a machine that can see your phone but cannot
# build should still be able to answer "is it paired?".
if [ "$LIST_ONLY" = 0 ]; then

# The SDK has to be at least the deployment target, or the build fails with
# something far less obvious than this.
DEPLOYMENT_TARGET="$(
    grep -A2 'deploymentTarget:' "$REPO_ROOT/App/project.yml" 2>/dev/null \
        | grep 'iOS:' | tr -d ' "' | cut -d: -f2 || true
)"
SDK_RAW="$(xcodebuild -showsdks 2>/dev/null || true)"
SDK_VERSION="$(printf '%s\n' "$SDK_RAW" | awk '/iphoneos/ {v=$NF} END {sub(/^iphoneos/,"",v); print v}')"
if [ -n "$DEPLOYMENT_TARGET" ] && [ -n "$SDK_VERSION" ]; then
    if [ "${SDK_VERSION%%.*}" -lt "${DEPLOYMENT_TARGET%%.*}" ] 2>/dev/null; then
        die "your iOS SDK ($SDK_VERSION) is older than this app's deployment target ($DEPLOYMENT_TARGET)" \
"Update Xcode. The app targets iOS $DEPLOYMENT_TARGET and cannot be built
against an older SDK."
    fi
fi
note "Xcode $XCODE_VERSION, iOS SDK $SDK_VERSION, deployment target iOS ${DEPLOYMENT_TARGET:-?}"

if [ "$FROM_IPA" = 0 ]; then
    command -v xcodegen >/dev/null 2>&1 || die "xcodegen not found" \
"The Xcode project is generated from App/project.yml — no .xcodeproj is checked
in, because hand-editing one on a machine without Xcode corrupts it.

    brew install xcodegen"
fi

fi   # end of build-only preflight

mkdir -p "$WORK"

# ── device discovery ─────────────────────────────────────────────────────────
# devicectl reports USB and Wi-Fi paired devices alike, so both work here.

step "Looking for devices"
DEVICES_JSON="$WORK/devices.json"
DEVICECTL_ERR="$WORK/devicectl.err"
rm -f "$DEVICES_JSON"

# Run it in a subshell with a time limit. devicectl does not merely fail on a
# machine without CoreDevice set up — it can abort (SIGABRT) or hang, and
# neither should take this script down or leave someone staring at a stopped
# terminal.
set +e
(
    trap 'exit 70' ABRT SEGV
    xcrun devicectl list devices --json-output "$DEVICES_JSON"
) >/dev/null 2>"$DEVICECTL_ERR" &
DEVICECTL_PID=$!
( sleep 30; kill -TERM "$DEVICECTL_PID" 2>/dev/null ) >/dev/null 2>&1 &
WATCHDOG_PID=$!
wait "$DEVICECTL_PID"
DEVICECTL_STATUS=$?
kill "$WATCHDOG_PID" 2>/dev/null
wait "$WATCHDOG_PID" 2>/dev/null
set -e

# A crash that still wrote usable JSON is good enough to read.
if [ "$DEVICECTL_STATUS" != 0 ] && [ -s "$DEVICES_JSON" ]; then
    DEVICECTL_STATUS=0
fi

if [ "$DEVICECTL_STATUS" != 0 ]; then
    # `--list` is informational and the first thing the guide tells people to
    # run, so it reports and exits cleanly rather than failing. Anything that
    # goes on to install still treats this as fatal.
    if [ "$LIST_ONLY" = 1 ]; then
        echo "  devicectl could not enumerate devices"
        sed 's/^/    /' "$DEVICECTL_ERR" 2>/dev/null | head -5
        note "Usually Xcode has not finished installing its components."
        exit 0
    fi
    die "\`xcrun devicectl\` failed" \
"$(head -5 "$DEVICECTL_ERR" 2>/dev/null)

Open Xcode once and let it finish installing components, then try again."
fi

read_devices() {
    python3 "$REPO_ROOT/scripts/lib/parse-devices.py" "$DEVICES_JSON"
}

DEVICE_LINES="$(read_devices || true)"

if [ "$LIST_ONLY" = 1 ]; then
    if [ -z "$DEVICE_LINES" ]; then
        echo "  no paired devices"
        note "See docs/DEVICE-SETUP.md for pairing and Developer Mode."
        exit 0
    fi
    printf '\n  %-26s %-22s %-8s %-10s %s\n' "UDID" "NAME" "OS" "TRANSPORT" "DEV MODE"
    while IFS=$'\t' read -r coredevice udid name version transport devmode; do
        [ -z "$udid" ] && continue
        printf '  %-26s %-22s %-8s %-10s %s\n' "$udid" "$name" "$version" "$transport" "$devmode"
    done <<< "$DEVICE_LINES"
    echo
    exit 0
fi

[ -n "$DEVICE_LINES" ] || die "no paired iPhone or iPad found" \
"Checklist:
  1. Connect by cable and unlock the phone
  2. Tap Trust on the phone if it asks
  3. Settings → Privacy & Security → Developer Mode → on, then reboot

Then:
    ./scripts/install-device.sh --list

Full walkthrough: docs/DEVICE-SETUP.md"

# Select: explicit flag wins; otherwise the only device; otherwise ask.
# Two identifiers, not interchangeable — see scripts/lib/parse-devices.py.
#   DEVICE_ID    CoreDevice UUID, for devicectl install/launch
#   DEVICE_UDID  hardware UDID, for xcodebuild -destination
DEVICE_ID=""
DEVICE_UDID=""
DEVICE_NAME=""
DEVICE_COUNT="$(printf '%s\n' "$DEVICE_LINES" | grep -c . || true)"

if [ -n "$DEVICE_ARG" ]; then
    while IFS=$'\t' read -r coredevice udid name version transport devmode; do
        [ -z "$udid" ] && continue
        # Accept either identifier or the name: people paste whichever they
        # have to hand, and both are printed by --list.
        if [ "$udid" = "$DEVICE_ARG" ] || [ "$coredevice" = "$DEVICE_ARG" ] \
            || [ "$name" = "$DEVICE_ARG" ]; then
            DEVICE_ID="$coredevice"; DEVICE_UDID="$udid"; DEVICE_NAME="$name"; break
        fi
    done <<< "$DEVICE_LINES"
    [ -n "$DEVICE_ID" ] || die "no paired device matches '$DEVICE_ARG'" \
"Run --list to see UDIDs and names."
elif [ "$DEVICE_COUNT" = 1 ]; then
    IFS=$'\t' read -r DEVICE_ID DEVICE_UDID DEVICE_NAME _ <<< "$DEVICE_LINES"
else
    echo
    echo "  Several devices are paired:"
    i=0
    while IFS=$'\t' read -r coredevice udid name version transport devmode; do
        [ -z "$udid" ] && continue
        i=$((i + 1))
        printf '    %d) %s  (iOS %s, %s)\n' "$i" "$name" "$version" "$transport"
    done <<< "$DEVICE_LINES"
    echo
    # Non-interactive (CI, a pipe) must not hang waiting for stdin.
    [ -t 0 ] || die "several devices are paired and there is no terminal to ask on" \
"Pass one explicitly:
    ./scripts/install-device.sh --device <UDID>
  or set ORIEL_DEVICE=<UDID>"
    printf '  Which one? [1-%d] ' "$i"
    read -r choice
    [ "$choice" -ge 1 ] 2>/dev/null && [ "$choice" -le "$i" ] || die "not a valid choice"
    CHOSEN="$(printf '%s\n' "$DEVICE_LINES" | sed -n "${choice}p")"
    DEVICE_ID="$(printf '%s' "$CHOSEN" | cut -f1)"
    DEVICE_UDID="$(printf '%s' "$CHOSEN" | cut -f2)"
    DEVICE_NAME="$(printf '%s' "$CHOSEN" | cut -f3)"
fi

# Warn rather than block: these are the usual causes of a confusing failure
# later, but devicectl is the authority and it may still work.
DEVICE_ROW="$(printf '%s\n' "$DEVICE_LINES" | grep -F "$DEVICE_ID" || true)"
DEV_MODE="$(printf '%s' "$DEVICE_ROW" | cut -f6)"
case "$DEV_MODE" in
    enabled|"") : ;;
    *) warn "Developer Mode looks $DEV_MODE on $DEVICE_NAME.
    Settings → Privacy & Security → Developer Mode → on, then reboot." ;;
esac
note "device: $DEVICE_NAME  ($DEVICE_UDID)"

# ── install from a released .ipa ─────────────────────────────────────────────
if [ "$FROM_IPA" = 1 ]; then
    step "Downloading the latest release"
    command -v gh >/dev/null 2>&1 || die "GitHub CLI not found" "brew install gh"
    rm -rf "$WORK/payload"; mkdir -p "$WORK/payload"
    gh release download --repo "$GITHUB_REPO" --pattern "Oriel-unsigned.ipa" \
        --dir "$WORK" --clobber || die "could not download the release .ipa"

    step "Signing"
    ( cd "$WORK/payload" && unzip -q "$WORK/Oriel-unsigned.ipa" )
    APP="$WORK/payload/Payload/Oriel.app"
    [ -d "$APP" ] || die "the .ipa did not contain Payload/Oriel.app"

    IDENTITIES_RAW="$(security find-identity -v -p codesigning 2>/dev/null || true)"
    IDENTITY="$(printf '%s\n' "$IDENTITIES_RAW" \
        | awk '/Apple Development|iPhone Developer/ {print; exit}' \
        | sed -E 's/.*"(.*)"/\1/')"
    [ -n "$IDENTITY" ] || die "no iOS development identity in your keychain" \
"A phone will not run an unsigned app.

The reliable route is to build from source, which lets Xcode create the
identity and the provisioning profile for you:
    ./scripts/install-device.sh

See docs/DEVICE-SETUP.md § Signing."

    PROFILES_RAW="$(ls -t ~/Library/MobileDevice/Provisioning\ Profiles/*.mobileprovision 2>/dev/null || true)"
    PROFILE="$(printf '%s\n' "$PROFILES_RAW" | awk 'NR==1 {print}')"
    [ -n "$PROFILE" ] || die "no provisioning profile on this Mac" \
"Signing needs one that names this device, and only Xcode can create it.
Build from source instead:
    ./scripts/install-device.sh"

    cp "$PROFILE" "$APP/embedded.mobileprovision"
    security cms -D -i "$PROFILE" > "$WORK/profile.plist" 2>/dev/null
    /usr/libexec/PlistBuddy -x -c "Print :Entitlements" "$WORK/profile.plist" \
        > "$WORK/entitlements.plist"
    codesign --force --sign "$IDENTITY" --entitlements "$WORK/entitlements.plist" \
        --timestamp=none "$APP" \
        || die "codesign failed" "The profile may not cover this device. Build from source instead."
    codesign --verify --deep --strict "$APP" || die "the signature did not verify"
else
    # ── build from source ────────────────────────────────────────────────────
    # Signing team.
    #
    # It cannot live in the Xcode project: the next step regenerates that
    # project from App/project.yml, which wipes anything set in the Signing &
    # Capabilities editor. So it is resolved here and passed on the command
    # line.
    #
    # Source order matters. Xcode signs with an *account*, and a codesigning
    # certificate in the keychain does not imply one — a leftover cert produced
    # `No Account for Team "..."` in #49. So Xcode's own account list wins, and
    # the keychain is only consulted when Xcode has never written preferences.
    if [ -z "$TEAM_ID" ] && [ -f "$REPO_ROOT/.oriel-local" ]; then
        # shellcheck disable=SC1091
        . "$REPO_ROOT/.oriel-local"
        TEAM_ID="${ORIEL_TEAM_ID:-}"
    fi

    XCODE_PREFS="$HOME/Library/Preferences/com.apple.dt.Xcode.plist"
    XCODE_TEAMS=""
    if [ -f "$XCODE_PREFS" ]; then
        XCODE_TEAMS="$(plutil -convert json -o - "$XCODE_PREFS" 2>/dev/null \
            | python3 "$REPO_ROOT/scripts/lib/parse-xcode-teams.py" 2>/dev/null || true)"
    fi

    if [ -z "$TEAM_ID" ] && [ -n "$XCODE_TEAMS" ]; then
        IFS=$'\t' read -r TEAM_ID TEAM_ACCOUNT TEAM_NAME \
            <<< "$(printf '%s\n' "$XCODE_TEAMS" | sed -n 1p)"
        note "team: $TEAM_ID  ($TEAM_NAME, $TEAM_ACCOUNT)"
    fi

    # No account in Xcode at all. Stop here rather than spending a build to be
    # told the same thing less clearly.
    if [ -z "$TEAM_ID" ] && [ -z "$XCODE_TEAMS" ]; then
        KEYCHAIN_TEAM="$(security find-identity -v -p codesigning 2>/dev/null \
            | python3 "$REPO_ROOT/scripts/lib/parse-team.py" 2>/dev/null || true)"

        if [ -n "$KEYCHAIN_TEAM" ]; then
            die "there is a signing certificate for team $KEYCHAIN_TEAM, but Xcode has no account for it" \
"A certificate in your keychain is not enough. Xcode signs with an *account*,
and there is no Apple ID signed in — so the build would fail with
\"No Account for Team $KEYCHAIN_TEAM\".

  Xcode → Settings… → Accounts → + → Apple ID, and sign in

A free Apple ID is enough. If the certificate belongs to an Apple ID you can
still sign in with, use that one; otherwise any Apple ID will do and Xcode will
create a fresh personal team.

Then run this again — nothing else needs changing."
        fi

        die "no signing account in Xcode" \
"Building for a device needs an Apple ID signed in to Xcode.

  1. Xcode → Settings… → Accounts → + → Apple ID, and sign in
  2. Run this again

A free Apple ID is enough. Nothing needs to be bought or registered."
    fi

    # A remembered or explicitly-passed team that Xcode has no account for is
    # the #49 failure exactly. Catch it here, where the message can be useful.
    if [ -n "$XCODE_TEAMS" ] && ! printf '%s\n' "$XCODE_TEAMS" | cut -f1 | grep -qx "$TEAM_ID"; then
        AVAILABLE="$(printf '%s\n' "$XCODE_TEAMS" \
            | awk -F'\t' '{printf "    %s  (%s, %s)\n", $1, $3, $2}')"
        die "Xcode has no account for team $TEAM_ID" \
"xcodebuild would fail with \"No Account for Team $TEAM_ID\".

Teams Xcode does have accounts for:
$AVAILABLE

Use one of those:
    ./scripts/install-device.sh --team <ID>

If $TEAM_ID is the one you want, sign in to the Apple ID that owns it:
    Xcode → Settings… → Accounts

A stale team can also be remembered from a previous run — remove
.oriel-local to forget it."
    fi

    # Remembered locally so it is asked for once. Not in App/project.yml, which
    # is tracked — a Team ID is account-specific and does not belong in
    # everyone's checkout.
    if ! grep -qx "ORIEL_TEAM_ID=$TEAM_ID" "$REPO_ROOT/.oriel-local" 2>/dev/null; then
        printf 'ORIEL_TEAM_ID=%s\n' "$TEAM_ID" > "$REPO_ROOT/.oriel-local"
        note "remembered team $TEAM_ID in .oriel-local (gitignored)"
    fi

    step "Generating the Xcode project"
    ( cd "$REPO_ROOT/App" && xcodegen generate >/dev/null ) \
        || die "xcodegen failed" "Check App/project.yml."

    step "Building ($CONFIGURATION for $DEVICE_NAME)"
    BUILD_LOG="$WORK/build.log"
    DERIVED="$WORK/DerivedData"
    [ "$DO_CLEAN" = 1 ] && rm -rf "$DERIVED"

    set +e
    xcodebuild \
        -project "$REPO_ROOT/App/Oriel.xcodeproj" \
        -scheme "$SCHEME" \
        -configuration "$CONFIGURATION" \
        -destination "id=$DEVICE_UDID" \
        -derivedDataPath "$DERIVED" \
        -allowProvisioningUpdates \
        DEVELOPMENT_TEAM="$TEAM_ID" \
        CODE_SIGN_STYLE=Automatic \
        build > "$BUILD_LOG" 2>&1
    BUILD_STATUS=$?
    set -e

    if [ "$BUILD_STATUS" != 0 ]; then
        echo
        grep -E "error:" "$BUILD_LOG" | sort -u | head -20 >&2 || true
        echo >&2
        if grep -q "Unable to find a device matching the provided destination" "$BUILD_LOG"; then
            die "xcodebuild cannot see $DEVICE_NAME" \
"It was handed UDID $DEVICE_UDID, which xcodebuild did not recognise. The log
lists what it can see — if only simulators appear, the phone is visible to
devicectl but not to xcodebuild.

Usually one of:
  - the phone locked or was unplugged during the build
  - Xcode is still copying developer symbols to it (open Xcode → Window →
    Devices and Simulators and wait for it to finish)
  - Developer Mode is off: Settings → Privacy & Security → Developer Mode,
    then reboot

Full log: $BUILD_LOG"
        fi

        if grep -q "No Account for Team" "$BUILD_LOG"; then
            die "Xcode has no account for team $TEAM_ID" \
"Sign in to the Apple ID that owns it:
    Xcode → Settings… → Accounts → + → Apple ID

Or pick a team Xcode does have an account for:
    ./scripts/install-device.sh --team <ID>

If .oriel-local is remembering a stale team, delete it."
        fi

        if grep -qE "requires a (development team|provisioning profile)|No profiles for|Signing for" "$BUILD_LOG"; then
            die "the build failed on code signing" \
"Team $TEAM_ID was passed to xcodebuild and Xcode has an account for it, so
this is neither a missing team nor a missing account.

Most likely the bundle id is already registered to someone else. Change
PRODUCT_BUNDLE_IDENTIFIER in App/project.yml to something personal —
com.yourname.oriel — and run this again.

Free Apple IDs are also capped at 10 App IDs per 7 days; if you have been
creating them, that cap is worth checking.

Setting the team in Xcode's editor will NOT help: this script regenerates the
project on every run, which wipes it. Use --team instead.

Full log: $BUILD_LOG"
        fi
        die "the build failed" "Full log: $BUILD_LOG"
    fi

    APPS_RAW="$(find "$DERIVED/Build/Products/$CONFIGURATION-iphoneos" -maxdepth 1 -name '*.app' 2>/dev/null || true)"
    APP="$(printf '%s\n' "$APPS_RAW" | awk 'NR==1 {print}')"
    [ -n "$APP" ] || die "the build succeeded but produced no .app" "Log: $BUILD_LOG"
fi

# A build that installs and silently runs no scripts is the worst outcome here,
# so check before spending a device install on it.
for resource in prelude.js visibility-spoof.js playsinline.js speed-hud.js; do
    [ -f "$APP/$resource" ] || die "$resource is missing from the app bundle" \
"This build would install and then silently run no scripts.
Check the resources in App/project.yml."
done

# ── install ──────────────────────────────────────────────────────────────────
step "Installing"
set +e
INSTALL_OUT="$(xcrun devicectl device install app --device "$DEVICE_ID" "$APP" 2>&1)"
INSTALL_STATUS=$?
set -e

if [ "$INSTALL_STATUS" != 0 ]; then
    echo "$INSTALL_OUT" >&2
    case "$INSTALL_OUT" in
        *ineligible*|*Developer\ Mode*)
            die "the device will not accept the app" \
"Usually Developer Mode:
    Settings → Privacy & Security → Developer Mode → on, then reboot" ;;
        *locked*|*passcode*)
            die "the device is locked" "Unlock the phone and run this again." ;;
        *)
            die "install failed" "See docs/DEVICE-SETUP.md § Troubleshooting." ;;
    esac
fi

if [ "$DO_LAUNCH" = 0 ]; then
    step "Installed (not launched)"
    exit 0
fi

# ── launch ───────────────────────────────────────────────────────────────────
step "Launching"
set +e
LAUNCH_OUT="$(xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID" 2>&1)"
LAUNCH_STATUS=$?
set -e

if [ "$LAUNCH_STATUS" != 0 ]; then
    echo "$LAUNCH_OUT" >&2
    die "installed, but would not launch" \
"If this is the first install with this Apple ID, the certificate has to be
trusted on the phone:
    Settings → General → VPN & Device Management → your Apple ID → Trust

Then tap the app, or run this again."
fi

cat <<DONE

  Oriel is running on $DEVICE_NAME.

  First install with a new Apple ID needs the certificate trusted:
    Settings → General → VPN & Device Management → your Apple ID → Trust

  With a free Apple ID the signature expires after 7 days — re-run this then.

  Next: TESTING.md §3 is a two-minute smoke test, and §4 is the media
  behaviour that only a real device can check.

DONE

if [ "$DO_LOGS" = 1 ]; then
    step "Streaming logs (ctrl-c to stop)"
    xcrun devicectl device console --device "$DEVICE_ID" 2>/dev/null \
        || warn "log streaming is unavailable on this Xcode; use Console.app instead"
fi
