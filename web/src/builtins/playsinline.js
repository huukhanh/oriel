// ==UserScript==
// @name        Force inline playback
// @description Marks every video playsinline and AirPlay-able, so it plays in the page and can be sent to a TV.
// @version     1.0.0
// @match       <all_urls>
// @run-at      document-start
// @world       page
// ==/UserScript==

// `allowsInlineMediaPlayback` on the WKWebViewConfiguration is necessary but
// not sufficient: a video element still goes fullscreen unless it carries the
// `playsinline` attribute. Sites that only ever expected desktop Safari often
// do not set it.
//
// Videos appear at any time — SPA routes, lazy players, ads — so a one-shot
// pass at document-start would miss almost all of them. Hence the observer.

(function () {
    "use strict";

    function mark(element) {
        if (!element || element.tagName !== "VIDEO") {
            return;
        }
        if (!element.hasAttribute("playsinline")) {
            element.setAttribute("playsinline", "");
        }
        if (!element.hasAttribute("webkit-playsinline")) {
            element.setAttribute("webkit-playsinline", "");
        }
        // Sites opt out of AirPlay by setting this to "deny", which greys out
        // the route picker for their video specifically. Overriding it is the
        // difference between the AirPlay button working and looking broken.
        if (element.getAttribute("x-webkit-airplay") !== "allow") {
            element.setAttribute("x-webkit-airplay", "allow");
        }
        // Same for the standard opt-out: `disableRemotePlayback` hides the
        // video from the Remote Playback API entirely.
        if (element.disableRemotePlayback) {
            try {
                element.disableRemotePlayback = false;
            } catch (e) {
                /* read-only on some players */
            }
        }
    }

    function markAll(root) {
        if (!root || typeof root.querySelectorAll !== "function") {
            return;
        }
        var videos = root.querySelectorAll("video");
        for (var i = 0; i < videos.length; i++) {
            mark(videos[i]);
        }
    }

    markAll(document);

    var observer = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
            var added = records[i].addedNodes;
            for (var j = 0; j < added.length; j++) {
                var node = added[j];
                if (node.nodeType !== 1) {
                    continue;
                }
                mark(node);
                markAll(node);
            }
        }
    });

    // Observe `document` itself, not `document.documentElement`.
    //
    // At document-start there is not necessarily a documentElement yet — the
    // real WebKit suite caught this, because `observe(null)` throws and the
    // whole script died before marking anything. `document` is always a valid
    // node, and a subtree observer on it sees documentElement being inserted
    // along with everything after.
    observer.observe(document, { childList: true, subtree: true });

    // Registered through the runtime, so a re-run or a toggle-off cannot leave
    // a second observer walking every DOM mutation on the page.
    GM_onCleanup(function () {
        observer.disconnect();
    });
})();
