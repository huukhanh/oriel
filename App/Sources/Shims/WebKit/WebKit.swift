// Stub of the WebKit surface this app uses. Linux only — see App/Package.swift.
//
// These signatures are the project's WebKit assumptions made executable. The
// riskiest ones, and the first things to check against Xcode autocomplete:
//   - WKUserContentController.add(_:contentWorld:name:)  (label order)
//   - WKUserScript(source:injectionTime:forMainFrameOnly:in:)  (`in:` last)
//   - WKWebView.callAsyncJavaScript(_:arguments:in:in:completionHandler:)
import Foundation
import UIKit

// On Linux, URLRequest lives in FoundationNetworking rather than Foundation.
// Re-exported here so the app sources can just `import WebKit` and look
// exactly as they will on iOS — no conditional imports sprinkled through code
// that has to compile in Xcode too.
#if canImport(FoundationNetworking)
    @_exported import FoundationNetworking
#endif

public final class WKWebViewConfiguration {
    public init() {}
    public var allowsInlineMediaPlayback: Bool = false
    public var allowsPictureInPictureMediaPlayback: Bool = false
    public var mediaTypesRequiringUserActionForPlayback: WKAudiovisualMediaTypes = .all
    public var websiteDataStore: WKWebsiteDataStore = .default()
    public var userContentController: WKUserContentController = WKUserContentController()
    public var defaultWebpagePreferences: WKWebpagePreferences = WKWebpagePreferences()
    public var applicationNameForUserAgent: String?
    public var suppressesIncrementalRendering: Bool = false
}

public struct WKAudiovisualMediaTypes: OptionSet, Sendable {
    public let rawValue: UInt
    public init(rawValue: UInt) { self.rawValue = rawValue }
    public static let audio = WKAudiovisualMediaTypes(rawValue: 1)
    public static let video = WKAudiovisualMediaTypes(rawValue: 2)
    public static let all: WKAudiovisualMediaTypes = [.audio, .video]
}

public final class WKWebpagePreferences {
    public init() {}
    public var allowsContentJavaScript: Bool = true
}

public final class WKWebsiteDataStore {
    public static func `default`() -> WKWebsiteDataStore { WKWebsiteDataStore() }
    public static func nonPersistent() -> WKWebsiteDataStore { WKWebsiteDataStore() }
}

public enum WKUserScriptInjectionTime: Sendable {
    case atDocumentStart
    case atDocumentEnd
}

public final class WKContentWorld: @unchecked Sendable {
    public static let page = WKContentWorld()
    public static let defaultClient = WKContentWorld()
    public static func world(name: String) -> WKContentWorld { WKContentWorld() }
}

public final class WKUserScript {
    public init(
        source: String,
        injectionTime: WKUserScriptInjectionTime,
        forMainFrameOnly: Bool,
        in contentWorld: WKContentWorld
    ) {}
    public init(
        source: String,
        injectionTime: WKUserScriptInjectionTime,
        forMainFrameOnly: Bool
    ) {}
}

public protocol WKScriptMessageHandler: AnyObject {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    )
}

public protocol WKScriptMessageHandlerWithReply: AnyObject {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    )
}

public final class WKScriptMessage {
    public var body: Any = [:]
    public var name: String = ""
    public var frameInfo: WKFrameInfo = WKFrameInfo()
}

public final class WKFrameInfo {
    public var isMainFrame: Bool = true
    public var request: URLRequest = URLRequest(url: URL(string: "about:blank")!)
}

public final class WKUserContentController {
    public init() {}
    public func addUserScript(_ userScript: WKUserScript) {}
    public func removeAllUserScripts() {}
    public func add(_ scriptMessageHandler: WKScriptMessageHandler, name: String) {}
    public func add(
        _ scriptMessageHandler: WKScriptMessageHandler,
        contentWorld: WKContentWorld,
        name: String
    ) {}
    public func addScriptMessageHandler(
        _ scriptMessageHandlerWithReply: WKScriptMessageHandlerWithReply,
        contentWorld: WKContentWorld,
        name: String
    ) {}
    public func removeScriptMessageHandler(forName name: String) {}
    public func removeAllScriptMessageHandlers() {}
}

public final class WKBackForwardList {
    public var backList: [WKBackForwardListItem] = []
    public var forwardList: [WKBackForwardListItem] = []
    public var currentItem: WKBackForwardListItem?
}

public final class WKBackForwardListItem {
    public var url: URL = URL(string: "about:blank")!
    public var title: String?
}

public final class WKNavigation {}

public enum WKNavigationActionPolicy: Sendable {
    case cancel
    case allow
    case download
}

public final class WKNavigationAction {
    public var request: URLRequest = URLRequest(url: URL(string: "about:blank")!)
    public var targetFrame: WKFrameInfo?
    public var navigationType: WKNavigationType = .other
}

public enum WKNavigationType: Int, Sendable {
    case linkActivated = 0
    case formSubmitted = 1
    case backForward = 2
    case reload = 3
    case formResubmitted = 4
    case other = -1
}

/// `@MainActor` to match the modern SDK: WebKit delivers these on the main
/// thread and annotates them accordingly. If a build in Xcode disagrees, that
/// is a real finding — record it in docs/api-notes.md rather than removing the
/// annotation here, because dropping it would let genuinely unsafe code past.
@MainActor
public protocol WKNavigationDelegate: AnyObject {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    )
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?)
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?)
    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation?,
        withError error: Error
    )
}

extension WKNavigationDelegate {
    public func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) { decisionHandler(.allow) }
    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {}
    public func webView(
        _ webView: WKWebView,
        didStartProvisionalNavigation navigation: WKNavigation?
    ) {}
    public func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation?,
        withError error: Error
    ) {}
}

public protocol WKUIDelegate: AnyObject {}

@MainActor
open class WKWebView: UIView {
    public init(frame: CGRect, configuration: WKWebViewConfiguration) {
        super.init()
        self.frame = frame
    }
    public var configuration: WKWebViewConfiguration = WKWebViewConfiguration()
    public var url: URL?
    public var title: String?
    public var isLoading: Bool = false
    public var estimatedProgress: Double = 0
    public var canGoBack: Bool = false
    public var canGoForward: Bool = false
    public var allowsBackForwardNavigationGestures: Bool = false
    public var customUserAgent: String?
    public var isInspectable: Bool = false
    public var scrollView: UIScrollView = UIScrollView()
    public var backForwardList: WKBackForwardList = WKBackForwardList()
    public weak var navigationDelegate: WKNavigationDelegate?
    public weak var uiDelegate: WKUIDelegate?

    @discardableResult
    public func load(_ request: URLRequest) -> WKNavigation? { nil }
    @discardableResult
    public func loadFileURL(_ url: URL, allowingReadAccessTo readAccessURL: URL) -> WKNavigation? {
        nil
    }
    @discardableResult
    public func loadHTMLString(_ string: String, baseURL: URL?) -> WKNavigation? { nil }
    @discardableResult
    public func go(to item: WKBackForwardListItem) -> WKNavigation? { nil }
    @discardableResult
    public func goBack() -> WKNavigation? { nil }
    @discardableResult
    public func goForward() -> WKNavigation? { nil }
    @discardableResult
    public func reload() -> WKNavigation? { nil }
    public func stopLoading() {}

    public func evaluateJavaScript(
        _ javaScriptString: String,
        completionHandler: ((Any?, Error?) -> Void)?
    ) {}
    public func evaluateJavaScript(
        _ javaScriptString: String,
        in frame: WKFrameInfo?,
        in contentWorld: WKContentWorld,
        completionHandler: ((Result<Any, Error>) -> Void)?
    ) {}
    public func callAsyncJavaScript(
        _ functionBody: String,
        arguments: [String: Any] = [:],
        in frame: WKFrameInfo?,
        in contentWorld: WKContentWorld,
        completionHandler: ((Result<Any, Error>) -> Void)?
    ) {}
}
