#!/usr/bin/env python3
"""Teams that Xcode has a signed-in account for.

Reads JSON on stdin, produced from Xcode's preferences by:

    plutil -convert json -o - ~/Library/Preferences/com.apple.dt.Xcode.plist

and prints one `team_id<TAB>account<TAB>name` line per team.

This exists because a codesigning certificate in the keychain does **not** imply
an account in Xcode. Issue #49: detection found team TZA7A5XHC6 from a leftover
certificate and passed it to xcodebuild, which answered

    error: No Account for Team "TZA7A5XHC6"

Xcode signs with an *account*, not a certificate, so `IDEProvisioningTeams` —
which is keyed by Apple ID — is the authoritative source. The keychain is only
a fallback for a machine whose Xcode preferences have not been written yet.

Free personal teams are preferred, because that is what this project targets
(docs/decisions/001-distribution.md) and a personal team is the one a free
Apple ID gets.
"""

import json
import sys


def teams(payload):
    """(team_id, account, name, is_free) for every team Xcode has an account for."""
    section = payload.get("IDEProvisioningTeams") or {}
    if not isinstance(section, dict):
        return

    for account, entries in section.items():
        # Older Xcode wrote a single dict; newer writes a list of them.
        if isinstance(entries, dict):
            entries = [entries]
        if not isinstance(entries, list):
            continue

        for entry in entries:
            if not isinstance(entry, dict):
                continue
            team_id = entry.get("teamID") or entry.get("teamId")
            if not team_id:
                continue
            yield (
                str(team_id),
                str(account),
                str(entry.get("teamName", "")),
                bool(entry.get("isFreeProvisioningProfile", False)),
            )


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        # No Xcode preferences is a normal state on a fresh machine; the caller
        # falls back and prints its own message.
        return 1

    rows = list(teams(payload))
    if not rows:
        return 1

    # Free personal teams first: this project is built with a free Apple ID.
    rows.sort(key=lambda row: (not row[3],))
    for team_id, account, name, _ in rows:
        print("\t".join([team_id, account, name]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
