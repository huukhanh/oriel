// A STUB. This is not WebKit.
//
// It is this project's *belief* about the parts of WebKit that
// `apple/Sources/Browser` uses, written from memory on a machine with no iOS
// SDK. A green build proves the browser's Swift agrees with the surface
// described here; it proves nothing about whether that surface is Apple's.
//
// This is the file to read most carefully. `Bridge.swift` is the highest-risk
// code in the project and every WebKit signature it depends on is asserted
// here rather than verified. Two divergences from the real framework, both
// forced by Linux having no Objective-C runtime:
//
//   - `WKScriptMessageHandler` and `WKNavigationDelegate` are `@objc` protocols
//     on Apple platforms. Here they are plain protocols refined from
//     `NSObjectProtocol`.
//   - `WKNavigationDelegate`'s methods are `@objc optional` on Apple platforms.
//     Optional requirements do not exist on Linux, so the five this project
//     implements are declared as *required*. That is stricter than the real
//     protocol, which is the useful direction: a signature that does not match
//     is an error here instead of a method that silently never gets called.

@_exported import Foundation
#if canImport(FoundationNetworking)
// On Apple platforms URLRequest is part of Foundation. swift-corelibs-foundation
// splits it into FoundationNetworking, so the stub re-exports it — otherwise
// `URLRequest` in the real source would be unreachable here for a reason that
// has nothing to do with the real build.
@_exported import FoundationNetworking
#endif

// Compiled twice, like the SwiftUI stub: once with the UIKit stub as a
// dependency and once with the AppKit stub. `WKWebView` is a `UIView` on iOS
// and an `NSView` on macOS, which is the only structural difference between
// the two flavours of WebKit this project touches — that, and `scrollView`,
// which does not exist on macOS at all.
#if canImport(UIKit)
import UIKit
public typealias WKWebViewPlatformBase = UIView
#elseif canImport(AppKit)
import AppKit
public typealias WKWebViewPlatformBase = NSView
#endif

// A THIRD divergence, and the one to check first: both delegate protocols are
// declared `@MainActor` here. WebKit's headers gained main-actor annotations in
// recent SDKs, and this project's conforming types are `@MainActor` because
// they touch WKWebView. If the shipping SDK turns out *not* to annotate them,
// nothing breaks — Swift 5 language mode makes the mismatch a warning, not an
// error, and WebKit calls both on the main thread regardless. It would just
// mean the Mac build is noisier than this one.

public enum WKUserScriptInjectionTime: Int {
    case atDocumentStart = 0
    case atDocumentEnd = 1
}

open class WKUserScript: NSObject {
    public let source: String
    public let injectionTime: WKUserScriptInjectionTime
    public let isForMainFrameOnly: Bool

    public init(source: String, injectionTime: WKUserScriptInjectionTime, forMainFrameOnly: Bool) {
        self.source = source
        self.injectionTime = injectionTime
        self.isForMainFrameOnly = forMainFrameOnly
        super.init()
    }
}

open class WKNavigation: NSObject {}

open class WKWebsiteDataStore: NSObject {
    open class var `default`: WKWebsiteDataStore { return WKWebsiteDataStore() }
    open class func nonPersistent() -> WKWebsiteDataStore { return WKWebsiteDataStore() }
}

open class WKScriptMessage: NSObject {
    open var body: Any = [:]
    open var name: String = ""
    open weak var webView: WKWebView?
}

@MainActor
public protocol WKScriptMessageHandler: NSObjectProtocol {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    )
}

open class WKUserContentController: NSObject {
    open private(set) var userScripts: [WKUserScript] = []

    open func addUserScript(_ userScript: WKUserScript) {
        userScripts.append(userScript)
    }

    open func removeAllUserScripts() {
        userScripts = []
    }

    open func add(_ scriptMessageHandler: WKScriptMessageHandler, name: String) {}

    open func removeScriptMessageHandler(forName name: String) {}
}

open class WKWebViewConfiguration: NSObject {
    open var userContentController: WKUserContentController = WKUserContentController()
    open var websiteDataStore: WKWebsiteDataStore = WKWebsiteDataStore()
    open var allowsInlineMediaPlayback: Bool = false
    open var applicationNameForUserAgent: String?

    public override init() { super.init() }
}

@MainActor
public protocol WKNavigationDelegate: NSObjectProtocol {
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!)
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!)
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!)
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error)
    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    )
}

open class WKWebView: WKWebViewPlatformBase {
    open private(set) var configuration: WKWebViewConfiguration
    open weak var navigationDelegate: WKNavigationDelegate?
    open var allowsBackForwardNavigationGestures: Bool = false

    #if canImport(UIKit)
    open private(set) var scrollView: UIScrollView = UIScrollView()
    #endif
    open private(set) var url: URL?
    open private(set) var title: String?
    open private(set) var isLoading: Bool = false
    open private(set) var canGoBack: Bool = false
    open private(set) var canGoForward: Bool = false

    public init(frame: CGRect, configuration: WKWebViewConfiguration) {
        self.configuration = configuration
        super.init(frame: frame)
    }

    @discardableResult
    open func load(_ request: URLRequest) -> WKNavigation? { return nil }

    @discardableResult
    open func loadHTMLString(_ string: String, baseURL: URL?) -> WKNavigation? { return nil }

    @discardableResult
    open func loadFileURL(_ URL: URL, allowingReadAccessTo readAccessURL: URL) -> WKNavigation? { return nil }

    @discardableResult
    open func reload() -> WKNavigation? { return nil }

    @discardableResult
    open func reloadFromOrigin() -> WKNavigation? { return nil }

    @discardableResult
    open func goBack() -> WKNavigation? { return nil }

    @discardableResult
    open func goForward() -> WKNavigation? { return nil }

    open func stopLoading() {}

    open func evaluateJavaScript(
        _ javaScriptString: String,
        completionHandler: ((Any?, (any Error)?) -> Void)? = nil
    ) {}
}
