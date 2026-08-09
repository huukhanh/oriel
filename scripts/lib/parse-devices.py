#!/usr/bin/env python3
"""Read `xcrun devicectl list devices --json-output` and emit one line per
physical device.

Extracted from install-device.sh so it can be tested against a fixture. It
exists because devicectl reports **two** identifiers per device and they are
not interchangeable:

    identifier              a CoreDevice UUID, e.g. 122533AC-C959-...
                            what `devicectl device install/launch` takes

    hardwareProperties.udid the real device UDID, e.g. 00008140-000...
                            what `xcodebuild -destination "id=..."` takes

Passing the CoreDevice UUID to xcodebuild makes it report "Unable to find a
device matching the provided destination specifier" and then list every
simulator on the machine — which reads as "my phone is invisible" when in fact
the phone was found and the wrong id was handed on.

Output is tab-separated because names contain spaces:

    coredevice_id  udid  name  os  transport  developer_mode
"""

import json
import sys


def rows(payload):
    for device in payload.get("result", {}).get("devices", []):
        props = device.get("deviceProperties", {})
        conn = device.get("connectionProperties", {})
        hardware = device.get("hardwareProperties", {})

        # Physical iPhones and iPads only; a Mac appears in this list too.
        if hardware.get("platform") not in ("iOS", "iPadOS"):
            continue

        coredevice_id = device.get("identifier", "")
        # Fall back to the CoreDevice id rather than emitting an empty field:
        # devicectl still works with it, so a build failure beats no device.
        udid = hardware.get("udid") or coredevice_id
        if not coredevice_id and not udid:
            continue

        yield (
            coredevice_id,
            udid,
            props.get("name", "?"),
            props.get("osVersionNumber", "?"),
            conn.get("transportType", "?"),
            props.get("developerModeStatus", "?"),
        )


def main():
    try:
        with open(sys.argv[1]) as handle:
            payload = json.load(handle)
    except Exception:
        # No devices is a normal state, not an error: the caller prints its own
        # message. A traceback here would bury it.
        return 0

    for row in rows(payload):
        print("\t".join(row))
    return 0


if __name__ == "__main__":
    sys.exit(main())
