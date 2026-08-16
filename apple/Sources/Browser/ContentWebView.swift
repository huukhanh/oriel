import SwiftUI
import UIKit
import WebKit

/// The page area: whichever tab's web view is currently active.
///
/// A plain `UIView` is returned as the representable's view and the tab's
/// `WKWebView` is swapped in as its only subview. Returning the web view itself
/// would mean SwiftUI destroying and rebuilding it whenever the active tab
/// changed, and a rebuilt web view has lost its scroll position, its form
/// state, and its back-forward list.
@MainActor
struct ContentWebView: UIViewRepresentable {
    let tab: Tab
    let factory: WebViewFactory

    func makeUIView(context: Context) -> UIView {
        let container: UIView = UIView(frame: CGRect.zero)
        container.backgroundColor = UIColor.systemBackground
        container.clipsToBounds = true
        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        let webView: WKWebView = factory.webView(for: tab)
        if webView.superview === container { return }

        for existing in container.subviews {
            existing.removeFromSuperview()
        }

        webView.frame = container.bounds
        webView.autoresizingMask = [UIView.AutoresizingMask.flexibleWidth, UIView.AutoresizingMask.flexibleHeight]
        container.addSubview(webView)
    }
}
