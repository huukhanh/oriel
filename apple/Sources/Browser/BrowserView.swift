import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// The whole browser: a page, and the browser's own interface under it.
///
/// Both are web views. There is no SwiftUI control anywhere in this file and
/// there should never be one — the tab strip, the address bar and the toolbar
/// are HTML in `chrome.html`, because a skin has to be able to reach them.
///
/// The three objects are built and wired together in `init` rather than in
/// `onAppear`. SwiftUI runs `makeUIView` during layout and `onAppear` after it,
/// so wiring in `onAppear` would let the first web view be built against a
/// bridge that was not connected yet — a tab that silently has no host.
@MainActor
struct BrowserView: View {
    @StateObject private var tabs: TabStore
    @StateObject private var factory: WebViewFactory
    @StateObject private var bridge: Bridge

    /// TODO(api): the chrome document should report its own height, so a skin
    /// can make the toolbar taller, shorter or a full-screen overlay. A fixed
    /// band is the version that cannot go wrong on a device nobody here has:
    /// the page is never covered and every touch reaches what it looks like it
    /// should reach.
    ///
    /// The two numbers are the same layout at two densities, not two designs.
    /// `chrome.css` drops `--o-tap` from 44px to 30px under
    /// `(hover: hover) and (pointer: fine)`, which is exactly a Mac, and that
    /// shortens both control rows — the tab strip and the toolbar — by 14pt
    /// each. 96 - 2 x 14 = 68, rounded up to 72 for the 2px progress bar and
    /// the row borders. A Mac has no thumb and no home indicator to clear.
    #if canImport(UIKit)
    private let chromeHeight: CGFloat = 96
    #elseif canImport(AppKit)
    private let chromeHeight: CGFloat = 72
    #endif

    init() {
        let store: TabStore = TabStore()
        let webViews: WebViewFactory = WebViewFactory()
        let transport: Bridge = Bridge()

        transport.connect(tabs: store, factory: webViews)
        webViews.connect(tabs: store, bridge: transport)
        store.restore()

        _tabs = StateObject(wrappedValue: store)
        _factory = StateObject(wrappedValue: webViews)
        _bridge = StateObject(wrappedValue: transport)
    }

    var body: some View {
        GeometryReader { proxy in
            VStack(spacing: 0) {
                pageArea
                ChromeWebView(factory: factory)
                    .frame(height: chromeHeight)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .onAppear(perform: {
                report(insets: proxy.safeAreaInsets)
            })
            .onChange(of: proxy.safeAreaInsets, perform: { insets in
                report(insets: insets)
            })
        }
    }

    @ViewBuilder
    private var pageArea: some View {
        if let tab = tabs.activeTab {
            ContentWebView(tab: tab, factory: factory)
        } else {
            Color(PlatformColor.orielWindowBackground)
        }
    }

    /// `oriel.native.safeArea()` answers with these. Read from SwiftUI, which
    /// already knows them, rather than hunting for a key window in UIKit — and
    /// SwiftUI is the only one of the two that answers on macOS at all.
    private func report(insets: EdgeInsets) {
        bridge.updateSafeArea(
            top: Double(insets.top),
            leading: Double(insets.leading),
            bottom: Double(insets.bottom),
            trailing: Double(insets.trailing)
        )
    }
}
