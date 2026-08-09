#!/usr/bin/env bash
# Regression test for the device parser. Runs anywhere — no Mac, no device.
#
# It exists because of issue #45: xcodebuild was handed devicectl's CoreDevice
# UUID instead of the hardware UDID, and reported "Unable to find a device
# matching the provided destination specifier" followed by a list of every
# simulator — which reads as "my phone is invisible" when the phone was found.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURE="$HERE/../../fixtures/devicectl-sample.json"
PARSER="$HERE/parse-devices.py"
fails=0

check() {
    if [ "$2" = "$3" ]; then
        printf '  ok    %s\n' "$1"
    else
        printf '  FAIL  %s\n        expected: %s\n        actual:   %s\n' "$1" "$3" "$2"
        fails=$((fails + 1))
    fi
}

OUT="$(python3 "$PARSER" "$FIXTURE")"

check "physical devices only (the Mac is excluded)" \
    "$(printf '%s\n' "$OUT" | grep -c .)" "2"

IFS=$'\t' read -r coredevice udid name os transport devmode <<< "$(printf '%s\n' "$OUT" | sed -n 1p)"

check "CoreDevice id — what devicectl install/launch takes" \
    "$coredevice" "122533AC-C959-5514-8501-6E1C2868C3FE"

# The bug in #45. These two must not be confused.
check "hardware UDID — what xcodebuild -destination takes" \
    "$udid" "00008140-001A2D3E14C1801C"

check "the two identifiers are distinct" \
    "$([ "$coredevice" != "$udid" ] && echo different || echo same)" "different"

check "name" "$name" "rootless.16e"
check "os" "$os" "26.3.1"
check "developer mode" "$devmode" "enabled"

IFS=$'\t' read -r _ _ name2 _ transport2 devmode2 <<< "$(printf '%s\n' "$OUT" | sed -n 2p)"
check "wireless devices are included" "$transport2" "wireless"
check "developer mode is reported when off" "$devmode2" "disabled"

# Missing devices is a normal state, not an error.
EMPTY="$(python3 "$PARSER" /nonexistent.json; echo "exit=$?")"
check "a missing file is not an error" "$EMPTY" "exit=0"

if [ "$fails" != 0 ]; then
    printf '\n%d check(s) failed\n' "$fails"
    exit 1
fi
printf '\nall device-parsing checks passed\n'
