import SwiftUI
import WebKit

/// One `WKWebView`, the §4.1 config flags, and the probe user script. No
/// toolbar, no navigation, no scripts beyond the probe — everything that is
/// not the question under test is left out on purpose.
struct SpikeWebView: UIViewRepresentable {
    let url: URL
    let log: ProbeLog

    func makeCoordinator() -> Coordinator {
        return Coordinator(log: log)
    }

    func makeUIView(context: Context) -> WKWebView {
        let controller = WKUserContentController()

        // The handler must be registered in the SAME world the probe runs in.
        // A handler added with the plain add(_:name:) is invisible from .page,
        // and the symptom is a silent undefined at the JS end.
        controller.add(context.coordinator, contentWorld: .page, name: "spikeProbe")

        if let source = SpikeWebView.probeSource() {
            let script = WKUserScript(
                source: source,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true,
                in: .page
            )
            controller.addUserScript(script)
        } else {
            log.record("PROBE", "Probe.js missing from bundle — no heartbeats will arrive")
        }

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsPictureInPictureMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.websiteDataStore = WKWebsiteDataStore.default()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
        #if DEBUG
            webView.isInspectable = true
        #endif

        context.coordinator.load(url, into: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.load(url, into: webView)
    }

    static func probeSource() -> String? {
        guard let fileURL = Bundle.main.url(forResource: "Probe", withExtension: "js") else {
            return nil
        }
        return try? String(contentsOf: fileURL, encoding: .utf8)
    }

    /// Not `@MainActor`: `WKScriptMessageHandler` conformance is not
    /// main-actor-bound, so the class stays nonisolated and hops explicitly.
    /// Only `Sendable` scalars cross the boundary — never the message itself.
    final class Coordinator: NSObject, WKScriptMessageHandler {
        private let log: ProbeLog
        private var loadedURL: URL?

        init(log: ProbeLog) {
            self.log = log
        }

        @MainActor
        func load(_ url: URL, into webView: WKWebView) {
            if let current = loadedURL, current == url {
                return
            }
            loadedURL = url
            log.record("NAV", "loading \(url.absoluteString)")

            if url.isFileURL {
                webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
            } else {
                webView.load(URLRequest(url: url))
            }
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard let body = message.body as? [String: Any] else {
                return
            }
            let playing = body["playing"] as? Bool ?? false
            let currentTime = body["currentTime"] as? Double ?? 0
            let source = body["src"] as? String ?? ""
            let hidden = body["hidden"] as? Bool ?? false

            let log = self.log
            Task { @MainActor in
                log.heartbeat(
                    playing: playing,
                    currentTime: currentTime,
                    source: source,
                    hidden: hidden
                )
            }
        }
    }
}
