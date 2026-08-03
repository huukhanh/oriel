#!/usr/bin/env bash
# Stage Playwright's WebKit shared libraries into a local prefix, for a Linux
# box with no root.
#
# With root this whole script is one line:
#     npx playwright install --with-deps webkit
# which is what CI does. Without root, `apt-get download` still works
# unprivileged, so the dependency closure can be fetched as .deb files and
# unpacked into a prefix that scripts/webkit-env.sh puts on LD_LIBRARY_PATH.
#
# Idempotent; safe to re-run. Takes a few minutes and ~160 MB the first time.
set -euo pipefail

PREFIX="${ORIEL_WEBKIT_PREFIX_BASE:-$HOME/.local/pwdeps}"
WEB_DIR="$(cd "$(dirname "$0")/../web" && pwd)"

mkdir -p "$PREFIX/debs" "$PREFIX/root"

echo "==> downloading the WebKit browser build"
(cd "$WEB_DIR" && pnpm exec playwright install webkit) || true

echo "==> resolving the dependency package list"
# --dry-run prints the apt-get command it would have run as root; we only want
# the package names out of it.
(cd "$WEB_DIR" && pnpm exec playwright install-deps --dry-run webkit 2>&1) \
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

echo
echo "done. Verify with:"
echo "    cd web && pnpm test:webkit"
