#!/usr/bin/env bash
# Regression test for team detection. Runs anywhere — no Mac, no keychain.
#
# Issue #47: the team cannot live in the Xcode project, because the script
# regenerates that project on every run and wipes it. So it has to be found
# from the keychain and passed to xcodebuild, and this is that lookup.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARSER="$HERE/parse-team.py"
fails=0

check() {
    if [ "$2" = "$3" ]; then
        printf '  ok    %s\n' "$1"
    else
        printf '  FAIL  %s\n        expected: %s\n        actual:   %s\n' "$1" "$3" "$2"
        fails=$((fails + 1))
    fi
}

typical='  1) 9A0F5D1C "Apple Development: Someone Person (ABCDE12345)"
     1 valid identities found'
check "the usual single-identity case" \
    "$(printf '%s\n' "$typical" | python3 "$PARSER" || true)" "ABCDE12345"

# A Mac with several certs must not pick at random: a development identity is
# what a personal team gets and is the one that can sign for a device.
mixed='  1) AAAA "Apple Distribution: Some Company (ZZZZZZZZZZ)"
  2) BBBB "Apple Development: Someone Person (ABCDE12345)"
     2 valid identities found'
check "prefers a development identity over distribution" \
    "$(printf '%s\n' "$mixed" | python3 "$PARSER" || true)" "ABCDE12345"

legacy='  1) CCCC "iPhone Developer: Someone Person (QRSTU67890)"'
check "the older iPhone Developer naming" \
    "$(printf '%s\n' "$legacy" | python3 "$PARSER" || true)" "QRSTU67890"

check "no identities produces nothing, not a crash" \
    "$(printf '%s\n' "     0 valid identities found" | python3 "$PARSER" || true)" ""

check "empty input produces nothing" \
    "$(printf '' | python3 "$PARSER" || true)" ""

# Signing certificates are not the only thing in a keychain.
noise='  1) DDDD "Some Other Certificate (NOTATEAMID)"
  2) EEEE "Mac Developer: Someone (FFFFF11111)"'
check "ignores certificates that are not iOS signing identities" \
    "$(printf '%s\n' "$noise" | python3 "$PARSER" || true)" ""

check "exit status says whether a team was found" \
    "$(printf '%s\n' "$typical" | python3 "$PARSER" >/dev/null; echo $?)" "0"
check "exit status when nothing was found" \
    "$(printf '' | python3 "$PARSER" >/dev/null 2>&1; echo $?)" "1"

if [ "$fails" != 0 ]; then
    printf '\n%d check(s) failed\n' "$fails"
    exit 1
fi
printf '\nall team-detection checks passed\n'
