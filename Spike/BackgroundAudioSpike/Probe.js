// Injected at document-start into the .page world. Heartbeats once a second
// so that a GAP in the stream measures WebKit media-process suspension.
//
// Classic script, no modules, no eval — WKUserScript source is a classic
// script and a userscript's CSP exemption does not extend to eval.
//
// Pure logic is hung off window.__spikeProbe so it can be unit-tested under
// jsdom on the Linux box. See web/test/probe.test.js — that test is the only
// part of this spike that is actually proven.
(function () {
  "use strict";

  if (window.__spikeProbeInstalled) {
    return;
  }
  window.__spikeProbeInstalled = true;

  // Prefer an element that is actually playing; fall back to the first media
  // element so the UI can show "found media, not playing" rather than nothing.
  function pickMedia(doc) {
    var elements = doc.querySelectorAll("video, audio");
    var fallback = null;
    for (var i = 0; i < elements.length; i++) {
      var element = elements[i];
      if (!element.paused && !element.ended) {
        return element;
      }
      if (fallback === null) {
        fallback = element;
      }
    }
    return fallback;
  }

  function sample(doc) {
    var element = pickMedia(doc);
    return {
      playing: element ? !element.paused && !element.ended : false,
      currentTime: element && isFinite(element.currentTime) ? element.currentTime : 0,
      src: element ? element.currentSrc || element.src || "(no src)" : "(no media element)",
      hidden: !!doc.hidden,
      href: String(doc.location ? doc.location.href : "")
    };
  }

  window.__spikeProbe = { pickMedia: pickMedia, sample: sample };

  function post() {
    try {
      window.webkit.messageHandlers.spikeProbe.postMessage(sample(document));
    } catch (e) {
      // No bridge: either running outside the app, or the handler was added
      // to a different content world. Nothing useful to do from here.
    }
  }

  post();
  setInterval(post, 1000);
})();
