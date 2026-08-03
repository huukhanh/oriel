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

    override func tearDown() async throws {
        webView = nil
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
    private func makeWebView(
        scripts: [Script],
        onLog: @escaping @MainActor (LogEntry) -> Void = { _ in },
        onMedia: @escaping @MainActor (MediaState) -> Void = { _ in }
    ) throws -> WKWebView {
        let controller = WKUserContentController()
        let bridge = ScriptBridge(onLog: onLog, onMedia: onMedia)
        let injection = InjectionController(
            contentController: controller,
            preludeSource: try preludeSource(),
            bridge: bridge
        )
        injection.rebuild(with: scripts)
        let webView = WebViewFactory.make(settings: Settings(), contentController: controller)
        self.webView = webView
        return webView
    }

    private func load(_ webView: WKWebView, at url: String) async throws {
        webView.loadHTMLString(
            "<!doctype html><html><head><title>t</title></head><body><p>hi</p></body></html>",
            baseURL: URL(string: url)
        )
        try await waitForLoad(webView)
    }

    private func waitForLoad(_ webView: WKWebView) async throws {
        // Polling rather than a navigation delegate: the delegate slot is part
        // of what is under test elsewhere, and a test should not quietly take
        // it over.
        for _ in 0..<200 {
            if webView.isLoading == false, webView.url != nil {
                // One extra turn so document-start scripts have run.
                try await Task.sleep(nanoseconds: 100_000_000)
                return
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("page never finished loading")
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
}
