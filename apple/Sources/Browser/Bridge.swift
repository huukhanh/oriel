import Combine
import Foundation
import WebKit

/// The transport under the `ios` host in `engine/host/contract.js`.
///
/// JavaScript posts `{ id, namespace, method, args }` to the `oriel` message
/// handler; this performs it and calls `window.__orielReply(id, ok, value)`
/// back. `hosts/ios/bridge.js` is the other end and owns the format — see
/// `BridgeCommand`.
///
/// ## Why replies go back through `evaluateJavaScript`
///
/// WebKit has a second protocol, `WKScriptMessageHandlerWithReply`, whose whole
/// job is this. It is not used here, for three reasons:
///
/// 1. Registering it needs `addScriptMessageHandler(_:contentWorld:name:)` — a
///    content-world API whose exact signature cannot be checked on this
///    machine, in the one file where an invented API would be most expensive.
///    `add(_:name:)` and `evaluateJavaScript(_:completionHandler:)` have both
///    been stable since iOS 8.
/// 2. The browser has to push messages the page never asked for anyway — a tab
///    opened, a page finished loading — and a reply handler cannot do that.
///    One mechanism for both directions is less to get wrong than two.
/// 3. `hosts/ios/bridge.js` supports both and decides at run time, by checking
///    whether `postMessage` returned a thenable. Taking the older path costs
///    nothing there: it installs `__orielReply` unconditionally.
///
/// Every command is answered. See `BridgeReply.unsupported`.
@MainActor
final class Bridge: NSObject, ObservableObject, WKScriptMessageHandler {
    /// The single message handler name. `HANDLER` in `hosts/ios/bridge.js`.
    static let messageHandlerName: String = "oriel"

    /// Where a reply lands. `REPLY_GLOBAL` in `hosts/ios/bridge.js`.
    static let replyGlobal: String = "__orielReply"

    /// The engine's only global. `GLOBAL` in `hosts/ios/main.js`.
    static let engineGlobal: String = "__oriel"

    /// Both weak: `BrowserView` owns all three objects for the life of the app,
    /// and the message handler is retained by every `WKUserContentController`
    /// it is registered with, so a strong reference here would be a cycle that
    /// keeps every web view alive forever.
    private weak var tabs: TabStore?
    private weak var factory: WebViewFactory?

    private var safeArea: [String: Any] = [
        "top": 0.0,
        "leading": 0.0,
        "bottom": 0.0,
        "trailing": 0.0
    ]

    override init() {
        super.init()
    }

    /// Wire up the bridge. Called from `BrowserView.init`, before any web view
    /// exists — a web view built before this would have a handler registered
    /// against a bridge that cannot do anything.
    func connect(tabs: TabStore, factory: WebViewFactory) {
        self.tabs = tabs
        self.factory = factory
    }

    /// The device insets, pushed down from SwiftUI rather than read out of
    /// UIKit. `oriel.native.safeArea()` is documented as returning these, and
    /// `GeometryProxy.safeAreaInsets` is the boring way to get them; digging
    /// through `UIApplication.connectedScenes` for a key window is not.
    func updateSafeArea(top: Double, leading: Double, bottom: Double, trailing: Double) {
        safeArea = ["top": top, "leading": leading, "bottom": bottom, "trailing": trailing]
    }

    // MARK: - Receiving

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == Bridge.messageHandlerName else { return }
        let source: WKWebView? = message.webView
        guard let command = BridgeCommand(body: message.body) else { return }

        let reply: BridgeReply = perform(command, from: source)
        deliver(reply, to: source)
    }

    private func perform(_ command: BridgeCommand, from source: WKWebView?) -> BridgeReply {
        switch command.namespace {
        case "tabs":
            return performTabs(command)
        case "page":
            return performPage(command, from: source)
        case "native":
            return performNative(command)
        default:
            // TODO(api): chrome, chrome.toolbar, chrome.addressBar, chrome.menu,
            // chrome.newTab, net, storage, bus, exports and native.clipboard —
            // every namespace `createIosHost` forwards. Answered as
            // "unsupported" until then, which the engine turns into a
            // HostUnsupportedError rather than a promise that never settles.
            return BridgeReply.unsupported(command.id, command.name)
        }
    }

    // MARK: - tabs

    private func performTabs(_ command: BridgeCommand) -> BridgeReply {
        guard let store = tabs else {
            return BridgeReply.failure(
                command.id,
                code: "unavailable",
                message: "No tab store is connected."
            )
        }

        switch command.method {
        case "list":
            return BridgeReply.success(command.id, jsonTabs(store))

        case "current":
            guard let current = store.activeTab else {
                return BridgeReply.success(command.id, NSNull())
            }
            return BridgeReply.success(command.id, current.jsonObject(active: true))

        case "open":
            // oriel.tabs.open(url, { background, after, group })
            guard let url = command.string(at: 0) else {
                return BridgeReply.failure(
                    command.id,
                    code: "bad-argument",
                    message: "tabs.open needs a url."
                )
            }
            let options: [String: Any] = command.options(at: 1)
            let opened: Tab = store.open(
                url: url,
                background: command.flag("background", in: options, or: false),
                after: options["after"] as? String
            )
            emitTabsChanged("created", store)
            return BridgeReply.success(
                command.id,
                opened.jsonObject(active: store.activeID == opened.id)
            )

        case "close":
            guard let id = command.string(at: 0) else {
                return BridgeReply.failure(
                    command.id,
                    code: "bad-argument",
                    message: "tabs.close needs an id."
                )
            }
            guard store.index(of: id) != nil else {
                return BridgeReply.failure(
                    command.id,
                    code: "no-such-tab",
                    message: "No tab with id " + id + "."
                )
            }
            store.close(id: id)
            factory?.discardWebView(forTabID: id)
            emitTabsChanged("closed", store)
            return BridgeReply.success(command.id, ["id": id])

        case "activate":
            guard let id = command.string(at: 0) else {
                return BridgeReply.failure(
                    command.id,
                    code: "bad-argument",
                    message: "tabs.activate needs an id."
                )
            }
            guard store.index(of: id) != nil else {
                return BridgeReply.failure(
                    command.id,
                    code: "no-such-tab",
                    message: "No tab with id " + id + "."
                )
            }
            store.activate(id: id)
            emitTabsChanged("activated", store)
            return BridgeReply.success(command.id, ["id": id])

        case "move":
            // oriel.tabs.move(id, index)
            guard let id = command.string(at: 0) else {
                return BridgeReply.failure(
                    command.id,
                    code: "bad-argument",
                    message: "tabs.move needs an id."
                )
            }
            guard let index = command.int(at: 1) else {
                return BridgeReply.failure(
                    command.id,
                    code: "bad-argument",
                    message: "tabs.move needs an index."
                )
            }
            guard store.index(of: id) != nil else {
                return BridgeReply.failure(
                    command.id,
                    code: "no-such-tab",
                    message: "No tab with id " + id + "."
                )
            }
            store.move(id: id, to: index)
            emitTabsChanged("moved", store)
            return BridgeReply.success(command.id, jsonTabs(store))

        default:
            // TODO(api): tabs.navigate, tabs.pin, tabs.group.
            return BridgeReply.unsupported(command.id, command.name)
        }
    }

    private func jsonTabs(_ store: TabStore) -> [[String: Any]] {
        return store.tabs.map { tab in tab.jsonObject(active: tab.id == store.activeID) }
    }

    // MARK: - page

    private func performPage(_ command: BridgeCommand, from source: WKWebView?) -> BridgeReply {
        guard let target = targetWebView(for: command, from: source) else {
            return BridgeReply.failure(
                command.id,
                code: "no-such-tab",
                message: "There is no page to act on."
            )
        }

        switch command.method {
        case "reload":
            // oriel.page.reload({ cache }). `{ cache: false }` in
            // docs/BROWSER-API.md means "ignore what is cached", which is what
            // reloadFromOrigin does.
            let options: [String: Any] = command.options(at: 0)
            if command.flag("cache", in: options, or: true) {
                _ = target.reload()
            } else {
                _ = target.reloadFromOrigin()
            }
            return BridgeReply.success(command.id, NSNull())

        case "stop":
            target.stopLoading()
            return BridgeReply.success(command.id, NSNull())

        case "back":
            guard target.canGoBack else {
                return BridgeReply.failure(
                    command.id,
                    code: "no-history",
                    message: "There is nothing to go back to."
                )
            }
            _ = target.goBack()
            return BridgeReply.success(command.id, NSNull())

        case "forward":
            guard target.canGoForward else {
                return BridgeReply.failure(
                    command.id,
                    code: "no-history",
                    message: "There is nothing to go forward to."
                )
            }
            _ = target.goForward()
            return BridgeReply.success(command.id, NSNull())

        default:
            // TODO(api): page.navigate, page.zoom, page.evaluate, page.snapshot,
            // page.readability, page.find. css/dom/watch/vars are the engine's
            // own and never reach the bridge.
            return BridgeReply.unsupported(command.id, command.name)
        }
    }

    /// Which page a `page.*` command acts on: the tab the message came from,
    /// else the active tab. The second case is how the chrome document drives
    /// the back button — its own web view is not a tab.
    private func targetWebView(for command: BridgeCommand, from source: WKWebView?) -> WKWebView? {
        guard let factory = factory else { return nil }

        if let source = source, factory.tabID(for: source) != nil {
            return source
        }
        guard let store = tabs else { return nil }
        guard let current = store.activeTab else { return nil }
        return factory.webView(for: current)
    }

    // MARK: - native

    private func performNative(_ command: BridgeCommand) -> BridgeReply {
        switch command.method {
        case "safeArea":
            return BridgeReply.success(command.id, safeArea)
        default:
            // TODO(api): share, haptic, download, notify, lock, and the nested
            // native.clipboard namespace. Each is a permission prompt per
            // docs/BROWSER-API.md §5, and the prompt is a bigger design
            // question than the call.
            return BridgeReply.unsupported(command.id, command.name)
        }
    }

    // MARK: - Sending

    /// `window.__orielReply(id, ok, value)`.
    ///
    /// The three arguments are serialised as one JSON array and applied, so a
    /// value that is an object, an array, a string or null all cross without a
    /// special case here and without JSONSerialization's fragment option.
    private func deliver(_ reply: BridgeReply, to webView: WKWebView?) {
        guard let webView = webView else { return }

        guard let json = Bridge.encode(reply.callArguments()) else {
            // A value that will not serialise is a bug on this side, but the
            // caller still has to be answered or it waits out its timeout.
            let fallback: BridgeReply = BridgeReply.failure(
                reply.id,
                code: "internal",
                message: "The browser produced a reply it could not encode."
            )
            guard let fallbackJSON = Bridge.encode(fallback.callArguments()) else { return }
            evaluate(Bridge.replyScript(fallbackJSON), in: webView)
            return
        }

        evaluate(Bridge.replyScript(json), in: webView)
    }

    /// Push an event nobody asked for, through `__oriel.dispatch`, to every
    /// surface: the chrome document needs to redraw its tab strip, and a skin
    /// may be listening.
    func emit(_ channel: String, payload: Any) {
        guard let json = Bridge.encode([channel, payload]) else { return }
        let script: String = Bridge.dispatchScript(json)
        factory?.forEachWebView { webView in
            self.evaluate(script, in: webView)
        }
    }

    /// `oriel.tabs.onChanged` from docs/BROWSER-API.md §2.2, which
    /// `createIosHost` subscribes on the channel named "tabs". The whole list
    /// rides along so the chrome document can redraw without a round trip.
    func emitTabsChanged(_ reason: String, _ store: TabStore) {
        emit("tabs", payload: ["reason": reason, "tabs": jsonTabs(store)])
    }

    /// Ask the engine whether it is there, and say so in the log.
    ///
    /// `main.js` exposes `ping()` for exactly this. "The bridge is broken" and
    /// "the user script never ran" produce identical symptoms on a device and
    /// are otherwise very hard to tell apart from a bug report.
    func verifyInjection(in webView: WKWebView, describing label: String) {
        let script: String = "(window." + Bridge.engineGlobal + " && window."
            + Bridge.engineGlobal + ".ping()) || null"
        webView.evaluateJavaScript(script) { result, error in
            if let answer = result as? [String: Any] {
                NSLog(
                    "Oriel: engine up in %@, version %@",
                    label,
                    String(describing: answer["version"] ?? "?")
                )
                return
            }
            NSLog(
                "Oriel: no engine in %@ — the user script did not run. %@",
                label,
                error?.localizedDescription ?? "ping returned nothing"
            )
        }
    }

    // MARK: - Script plumbing

    static func encode(_ arguments: [Any]) -> String? {
        guard JSONSerialization.isValidJSONObject(arguments) else { return nil }
        guard let data = try? JSONSerialization.data(withJSONObject: arguments, options: []) else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private static func replyScript(_ argumentsJSON: String) -> String {
        return "window." + replyGlobal + " && window." + replyGlobal
            + ".apply(null, " + argumentsJSON + ");"
    }

    private static func dispatchScript(_ argumentsJSON: String) -> String {
        return "window." + engineGlobal + " && window." + engineGlobal
            + ".dispatch.apply(null, " + argumentsJSON + ");"
    }

    private func evaluate(_ script: String, in webView: WKWebView) {
        // The explicit completion handler is not decoration: it picks the
        // callback overload rather than the `async` one, which is the form
        // that has been stable since iOS 8.
        webView.evaluateJavaScript(script) { _, _ in }
    }
}
