import SwiftUI
import UIKit
import WebKit

/// The browser's own interface, which is a document.
///
/// The tab strip, the address bar and the toolbar are HTML, CSS and JavaScript
/// in `chrome.html`, loaded from the app bundle. This is not a stylistic
/// preference: a skin can only restyle the browser if the browser's UI is
/// something a skin can reach, and Swift is the one part of this project nobody
/// in its development loop can test. Every control that lives here instead of
/// in SwiftUI is a control that has tests.
///
/// If a tab strip in SwiftUI ever appears below this comment, something has
/// gone wrong. See docs/decisions/001-browser-not-extension.md.
@MainActor
struct ChromeWebView: UIViewRepresentable {
    let factory: WebViewFactory

    func makeUIView(context: Context) -> UIView {
        let container: UIView = UIView(frame: CGRect.zero)
        container.backgroundColor = UIColor.clear
        container.clipsToBounds = true

        let webView: WKWebView = factory.chromeWebView()
        webView.frame = container.bounds
        webView.autoresizingMask = [UIView.AutoresizingMask.flexibleWidth, UIView.AutoresizingMask.flexibleHeight]
        container.addSubview(webView)
        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        // Nothing to push. The chrome document redraws itself from the events
        // the bridge sends it; that is the whole point of it being a document.
    }
}
