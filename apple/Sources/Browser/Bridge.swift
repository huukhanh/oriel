import Foundation
import WebKit

/// The transport under the `ios` host in `engine/host/contract.js`.
///
/// JavaScript posts `{ id, namespace, method, args }` to the `oriel` message
/// handler; this performs it and delivers `{ id, ok, value | error }` back.
///
/// ## Why replies go back through `evaluateJavaScript`
///
/// WebKit has a second protocol, `WKScriptMessageHandlerWithReply`, whose whole
/// job is this. It is not used here, for two reasons:
///
/// 1. Registering it needs `addScriptMessageHandler(_:contentWorld:name:)` —
///    a content-world API whose exact signature cannot be checked on this
///    machine, in the one file where an invented API would be most expensive.
///    `add(_:name:)` and `evaluateJavaScript(_:completionHandler:)` have both
///    been stable since iOS 8.
/// 2. The browser has to push messages the page never asked for anyway — a tab
///    opened, a page finished loading — and a reply handler cannot do that. One
///    mechanism for both directions is less to get wrong than two.
///
/// The cost is that a reply is matched by `id` in JavaScript instead of by a
/// resolved promise in WebKit. `bootstrapSource` in `WebViewFactory` owns that
/// half and is injected before anything else, so it is always there to receive.
///
/// Every command is answered. See `BridgeReply.unsupported`.
@MainActor
final class Bridge: NSObject, ObservableObject, WKScriptMessageHandler {
    /// The single message handler name. Also hard-coded in `bootstrapSource`.
    static let messageHandlerName: String = "oriel"

    /// Both weak: `BrowserView` owns all three objects for the life of the app,
    /// and the message handler is retained by every `WKUserContentController`
    /// it is registered with, so a strong reference here would be a cycle that
    /// keeps every web view alive forever.
    private weak var tabs: TabStore?
    private weak var factory: WebViewFactory?

    private var safeArea: [String: Any] = ["top": 0.0, "leading": 0.0, "bottom": 0.0, "trailing": 0.0]

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

    static func encode(_ object: [String: Any]) -> String? {
        guard JSONSerialization.isValidJSONObject(object) else { return nil }
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: []) else { return nil }
        return String(data: data, encoding: .utf8)
    }

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
            // TODO(api): chrome, net, storage, bus and the rest of
            // docs/BROWSER-API.md. Answered as "unsupported" until then, so the
            // engine's `can()` can report honestly instead of a skin hanging on
            // a promise that never settles.
            return BridgeReply.unsupported(command.id, command.name)
        }
    }

    // MARK: - tabs

    private func performTabs(_ command: BridgeCommand) -> BridgeReply {
        guard let store = tabs else {
            return BridgeReply.failure(command.id, code: "unavailable", message: "No tab store is connected.")
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
            guard let url = command.string("url") else {
                return BridgeReply.failure(command.id, code: "bad-argument", message: "tabs.open needs a url.")
            }
            let opened: Tab = store.open(
                url: url,
                background: command.bool("background", or: false),
                after: command.string("after")
            )
            emitTabsChanged("created", store)
            return BridgeReply.success(command.id, opened.jsonObject(active: store.activeID == opened.id))

        case "close":
            guard let id = command.string("id") else {
                return BridgeReply.failure(command.id, code: "bad-argument", message: "tabs.close needs an id.")
            }
            guard store.index(of: id) != nil else {
                return BridgeReply.failure(command.id, code: "no-such-tab", message: "No tab with id " + id + ".")
            }
            store.close(id: id)
            factory?.discardWebView(forTabID: id)
            emitTabsChanged("closed", store)
            return BridgeReply.success(command.id, ["id": id])

        case "activate":
            guard let id = command.string("id") else {
                return BridgeReply.failure(command.id, code: "bad-argument", message: "tabs.activate needs an id.")
            }
            guard store.index(of: id) != nil else {
                return BridgeReply.failure(command.id, code: "no-such-tab", message: "No tab with id " + id + ".")
            }
            store.activate(id: id)
            emitTabsChanged("activated", store)
            return BridgeReply.success(command.id, ["id": id])

        case "move":
            guard let id = command.string("id") else {
                return BridgeReply.failure(command.id, code: "bad-argument", message: "tabs.move needs an id.")
            }
            guard let index = command.int("index") else {
                return BridgeReply.failure(command.id, code: "bad-argument", message: "tabs.move needs an index.")
            }
            guard store.index(of: id) != nil else {
                return BridgeReply.failure(command.id, code: "no-such-tab", message: "No tab with id " + id + ".")
            }
            store.move(id: id, to: index)
            emitTabsChanged("moved", store)
            return BridgeReply.success(command.id, jsonTabs(store))

        default:
            // TODO(api): tabs.pin, tabs.group, tabs.onChanged's filtered form.
            return BridgeReply.unsupported(command.id, command.name)
        }
    }

    private func jsonTabs(_ store: TabStore) -> [[String: Any]] {
        return store.tabs.map { tab in tab.jsonObject(active: tab.id == store.activeID) }
    }

    // MARK: - page

    private func performPage(_ command: BridgeCommand, from source: WKWebView?) -> BridgeReply {
        guard let target = targetWebView(for: command, from: source) else {
            return BridgeReply.failure(command.id, code: "no-such-tab", message: "There is no page to act on.")
        }

        switch command.method {
        case "reload":
            // `{ cache: false }` in docs/BROWSER-API.md means "ignore what is
            // cached", which is what reloadFromOrigin does.
            if command.bool("cache", or: true) {
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
                return BridgeReply.failure(command.id, code: "no-history", message: "There is nothing to go back to.")
            }
            _ = target.goBack()
            return BridgeReply.success(command.id, NSNull())

        case "forward":
            guard target.canGoForward else {
                return BridgeReply.failure(command.id, code: "no-history", message: "There is nothing to go forward to.")
            }
            _ = target.goForward()
            return BridgeReply.success(command.id, NSNull())

        default:
            // TODO(api): page.zoom, page.evaluate, page.snapshot,
            // page.readability, page.find. css/dom/watch/vars are the engine's
            // own and never reach the bridge.
            return BridgeReply.unsupported(command.id, command.name)
        }
    }

    /// Which page a `page.*` command acts on: the tab named in `args.tabId`,
    /// else the tab the message came from, else the active tab. The last case
    /// is how the chrome document drives the back button — its own web view is
    /// not a tab.
    private func targetWebView(for command: BridgeCommand, from source: WKWebView?) -> WKWebView? {
        guard let factory = factory else { return nil }

        if let requested = command.string("tabId") {
            return factory.existingWebView(forTabID: requested)
        }
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
            // TODO(api): share, clipboard, haptic, download, notify, lock.
            // Each is a permission prompt per docs/BROWSER-API.md §5, and the
            // prompt is a bigger design question than the call.
            return BridgeReply.unsupported(command.id, command.name)
        }
    }

    // MARK: - Sending

    private func deliver(_ reply: BridgeReply, to webView: WKWebView?) {
        guard let webView = webView else { return }
        guard let json = Bridge.encode(reply.jsonObject()) else {
            // A value that will not serialise is a bug here, not there — but
            // the promise still has to settle or the caller waits forever.
            let fallback: BridgeReply = BridgeReply.failure(
                reply.id,
                code: "internal",
                message: "The browser produced a reply it could not encode."
            )
            guard let json = Bridge.encode(fallback.jsonObject()) else { return }
            evaluate("window.__oriel_bridge_settle && window.__oriel_bridge_settle(" + json + ");", in: webView)
            return
        }
        evaluate("window.__oriel_bridge_settle && window.__oriel_bridge_settle(" + json + ");", in: webView)
    }

    /// Push an event nobody asked for, to every surface: the chrome document
    /// needs to redraw its tab strip, and a skin may be listening.
    func emit(_ event: String, payload: Any) {
        let object: [String: Any] = ["event": event, "payload": payload]
        guard let json = Bridge.encode(object) else { return }
        let script: String = "window.__oriel_bridge_event && window.__oriel_bridge_event(" + json + ");"
        factory?.forEachWebView { webView in
            self.evaluate(script, in: webView)
        }
    }

    /// `oriel.tabs.onChanged` from docs/BROWSER-API.md §2.2. The whole list
    /// rides along so the chrome document can redraw without a round trip.
    func emitTabsChanged(_ reason: String, _ store: TabStore) {
        emit("tabs.changed", payload: ["reason": reason, "tabs": jsonTabs(store)])
    }

    private func evaluate(_ script: String, in webView: WKWebView) {
        // The explicit completion handler is not decoration: it picks the
        // callback overload rather than the `async` one, which is the form
        // that has been stable since iOS 8.
        webView.evaluateJavaScript(script) { _, _ in }
    }
}
