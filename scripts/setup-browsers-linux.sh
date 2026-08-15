#!/usr/bin/env bash
# Stage Playwright's browser dependencies into a local prefix, for a Linux box
# with no root.
#
# With root this whole script is one line:
#     pnpm exec playwright install --with-deps chromium webkit
# which is what CI does. Without root, `apt-get download` still works
# unprivileged, so the dependency closure can be fetched as .deb files and
# unpacked into a prefix. e2e/harness.js puts that prefix on LD_LIBRARY_PATH
# automatically, so nothing needs to be sourced before running the tests.
#
# Chromium is here because it is the only engine on Linux that can load a
# WebExtension. WebKit is here because it shares JavaScriptCore and WebCore
# with Safari on iOS, which is the browser this extension is actually aimed at.
#
# Idempotent; safe to re-run. Takes a few minutes and ~400 MB the first time.
set -euo pipefail

PREFIX="${ORIEL_BROWSER_PREFIX_BASE:-$HOME/.local/pwdeps}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$PREFIX/debs" "$PREFIX/root"

echo "==> downloading the browser builds"
(cd "$ROOT" && pnpm exec playwright install chromium webkit) || true

echo "==> resolving the dependency package list"
# --dry-run prints the apt-get command it would have run as root; we only want
# the package names out of it.
(cd "$ROOT" && pnpm exec playwright install-deps --dry-run chromium webkit 2>&1) \
    | tr -s ' \t' '\n\n' \
    | grep -E '^[a-z0-9][a-z0-9.+-]*[0-9a-z]$' \
    | grep -v -w -e apt-get -e install -e y -e dependencies -e system \
    | sort -u > "$PREFIX/packages.txt"

echo "    $(wc -l < "$PREFIX/packages.txt") packages"

echo "==> downloading packages"
cd "$PREFIX/debs"
# One at a time: apt-get download aborts the whole batch on a single unknown
# name, and the list contains a few that are not real packages.
while read -r pkg; do
    [ -z "$pkg" ] && continue
    ls "${pkg}"_*.deb >/dev/null 2>&1 && continue
    apt-get download "$pkg" >/dev/null 2>&1 || echo "    skipped: $pkg"
done < "$PREFIX/packages.txt"

echo "==> unpacking into $PREFIX/root"
for deb in *.deb; do
    dpkg -x "$deb" "$PREFIX/root" 2>/dev/null || echo "    could not unpack: $deb"
done

# Playwright's bundled MiniBrowser wrapper *overwrites* LD_LIBRARY_PATH rather
# than appending, which drops the staged prefix on the floor.
for wrapper in "$HOME"/.cache/ms-playwright/webkit-*/minibrowser-*/MiniBrowser; do
    [ -f "$wrapper" ] || continue
    grep -q 'sys/lib:\${LD_LIBRARY_PATH}' "$wrapper" && continue
    sed -i \
        's|export LD_LIBRARY_PATH="${MYDIR}/lib:${MYDIR}/sys/lib"|export LD_LIBRARY_PATH="${MYDIR}/lib:${MYDIR}/sys/lib:${LD_LIBRARY_PATH}"|' \
        "$wrapper"
done

echo
echo "done. Verify with:"
echo "    pnpm test:e2e"
