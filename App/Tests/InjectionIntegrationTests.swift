import Core
import WebKit
import XCTest

@testable import Oriel

/// The tests that only a real `WKWebView` can run.
///
/// Everything else about the injection engine is already proven — the matching
/// logic on Linux, the runtime in a real WebKit engine via Playwright. What
/// neither can touch is `WKUserContentController` itself: content worlds, and
/// whether a message handler registered in one world is visible to a script
/// running in it.
///
/// That pair is the top of `docs/api-notes.md` precisely because it **fails
/// silently**. Get the world wrong and everything still compiles, the script
/// still runs, and `window.webkit.messageHandlers.scriptLog` is simply
/// `undefined` — no error, anywhere. A compiler cannot catch it. These can.
@MainActor
final class InjectionIntegrationTests: XCTestCase {

    private var webView: WKWebView?
    /// Navigation delegates are weak; the waiter has to be held somewhere.
    private var loadWaiter: AnyObject?

    override func tearDown() async throws {
        webView = nil
        loadWaiter = nil
    }

    // MARK: - helpers

    private func userScript(id: String, match: String, body: String) -> Script {
        let source = """
            // ==UserScript==
            // @name  \(id)
            // @match \(match)
            // @run-at document-start
            // @world page
            // ==/UserScript==
            \(body)
            """
        return Script(id: id, source: source, isEnabled: true, order: 0, origin: .user)
    }

    private func preludeSource() throws -> String {
        let bundle = Bundle(for: InjectionIntegrationTests.self)
        guard let url = bundle.url(forResource: "prelude", withExtension: "js") else {
            throw XCTSkip("prelude.js is not in the test bundle")
        }
        return try String(contentsOf: url, encoding: .utf8)
    }

    /// Builds the real thing: real controller, real factory, real wrapper.
    /// Stands in for AppModel's persistence, so the storage round trip is
    /// observable without a real store on disk.
    @MainActor
    final class FakeStore {
        var values: [String: [String: String]] = [:]
    }

    private let store = FakeStore()

    private func makeWebView(
        scripts: [Script],
        onLog: @escaping @MainActor (LogEntry) -> Void = { _ in },
        onMedia: @escaping @MainActor (MediaState) -> Void = { _ in }
    ) throws -> WKWebView {
        let controller = WKUserContentController()
        let bridge = ScriptBridge(onLog: onLog, onMedia: onMedia)
        let store = self.store
        let storeBridge = ScriptStoreBridge(
            read: { scriptID, key in store.values[scriptID]?[key] },
            write: { scriptID, key, value in
                var bucket = store.values[scriptID] ?? [:]
                if let value {
                    bucket[key] = value
                } else {
                    bucket.removeValue(forKey: key)
                }
                store.values[scriptID] = bucket
            },
            list: { scriptID in
                (store.values[scriptID].map { Array($0.keys) } ?? []).sorted()
            }
        )
        let injection = InjectionController(
            contentController: controller,
            preludeSource: try preludeSource(),
            bridge: bridge,
            storeBridge: storeBridge
        )
        injection.rebuild(with: scripts)
        let webView = WebViewFactory.make(settings: Settings(), contentController: controller)
        self.webView = webView
        return webView
    }

    private func load(_ webView: WKWebView, at url: String) async throws {
        let waiter = LoadWaiter()
        loadWaiter = waiter
        webView.navigationDelegate = waiter
        webView.loadHTMLString(
            "<!doctype html><html><head><title>t</title></head><body><p>hi</p></body></html>",
            baseURL: URL(string: url)
        )
        await waiter.waitUntilSettled()
        // One extra beat so document-start scripts have finished registering.
        try await Task.sleep(nanoseconds: 200_000_000)
    }

    /// Waits on the navigation delegate rather than polling `isLoading`.
    ///
    /// Polling was flaky: a loaded-in-under-a-tick page and a simulator under
    /// load both defeat it, and the failure mode is a timeout that looks like a
    /// product bug rather than a test bug.
    @MainActor
    private final class LoadWaiter: NSObject, WKNavigationDelegate {
        private var continuation: CheckedContinuation<Void, Never>?
        private var settled = false

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
            settle()
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation?,
            withError error: Error
        ) {
            settle()
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation?,
            withError error: Error
        ) {
            settle()
        }

        private func settle() {
            settled = true
            continuation?.resume()
            continuation = nil
        }

        func waitUntilSettled() async {
            if settled {
                return
            }
            await withCheckedContinuation { continuation in
                self.continuation = continuation
            }
        }
    }

    /// Returns a `String` rather than `Any`.
    ///
    /// `evaluateJavaScript` hands back `Any`, which is not `Sendable`, so
    /// resuming a continuation with it is a data race under Swift 6 — the real
    /// compiler rejected the obvious version. Stringifying inside the JS keeps
    /// only a `String?` crossing the boundary.
    private func evaluate(_ javaScript: String, in webView: WKWebView) async throws -> String? {
        try await withCheckedThrowingContinuation { continuation in
            webView.evaluateJavaScript("String(\(javaScript))", in: nil, in: .page) { result in
                switch result {
                case .success(let value):
                    continuation.resume(returning: value as? String)
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    // MARK: - the assumptions that fail silently

    func testPreludeIsInstalledInThePageWorld() async throws {
        let webView = try makeWebView(scripts: [])
        try await load(webView, at: "https://example.com/")

        let type = try await evaluate("typeof window.__inj", in: webView)
        XCTAssertEqual(
            type,
            "object",
            "the prelude did not reach the .page world — every user script is dead"
        )
    }

    /// **The** test. If `add(_:contentWorld:name:)` puts the handler in a
    /// different world than the script runs in, this is the only thing in the
    /// project that notices.
    func testMessageHandlerIsVisibleFromThePageWorld() async throws {
        let received = Received()
        let webView = try makeWebView(
            scripts: [
                userScript(
                    id: "logger",
                    match: "*://*.example.com/*",
                    body: "GM_log('from the page world');"
                )
            ],
            onLog: { entry in received.append(entry) }
        )
        try await load(webView, at: "https://example.com/")

        try await poll { received.entries.isEmpty == false }

        XCTAssertEqual(received.entries.first?.scriptID, "logger")
        XCTAssertEqual(received.entries.first?.message, "from the page world")
    }

    func testBridgeIsReachableFromRawJavaScript() async throws {
        let received = Received()
        let webView = try makeWebView(scripts: [], onLog: { entry in received.append(entry) })
        try await load(webView, at: "https://example.com/")

        _ = try await evaluate(
            """
            (function () {
                window.webkit.messageHandlers.scriptLog.postMessage(
                    { level: "log", script: "raw", msg: "direct" }
                );
                return "sent";
            })()
            """,
            in: webView
        )
        try await poll { received.entries.isEmpty == false }
        XCTAssertEqual(received.entries.first?.message, "direct")
    }

    // MARK: - matching, end to end

    func testScriptDoesNotRunOffMatch() async throws {
        let received = Received()
        let webView = try makeWebView(
            scripts: [
                userScript(id: "yt", match: "*://*.youtube.com/*", body: "GM_log('should not run');")
            ],
            onLog: { entry in received.append(entry) }
        )
        try await load(webView, at: "https://example.com/")
        try await Task.sleep(nanoseconds: 500_000_000)

        XCTAssertTrue(
            received.entries.isEmpty,
            "the guard let a youtube.com script run on example.com"
        )
    }

    func testDisabledScriptIsNotInjectedAtAll() async throws {
        var script = userScript(id: "off", match: "*://*.example.com/*", body: "GM_log('nope');")
        script.isEnabled = false
        let received = Received()
        let webView = try makeWebView(scripts: [script], onLog: { entry in received.append(entry) })
        try await load(webView, at: "https://example.com/")
        try await Task.sleep(nanoseconds: 500_000_000)

        XCTAssertTrue(received.entries.isEmpty)
        let registered = try await evaluate(
            "Object.keys(window.__inj._entries).length",
            in: webView
        )
        XCTAssertEqual(registered, "0", "a disabled script must not even be injected")
    }

    // MARK: - built-ins, from the real bundle

    func testVisibilitySpoofOverridesDocumentHiddenInARealWebView() async throws {
        let bundle = Bundle(for: InjectionIntegrationTests.self)
        guard let url = bundle.url(forResource: "visibility-spoof", withExtension: "js"),
            let source = try? String(contentsOf: url, encoding: .utf8)
        else {
            throw XCTSkip("visibility-spoof.js is not in the test bundle")
        }

        let script = Script(
            id: "visibility-spoof",
            source: source,
            isEnabled: true,
            order: -100,
            origin: .builtIn
        )
        let webView = try makeWebView(scripts: [script])
        try await load(webView, at: "https://example.com/")

        let hidden = try await evaluate("document.hidden", in: webView)
        XCTAssertEqual(hidden, "false")

        let own = try await evaluate(
            "Object.prototype.hasOwnProperty.call(document, 'hidden')",
            in: webView
        )
        XCTAssertEqual(own, "true", "the override is not installed on this document")
    }

    // MARK: - the media bridge

    func testMediaBridgeReportsState() async throws {
        let webView = try makeWebView(scripts: [])
        try await load(webView, at: "https://example.com/")

        let outcome = try await evaluate("window.__inj.media.enterPiP()", in: webView)
        // No media on the page, so this is the honest answer rather than a
        // silent no-op.
        XCTAssertEqual(outcome, "no-media")
    }

    // MARK: - utilities

    /// Collects across the actor hop the bridge performs.
    @MainActor
    private final class Received {
        private(set) var entries: [LogEntry] = []
        func append(_ entry: LogEntry) { entries.append(entry) }
    }

    private func poll(
        timeout: TimeInterval = 5,
        _ condition: @MainActor () -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() {
                return
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("condition not met within \(timeout)s")
    }

    // MARK: - GM storage

    /// `WKScriptMessageHandlerWithReply` is a different protocol from the plain
    /// handler, and registering it with the wrong `add` overload compiles and
    /// then simply never delivers. Only a round trip shows that.
    func testGMSetValueAndGetValueRoundTrip() async throws {
        let received = Received()
        let webView = try makeWebView(
            scripts: [
                userScript(
                    id: "storer",
                    match: "*://*.example.com/*",
                    body: """
                        GM_setValue("count", 41).then(function () {
                            return GM_getValue("count", 0);
                        }).then(function (value) {
                            GM_log("read back " + (value + 1));
                        });
                        """
                )
            ],
            onLog: { entry in received.append(entry) }
        )
        try await load(webView, at: "https://example.com/")
        try await poll { received.entries.isEmpty == false }

        XCTAssertEqual(received.entries.first?.message, "read back 42")
        XCTAssertEqual(
            store.values["storer"]?["count"],
            "41",
            "the value should be persisted as JSON under the script's own id"
        )
    }

    func testGMStorageIsScopedPerScript() async throws {
        store.values["other"] = ["count": "999"]
        let received = Received()
        let webView = try makeWebView(
            scripts: [
                userScript(
                    id: "reader",
                    match: "*://*.example.com/*",
                    body: """
                        GM_getValue("count", "absent").then(function (value) {
                            GM_log(String(value));
                        });
                        """
                )
            ],
            onLog: { entry in received.append(entry) }
        )
        try await load(webView, at: "https://example.com/")
        try await poll { received.entries.isEmpty == false }

        XCTAssertEqual(
            received.entries.first?.message,
            "absent",
            "one script read another script's value — the keys are not scoped"
        )
    }
}
