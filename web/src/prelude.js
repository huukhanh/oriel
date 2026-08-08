// Injected once per content world, at document-start, before any user script.
//
// Classic script, NOT a module. WKUserScript source is evaluated as a classic
// script and there is no bundler anywhere in this app's pipeline — Swift reads
// this file and hands the text to WebKit. The tests eval it into jsdom the same
// way WebKit will, so what is tested is what ships.
//
// Everything that decides *whether* a script runs lives here, in one place,
// rather than being recompiled into every wrapper. See
// docs/decisions/005-spa-reentry.md for the re-entry contract and
// docs/userscript-api.md for what scripts may rely on.
(function (global) {
    "use strict";

    if (global.__inj) {
        return;
    }

    // ---- URL matching -------------------------------------------------
    // Consumes descriptors produced by Swift's MatchPattern. This side never
    // parses @match text: two implementations of the security-critical parse
    // would drift apart, and the symptom would be a script quietly running on
    // a site it was never scoped to.

    function glob(pattern, text) {
        var patternIndex = 0;
        var textIndex = 0;
        var lastStar = -1;
        var resume = 0;

        while (textIndex < text.length) {
            if (patternIndex < pattern.length && pattern[patternIndex] === text[textIndex]) {
                patternIndex++;
                textIndex++;
            } else if (patternIndex < pattern.length && pattern[patternIndex] === "*") {
                lastStar = patternIndex;
                resume = textIndex;
                patternIndex++;
            } else if (lastStar >= 0) {
                patternIndex = lastStar + 1;
                resume++;
                textIndex = resume;
            } else {
                return false;
            }
        }
        while (patternIndex < pattern.length && pattern[patternIndex] === "*") {
            patternIndex++;
        }
        return patternIndex === pattern.length;
    }

    function matchesDescriptor(descriptor, href) {
        var url;
        try {
            url = new global.URL(href);
        } catch (e) {
            return false;
        }

        var scheme = String(url.protocol).replace(/:$/, "").toLowerCase();
        if (descriptor.scheme === "any") {
            if (scheme !== "http" && scheme !== "https") {
                return false;
            }
        } else if (scheme !== descriptor.scheme) {
            return false;
        }

        var host = String(url.hostname).toLowerCase();
        if (host === "") {
            return false;
        }
        if (descriptor.hostKind === "exact") {
            if (host !== descriptor.host) {
                return false;
            }
        } else if (descriptor.hostKind === "suffix") {
            // The dot boundary is the whole rule. Without it,
            // evil-example.com satisfies a pattern scoped to example.com.
            var suffix = "." + descriptor.host;
            var endsWithSuffix =
                host.length > suffix.length &&
                host.lastIndexOf(suffix) === host.length - suffix.length;
            if (host !== descriptor.host && !endsWithSuffix) {
                return false;
            }
        }

        // Path plus query, never the fragment: including it would let
        // https://evil.com/#https://youtube.com/watch satisfy a YouTube pattern.
        var path = url.pathname || "/";
        if (url.search) {
            path += url.search;
        }
        return glob(descriptor.path, path);
    }

    function matchesAny(descriptors, href) {
        for (var i = 0; i < descriptors.length; i++) {
            if (matchesDescriptor(descriptors[i], href)) {
                return true;
            }
        }
        return false;
    }

    // ---- script registry ----------------------------------------------

    var entries = Object.create(null);
    var order = [];

    function report(id, error) {
        try {
            global.webkit.messageHandlers.scriptLog.postMessage({
                level: "error",
                script: id,
                msg: String((error && error.stack) || error)
            });
        } catch (e) {
            // No bridge — running in a test, or in a world where the handler
            // was not registered. Fall through to the console.
        }
        try {
            global.console.error("[" + id + "]", error);
        } catch (e) {
            /* nothing left to try */
        }
    }

    function runCleanups(entry) {
        var pending = entry.cleanups;
        entry.cleanups = [];
        // Reverse order, so teardown unwinds setup.
        for (var i = pending.length - 1; i >= 0; i--) {
            try {
                pending[i]();
            } catch (error) {
                report(entry.id, error);
            }
        }
        entry.routeHandlers = [];
    }

    function makeAPI(entry) {
        return {
            info: { id: entry.id },

            onCleanup: function (fn) {
                if (typeof fn === "function") {
                    entry.cleanups.push(fn);
                }
            },

            // The supported way to do per-route work. Scripts are NOT re-run
            // while their pattern keeps matching, because pasted Tampermonkey
            // scripts already install their own route handling and re-running
            // would give the page two of everything. See decision 005.
            onRouteChange: function (fn) {
                if (typeof fn === "function") {
                    entry.routeHandlers.push(fn);
                }
            },

            addStyle: function (css) {
                var style = global.document.createElement("style");
                style.textContent = String(css);
                var parent = global.document.head || global.document.documentElement;
                if (parent) {
                    parent.appendChild(style);
                }
                // Registered automatically: a style that outlives its script is
                // the most common way a "disabled" script keeps affecting a page.
                entry.cleanups.push(function () {
                    if (style.parentNode) {
                        style.parentNode.removeChild(style);
                    }
                });
                return style;
            },

            // GM_setValue / GM_getValue.
            //
            // Async, unlike Tampermonkey's synchronous pair. There is no way to
            // block a content-world script on a round trip to Swift, and
            // pretending otherwise — caching and writing back — would hand the
            // user a value that is silently stale after an edit in another tab
            // or a script reload. Documented in docs/userscript-api.md.
            setValue: function (key, value) {
                try {
                    return global.webkit.messageHandlers.scriptStore.postMessage({
                        op: "set",
                        script: entry.id,
                        key: String(key),
                        value: JSON.stringify(value === undefined ? null : value)
                    });
                } catch (e) {
                    return Promise.reject(new Error("storage bridge unavailable"));
                }
            },

            getValue: function (key, fallback) {
                try {
                    return global.webkit.messageHandlers.scriptStore
                        .postMessage({ op: "get", script: entry.id, key: String(key) })
                        .then(function (raw) {
                            if (raw === null || raw === undefined) {
                                return fallback;
                            }
                            try {
                                return JSON.parse(raw);
                            } catch (e) {
                                // Stored by an older version, or hand-edited.
                                // Returning the raw string beats throwing.
                                return raw;
                            }
                        });
                } catch (e) {
                    return Promise.reject(new Error("storage bridge unavailable"));
                }
            },

            deleteValue: function (key) {
                try {
                    return global.webkit.messageHandlers.scriptStore.postMessage({
                        op: "delete",
                        script: entry.id,
                        key: String(key)
                    });
                } catch (e) {
                    return Promise.reject(new Error("storage bridge unavailable"));
                }
            },

            listValues: function () {
                try {
                    return global.webkit.messageHandlers.scriptStore
                        .postMessage({ op: "list", script: entry.id })
                        .then(function (keys) {
                            return keys || [];
                        });
                } catch (e) {
                    return Promise.reject(new Error("storage bridge unavailable"));
                }
            },

            log: function () {
                var args = Array.prototype.slice.call(arguments);
                try {
                    global.webkit.messageHandlers.scriptLog.postMessage({
                        level: "log",
                        script: entry.id,
                        msg: args.map(String).join(" ")
                    });
                } catch (e) {
                    /* no bridge */
                }
            }
        };
    }

    /// Run `fn` when the document has reached `runAt`.
    ///
    /// `document-start` is immediate — that is its whole purpose, and the media
    /// built-ins depend on beating the page's own listeners. The other two wait
    /// for the DOM, because a script that touches `document.body` at
    /// document-start finds `null` (issue #32).
    ///
    /// Already past that point — which is every "run on this page now" — runs
    /// immediately rather than waiting for an event that has already fired.
    function whenReady(runAt, fn) {
        if (runAt === "document-start") {
            fn();
            return;
        }
        var readyState = global.document.readyState;
        if (runAt === "document-idle") {
            if (readyState === "complete") {
                fn();
            } else {
                global.addEventListener("load", fn, { once: true });
            }
            return;
        }
        // document-end
        if (readyState === "interactive" || readyState === "complete") {
            fn();
        } else {
            global.document.addEventListener("DOMContentLoaded", fn, { once: true });
        }
    }

    function start(entry) {
        entry.running = true;
        whenReady(entry.runAt, function () {
            // The pattern can stop matching between scheduling and firing —
            // an SPA route change while waiting for DOMContentLoaded — and
            // running then would put a script on a page it does not match.
            if (!entry.running) {
                return;
            }
            try {
                entry.body(makeAPI(entry));
            } catch (error) {
                // A script that throws is still "running" as far as teardown is
                // concerned: it may have registered cleanups before it failed,
                // and those must still run when it stops.
                report(entry.id, error);
            }
        });
    }

    function stop(entry) {
        entry.running = false;
        runCleanups(entry);
    }

    function evaluate(entry) {
        var should = matchesAny(entry.patterns, global.location.href);
        if (should && !entry.running) {
            start(entry);
        } else if (!should && entry.running) {
            stop(entry);
        }
    }

    function register(id, patterns, body, runAt) {
        if (entries[id]) {
            // Re-registering the same id — the user edited the script and hit
            // "run on current page now" — tears the old one down first, so an
            // edit/run/edit/run loop does not accumulate listeners.
            stop(entries[id]);
        } else {
            order.push(id);
        }
        entries[id] = {
            id: id,
            patterns: patterns || [],
            body: body,
            // document-end by default: a script that reads or changes the DOM
            // is the common case, and one that must beat the page's own
            // listeners is the expert case that says so explicitly.
            runAt: runAt || "document-end",
            cleanups: [],
            routeHandlers: [],
            running: false
        };
        evaluate(entries[id]);
    }

    function onNavigate() {
        for (var i = 0; i < order.length; i++) {
            var entry = entries[order[i]];
            if (!entry) {
                continue;
            }
            var wasRunning = entry.running;
            evaluate(entry);
            // Route handlers fire only for a script that was already running
            // and still is. One that just started has, by definition, already
            // handled the current route in its body.
            if (wasRunning && entry.running) {
                var handlers = entry.routeHandlers.slice();
                for (var h = 0; h < handlers.length; h++) {
                    try {
                        handlers[h](global.location.href);
                    } catch (error) {
                        report(entry.id, error);
                    }
                }
            }
        }
    }

    // ---- history patching ---------------------------------------------
    // Patched exactly ONCE, here. If every wrapper patched independently, the
    // Nth script's patch would call the (N-1)th and so on down the chain, and
    // the nesting stays invisible until the page gets slow.

    function installHistoryHooks() {
        var fire = function () {
            try {
                global.dispatchEvent(new global.Event("__inj:navigate"));
            } catch (e) {
                /* exotic world with no event constructor */
            }
        };

        var pushState = global.history.pushState;
        var replaceState = global.history.replaceState;

        global.history.pushState = function () {
            var result = pushState.apply(this, arguments);
            fire();
            return result;
        };
        global.history.replaceState = function () {
            var result = replaceState.apply(this, arguments);
            fire();
            return result;
        };
        global.addEventListener("popstate", fire);
        global.addEventListener("__inj:navigate", onNavigate);
    }

    // ---- media -------------------------------------------------------
    // Driven from Swift: the toolbar's PiP button calls enterPiP() from a real
    // tap, which is the only way PiP works. Triggering it from a
    // `visibilitychange` handler fails silently — the promise rejects, or
    // webkitSetPresentationMode fires its event and no window ever appears.
    // Do not "fix" that by automating it.

    function pickMedia() {
        var elements = global.document.querySelectorAll("video, audio");
        var fallback = null;
        for (var i = 0; i < elements.length; i++) {
            var element = elements[i];
            if (!element.paused && !element.ended) {
                return element;
            }
            // Prefer the largest paused candidate: ad slots and hidden
            // preview players are usually tiny, and picking one of those
            // means the PiP button acts on the wrong video.
            if (fallback === null || area(element) > area(fallback)) {
                fallback = element;
            }
        }
        return fallback;
    }

    function area(element) {
        return (element.clientWidth || 0) * (element.clientHeight || 0);
    }

    function mediaState() {
        var element = pickMedia();
        if (!element) {
            return { hasMedia: false, playing: false };
        }
        return {
            hasMedia: true,
            playing: !element.paused && !element.ended,
            currentTime: isFinite(element.currentTime) ? element.currentTime : 0,
            duration: isFinite(element.duration) ? element.duration : 0,
            title: global.document.title || "",
            isVideo: element.tagName === "VIDEO"
        };
    }

    function enterPiP() {
        var element = pickMedia();
        if (!element) {
            return "no-media";
        }
        // The WebKit-specific path is the one that works on iOS; the standard
        // one is here for completeness and for testing in other engines.
        if (typeof element.webkitSetPresentationMode === "function") {
            try {
                element.webkitSetPresentationMode("picture-in-picture");
                return "requested";
            } catch (error) {
                return "failed:" + error;
            }
        }
        if (typeof element.requestPictureInPicture === "function") {
            try {
                element.requestPictureInPicture();
                return "requested";
            } catch (error) {
                return "failed:" + error;
            }
        }
        return "unsupported";
    }

    function postMediaState() {
        try {
            global.webkit.messageHandlers.mediaState.postMessage(mediaState());
        } catch (e) {
            /* no bridge */
        }
    }

    function installMediaWatcher() {
        // Captured on document: media events do not bubble, so a listener on
        // window without capture would never see them.
        var events = ["play", "pause", "ended", "loadedmetadata"];
        for (var i = 0; i < events.length; i++) {
            global.document.addEventListener(events[i], postMediaState, true);
        }
    }

    global.__inj = {
        register: register,
        // Exposed for tests, and for the Swift side's "run on current page now".
        matches: matchesDescriptor,
        matchesAny: matchesAny,
        glob: glob,
        media: {
            enterPiP: enterPiP,
            state: mediaState,
            pick: pickMedia
        },
        _entries: entries
    };

    installHistoryHooks();
    installMediaWatcher();
})(typeof window !== "undefined" ? window : this);
