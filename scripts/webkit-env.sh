#!/usr/bin/env bash
# Source this before running the real-WebKit suite.
#
# Playwright ships a WebKit build (the WPE/GTK port) that shares JavaScriptCore
# and WebCore with the WKWebView on iOS. It is the closest thing to the device
# that exists on a headless Linux box, and it is what turns the injection
# engine from "assumed" into "proven".
#
# On a machine where `playwright install --with-deps webkit` could be run as
# root (CI), none of this is needed and every branch below no-ops. On a box with
# no root, the browser's shared libraries have to be staged into a local prefix
# instead — see scripts/setup-webkit-linux.sh.

PREFIX="${ORIEL_WEBKIT_PREFIX:-$HOME/.local/pwdeps/root}"

if [ -d "$PREFIX/usr/lib/x86_64-linux-gnu" ]; then
    export LD_LIBRARY_PATH="$PREFIX/usr/lib/x86_64-linux-gnu:$PREFIX/usr/lib:${LD_LIBRARY_PATH}"
    export LIBGL_DRIVERS_PATH="$PREFIX/usr/lib/x86_64-linux-gnu/dri"
    export __EGL_VENDOR_LIBRARY_DIRS="$PREFIX/usr/share/glvnd/egl_vendor.d"
    # Playwright validates host deps against the dpkg database, which knows
    # nothing about a hand-staged prefix. The libraries are present; the
    # bookkeeping is not.
    export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1

    # The bundled MiniBrowser wrapper *overwrites* LD_LIBRARY_PATH rather than
    # appending, which drops the staged prefix on the floor. Patch it to append.
    for wrapper in "$HOME"/.cache/ms-playwright/webkit-*/minibrowser-*/MiniBrowser; do
        [ -f "$wrapper" ] || continue
        grep -q 'sys/lib:\${LD_LIBRARY_PATH}' "$wrapper" && continue
        sed -i \
            's|export LD_LIBRARY_PATH="${MYDIR}/lib:${MYDIR}/sys/lib"|export LD_LIBRARY_PATH="${MYDIR}/lib:${MYDIR}/sys/lib:${LD_LIBRARY_PATH}"|' \
            "$wrapper"
    done
fi

# Headless WPE aborts with "Could not create WPE EGL display" when there is no
# GPU. Force the software path — we are testing script behaviour, not pixels.
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export LIBGL_ALWAYS_SOFTWARE=1
export GALLIUM_DRIVER=llvmpipe
