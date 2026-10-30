#!/usr/bin/env python3
"""Assert that the WebKit smoke probe found a healthy MITOSIS interface.

The probe prints a JSON object describing the bundled page. This script reads
that object from stdin and exits non-zero if anything is wrong, so a broken
build fails the job instead of scrolling past a suspicious-looking dump.

Kept in one place because the expected title and the required checks have to
stay identical in the CI and release workflows.
"""

import json
import sys

EXPECTED_TITLE = "MITOSIS \u00b7 drop a file, take the parts"


def main():
    raw = sys.stdin.read().strip()
    if not raw:
        print("FAIL no JSON received from the smoke probe")
        return 1

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        print("FAIL smoke probe emitted invalid JSON: %s" % exc)
        return 1

    if not isinstance(data, dict):
        print("FAIL smoke probe emitted a %s, expected an object" % type(data).__name__)
        return 1

    storage = data.get("storage")
    storage_ok = isinstance(storage, dict) and storage.get("available") is True

    checks = {
        "title": data.get("title") == EXPECTED_TITLE,
        "root mounted": data.get("rootChildren") == 1,
        "drop target": data.get("dropPlate") is True,
        "local storage": storage_ok,
        "no JS errors": data.get("errors") == [],
    }

    for name, passed in checks.items():
        print(("PASS " if passed else "FAIL ") + name)

    if all(checks.values()):
        return 0

    print(
        "\nThe bundled interface did not pass the smoke checks. "
        "Run scripts/build-desktop.sh and the probe locally to see the full page state.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
