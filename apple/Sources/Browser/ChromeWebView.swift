import SwiftUI
import WebKit
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

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
struct ChromeWebView {
    let factory: WebViewFactory

    /// The container, with the chrome document's one web view already in it.
    func makeContainer() -> PlatformView {
        let container: PlatformView = PlatformView(frame: CGRect.zero)
        #if canImport(UIKit)
        container.backgroundColor = PlatformColor.clear
        container.clipsToBounds = true
        #elseif canImport(AppKit)
        // See ContentWebView.makeContainer: `NSView` has no `backgroundColor`,
        // and `clipsToBounds` did not exist before macOS 14.
        container.wantsLayer = true
        #endif

        let webView: WKWebView = factory.chromeWebView()
        webView.frame = container.bounds
        webView.autoresizingMask = PlatformView.orielFillMask
        container.addSubview(webView)
        return container
    }
}

#if canImport(UIKit)

extension ChromeWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> PlatformView {
        return makeContainer()
    }

    func updateUIView(_ container: PlatformView, context: Context) {
        // Nothing to push. The chrome document redraws itself from the events
        // the bridge sends it; that is the whole point of it being a document.
    }
}

#elseif canImport(AppKit)

extension ChromeWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> PlatformView {
        return makeContainer()
    }

    func updateNSView(_ container: PlatformView, context: Context) {
        // Nothing to push. See the UIKit half.
    }
}

#endif
