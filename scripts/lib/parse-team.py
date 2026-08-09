#!/usr/bin/env python3
"""Find the Apple Development team ID from `security find-identity` output.

Read on stdin, one team id printed on stdout, nothing printed if there is none.

This exists because the obvious place to put a team — the Xcode project — does
not survive: `install-device.sh` runs `xcodegen generate` before every build,
which rewrites `Oriel.xcodeproj` and wipes any Team chosen in the Signing &
Capabilities editor. So the team has to reach `xcodebuild` on the command line,
which means finding it without Xcode's help.

`security find-identity -v -p codesigning` prints lines like:

    1) A1B2C3... "Apple Development: Someone (ABCDE12345)"

The value in the innermost parentheses is the team id.
"""

import re
import sys

# Ordered: a development identity is what a personal team gets, and is the one
# that can actually sign for a device here. Distribution certs are matched last
# so that a Mac with both still works rather than failing.
PREFERRED = (
    "Apple Development",
    "iPhone Developer",
    "Apple Distribution",
    "iPhone Distribution",
)

LINE = re.compile(r'"([^"]+)"')
TEAM = re.compile(r"\(([A-Z0-9]{10})\)\s*$")


def team_ids(text):
    """Every (kind, team_id) pair, in the order the lines appeared."""
    found = []
    for line in text.splitlines():
        quoted = LINE.search(line)
        if not quoted:
            continue
        name = quoted.group(1)
        match = TEAM.search(name)
        if not match:
            continue
        for kind in PREFERRED:
            if name.startswith(kind):
                found.append((kind, match.group(1)))
                break
    return found


def best(text):
    found = team_ids(text)
    if not found:
        return None
    for kind in PREFERRED:
        for candidate_kind, team in found:
            if candidate_kind == kind:
                return team
    return None


def main():
    team = best(sys.stdin.read())
    if team:
        print(team)
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
