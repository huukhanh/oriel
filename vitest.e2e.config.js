// End-to-end suite. Loads the real extension into a real browser.
//
// Two engines, for two different reasons:
//
//   chromium  — the only engine on Linux that can *load a WebExtension*. It
//               proves the manifest parses, the service worker boots, the
//               content script runs, and messages cross the boundary.
//   webkit    — Playwright's WPE/GTK build shares JavaScriptCore and WebCore
//               with Safari on iOS. It cannot load an extension, but it can
//               run the injection engine as a plain script, which is what
//               settles timing, CSP and SPA behaviour for the iOS target.
//
// Neither is Safari. See docs/VERIFICATION.md for what that leaves unproven.
export default {
    test: {
        environment: "node",
        include: ["e2e/**/*.e2e.test.js"],
        testTimeout: 90_000,
        hookTimeout: 120_000,
        pool: "forks",
        poolOptions: { forks: { singleFork: true } }
    }
};
