import Core
import Foundation
import SwiftUI
import UIKit
import WebKit

/// Bridges the one `WKWebView` into SwiftUI.
///
/// The webview is created in `makeUIView` and never reconfigured, because
/// `WKWebViewConfiguration` is copied at creation and later mutation does
/// nothing. When a config-affecting setting changes, `AppModel` bumps
/// `webViewGeneration`, the caller keys this view on it, and SwiftUI discards
/// and recreates the whole thing — which is the only mechanism that works.
struct WebViewContainer: UIViewRepresentable {

    let model: AppModel
    let initialURL: URL?

    func makeCoordinator() -> Coordinator {
        Coordinator(model: model)
    }

    func makeUIView(context: UIViewRepresentableContext<WebViewContainer>) -> WKWebView {
        let contentController = WKUserContentController()

        let bridge = ScriptBridge(
            onLog: { [weak model] entry in
                model?.record(entry)
            },
            onMedia: { [weak model] state in
                model?.mediaStateChanged(state)
            }
        )

        let webView = WebViewFactory.make(
            settings: model.state.settings,
            contentController: contentController
        )
        webView.navigationDelegate = context.coordinator

        let storeBridge = ScriptStoreBridge(
            read: { [weak model] scriptID, key in
                model?.scriptValue(scriptID: scriptID, key: key)
            },
            write: { [weak model] scriptID, key, value in
                model?.setScriptValue(scriptID: scriptID, key: key, value: value)
            },
            list: { [weak model] scriptID in
                model?.scriptValueKeys(scriptID: scriptID) ?? []
            }
        )

        let preludeSource = BuiltinLibrary.prelude() ?? ""
        let injection = InjectionController(
            contentController: contentController,
            preludeSource: preludeSource,
            bridge: bridge,
            storeBridge: storeBridge
        )

        model.attach(webView: webView, injection: injection)

        if preludeSource.isEmpty {
            model.record(
                LogEntry(
                    id: UUID(),
                    at: Date(),
                    scriptID: "app",
                    level: "error",
                    message:
                        "prelude.js is missing from the bundle — no user script can run. "
                        + "Check it is in the target's Copy Bundle Resources phase."
                )
            )
        }
        for missing in BuiltinLibrary.missing() {
            model.record(
                LogEntry(
                    id: UUID(),
                    at: Date(),
                    scriptID: missing,
                    level: "error",
                    message: "built-in \(missing).js is missing from the bundle"
                )
            )
        }

        if let url = initialURL {
            webView.load(URLRequest(url: url))
        }

        return webView
    }

    func updateUIView(
        _ webView: WKWebView,
        context: UIViewRepresentableContext<WebViewContainer>
    ) {
        // Only live-changeable settings. Anything else needs a new webview.
        WebViewFactory.apply(settings: model.state.settings, to: webView)
    }

    /// `@MainActor` because `WKNavigationDelegate` is: WebKit delivers these on
    /// the main thread. Being explicit means the webview's properties can be
    /// read directly, with no hop and no captured non-`Sendable` reference.
    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        private let model: AppModel

        init(model: AppModel) {
            self.model = model
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
            model.currentURL = webView.url
            model.pageTitle = webView.title ?? ""
            model.canGoBack = webView.canGoBack
            model.isLoading = false
        }

        func webView(
            _ webView: WKWebView,
            didStartProvisionalNavigation navigation: WKNavigation?
        ) {
            model.isLoading = true
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation?,
            withError error: Error
        ) {
            model.isLoading = false
            model.record(
                LogEntry(
                    id: UUID(),
                    at: Date(),
                    scriptID: "app",
                    level: "error",
                    message: "navigation failed: \(String(describing: error))"
                )
            )
        }
    }
}
