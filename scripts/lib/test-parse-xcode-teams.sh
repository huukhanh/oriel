#!/usr/bin/env bash
# Regression test for Xcode-account team lookup. No Mac, no Xcode needed.
#
# Issue #49: a certificate in the keychain does not imply an account in Xcode.
# Detection read the keychain, found a leftover cert, and xcodebuild answered
# `No Account for Team "..."`. Xcode signs with an account, so its own account
# list is what has to be consulted.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARSER="$HERE/parse-xcode-teams.py"
fails=0

check() {
    if [ "$2" = "$3" ]; then
        printf '  ok    %s\n' "$1"
    else
        printf '  FAIL  %s\n        expected: %s\n        actual:   %s\n' "$1" "$3" "$2"
        fails=$((fails + 1))
    fi
}

one='{"IDEProvisioningTeams":{"me@example.com":[
  {"teamID":"ABCDE12345","teamName":"Me (Personal Team)","isFreeProvisioningProfile":true}]}}'
check "the usual single free personal team" \
    "$(printf '%s' "$one" | python3 "$PARSER" | cut -f1)" "ABCDE12345"
check "reports which account owns it" \
    "$(printf '%s' "$one" | python3 "$PARSER" | cut -f2)" "me@example.com"

# This project is built with a free Apple ID, so a personal team is the one
# that can actually sign here.
both='{"IDEProvisioningTeams":{"me@example.com":[
  {"teamID":"ZZZZZZZZZZ","teamName":"Some Company","isFreeProvisioningProfile":false},
  {"teamID":"ABCDE12345","teamName":"Me (Personal Team)","isFreeProvisioningProfile":true}]}}'
check "prefers a free personal team over a paid org team" \
    "$(printf '%s' "$both" | python3 "$PARSER" | head -1 | cut -f1)" "ABCDE12345"

legacy='{"IDEProvisioningTeams":{"me@example.com":
  {"teamID":"QRSTU67890","teamName":"Older Xcode wrote a dict"}}}'
check "an older Xcode wrote a dict rather than a list" \
    "$(printf '%s' "$legacy" | python3 "$PARSER" | cut -f1)" "QRSTU67890"

# The reported situation: Xcode installed, but no Apple ID added.
check "no accounts means no teams, and a non-zero exit" \
    "$(printf '%s' '{"IDEProvisioningTeams":{}}' | python3 "$PARSER" >/dev/null 2>&1; echo $?)" "1"
check "preferences without the key at all" \
    "$(printf '%s' '{"OtherSetting":1}' | python3 "$PARSER" >/dev/null 2>&1; echo $?)" "1"
check "no preferences file at all is not a crash" \
    "$(printf '' | python3 "$PARSER" >/dev/null 2>&1; echo $?)" "1"
check "malformed entries are skipped rather than fatal" \
    "$(printf '%s' '{"IDEProvisioningTeams":{"a@b.c":[{"noTeamID":1}]}}' | python3 "$PARSER" >/dev/null 2>&1; echo $?)" "1"

multi='{"IDEProvisioningTeams":{
  "one@example.com":[{"teamID":"AAAAAAAAAA","teamName":"One","isFreeProvisioningProfile":true}],
  "two@example.com":[{"teamID":"BBBBBBBBBB","teamName":"Two","isFreeProvisioningProfile":true}]}}'
check "several accounts are all reported, so the caller can choose" \
    "$(printf '%s' "$multi" | python3 "$PARSER" | wc -l | tr -d ' ')" "2"

if [ "$fails" != 0 ]; then
    printf '\n%d check(s) failed\n' "$fails"
    exit 1
fi
printf '\nall Xcode-account checks passed\n'
