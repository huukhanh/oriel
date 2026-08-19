import SwiftUI
import WebKit
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// The page area: whichever tab's web view is currently active.
///
/// A plain container view is returned as the representable's view and the tab's
/// `WKWebView` is swapped in as its only subview. Returning the web view itself
/// would mean SwiftUI destroying and rebuilding it whenever the active tab
/// changed, and a rebuilt web view has lost its scroll position, its form
/// state, and its back-forward list.
///
/// The container logic is written once, in `makeContainer` and `syncContainer`.
/// The two conformances below are thin: `UIViewRepresentable` and
/// `NSViewRepresentable` are the same protocol with different method names, and
/// a second copy of the swap logic is the thing most likely to drift.
@MainActor
struct ContentWebView {
    let tab: Tab
    let factory: WebViewFactory

    /// The container. Opaque, so the window's background shows rather than
    /// whatever was behind it, in the moment before a page paints.
    func makeContainer() -> PlatformView {
        let container: PlatformView = PlatformView(frame: CGRect.zero)
        #if canImport(UIKit)
        container.backgroundColor = PlatformColor.orielWindowBackground
        container.clipsToBounds = true
        #elseif canImport(AppKit)
        // `NSView` has neither `backgroundColor` nor — before macOS 14 —
        // `clipsToBounds`. A layer-backed view is the version that works on the
        // 13.0 deployment target; the web view fills the container exactly, so
        // there is nothing to clip and nothing of the container left to see.
        container.wantsLayer = true
        #endif
        return container
    }

    /// Put the active tab's web view in the container, and nothing else in it.
    func syncContainer(_ container: PlatformView) {
        let webView: WKWebView = factory.webView(for: tab)
        if webView.superview === container { return }

        for existing in container.subviews {
            existing.removeFromSuperview()
        }

        webView.frame = container.bounds
        webView.autoresizingMask = PlatformView.orielFillMask
        container.addSubview(webView)
    }
}

#if canImport(UIKit)

extension ContentWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> PlatformView {
        return makeContainer()
    }

    func updateUIView(_ container: PlatformView, context: Context) {
        syncContainer(container)
    }
}

#elseif canImport(AppKit)

extension ContentWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> PlatformView {
        return makeContainer()
    }

    func updateNSView(_ container: PlatformView, context: Context) {
        syncContainer(container)
    }
}

#endif
