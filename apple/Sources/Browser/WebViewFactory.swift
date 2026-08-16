import Combine
import Foundation
import UIKit
import WebKit

/// Builds and owns every web view in the browser.
///
/// Three jobs, kept together because they are all "the thing that owns a
/// `WKWebView`": building the shared configuration, holding one content web
/// view per tab id, and being the navigation delegate that feeds title and URL
/// changes back into `TabStore`. Splitting them would mean three objects
/// passing the same dictionary around.
///
/// ## The injection, which is the reason Oriel is a browser
///
/// The engine is installed as a `WKUserScript` at `.atDocumentStart`, for every
/// frame, in the **page content world**. That last part is why the plain
/// `WKUserScript(source:injectionTime:forMainFrameOnly:)` initialiser is used
/// rather than the `in:` one that takes a `WKContentWorld`: a user script added
/// without a content world goes into the page world, which is exactly what is
/// wanted, and it has been that way since iOS 8. There is no extension CSP
/// between a skin and the page, and nothing to negotiate with — see
/// docs/decisions/001-browser-not-extension.md.
///
/// The bridge message handler is registered with `add(_:name:)` for the same
/// reason: no world argument, page world, stable since iOS 8. Both halves of
/// the transport therefore live in the same world as the page, which is the
/// only arrangement in which they can see each other.
@MainActor
final class WebViewFactory: NSObject, ObservableObject, WKNavigationDelegate {
    /// Where the build phase in `apple/project.yml` puts `dist/ios/`.
    static let webDirectory: String = "Web"

    /// Appended to the default WKWebView user agent. Without a "Safari" token
    /// a fair number of sites serve a degraded page to an embedded web view.
    static let applicationNameForUserAgent: String = "Version/16.4 Mobile/15E148 Safari/604.1 Oriel/1.0"

    /// Weak on purpose: `BrowserView` owns all three objects, and every
    /// configuration built here retains the bridge as a message handler.
    private weak var bridge: Bridge?
    private weak var tabs: TabStore?

    private var contentViews: [String: WKWebView] = [:]
    private var chromeView: WKWebView?

    /// Read once, lazily, off the main bundle. The build fails long before this
    /// if the file is missing; nil here means someone hand-assembled a bundle.
    private lazy var engineSource: String? = WebViewFactory.loadEngineSource()

    override init() {
        super.init()
    }

    func connect(tabs: TabStore, bridge: Bridge) {
        self.tabs = tabs
        self.bridge = bridge
    }

    // MARK: - Content web views

    /// The web view for a tab, created and sent to its URL on first ask.
    func webView(for tab: Tab) -> WKWebView {
        if let existing = contentViews[tab.id] { return existing }

        let configuration: WKWebViewConfiguration = makeConfiguration(surface: "page", isPrivate: tab.isPrivate)
        let created: WKWebView = WKWebView(frame: CGRect.zero, configuration: configuration)
        created.navigationDelegate = self
        created.allowsBackForwardNavigationGestures = true
        contentViews[tab.id] = created
        load(tab.url, into: created)
        return created
    }

    func existingWebView(forTabID id: String) -> WKWebView? {
        return contentViews[id]
    }

    func tabID(for webView: WKWebView) -> String? {
        for (id, candidate) in contentViews where candidate === webView {
            return id
        }
        return nil
    }

    /// Tear a tab's web view down when the tab closes.
    ///
    /// The message handler is removed explicitly. `WKWebView.init` *copies* the
    /// configuration it is given, so the handler that has to go is the one on
    /// `webView.configuration`, not the one on the object that built it —
    /// forgetting this leaks every web view the browser has ever opened,
    /// because the user content controller holds the handler strongly.
    func discardWebView(forTabID id: String) {
        guard let webView = contentViews.removeValue(forKey: id) else { return }
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Bridge.messageHandlerName)
        webView.removeFromSuperview()
    }

    func forEachWebView(_ body: (WKWebView) -> Void) {
        if let chrome = chromeView { body(chrome) }
        for (_, webView) in contentViews {
            body(webView)
        }
    }

    // MARK: - The chrome web view

    /// The browser's own interface. One instance for the life of the app, so
    /// that SwiftUI re-rendering `ChromeWebView` does not reload the UI.
    func chromeWebView() -> WKWebView {
        if let existing = chromeView { return existing }

        let configuration: WKWebViewConfiguration = makeConfiguration(surface: "chrome", isPrivate: false)
        let created: WKWebView = WKWebView(frame: CGRect.zero, configuration: configuration)
        created.navigationDelegate = self
        created.isOpaque = false
        created.backgroundColor = UIColor.clear
        created.scrollView.backgroundColor = UIColor.clear
        created.scrollView.bounces = false
        chromeView = created
        loadChromeDocument(into: created)
        return created
    }

    private func loadChromeDocument(into webView: WKWebView) {
        guard let url = Bundle.main.url(
            forResource: "chrome",
            withExtension: "html",
            subdirectory: WebViewFactory.webDirectory
        ) else {
            NSLog("Oriel: %@/chrome.html is missing from the app bundle.", WebViewFactory.webDirectory)
            webView.loadHTMLString(WebViewFactory.chromeMissingHTML, baseURL: nil)
            return
        }
        // Read access is granted to the whole Web directory so chrome.html can
        // pull in its own stylesheet and scripts.
        _ = webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    // MARK: - Configuration

    private func makeConfiguration(surface: String, isPrivate: Bool) -> WKWebViewConfiguration {
        let configuration: WKWebViewConfiguration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.applicationNameForUserAgent = WebViewFactory.applicationNameForUserAgent

        // A private tab gets a data store that is thrown away with the app.
        if isPrivate {
            configuration.websiteDataStore = WKWebsiteDataStore.nonPersistent()
        }

        let controller: WKUserContentController = configuration.userContentController

        // Order matters: the surface flag and the transport have to exist
        // before the engine runs, and all three before the page's own code.
        controller.addUserScript(makeUserScript(WebViewFactory.surfaceSource(surface)))
        controller.addUserScript(makeUserScript(WebViewFactory.bootstrapSource))
        if let engine = engineSource {
            controller.addUserScript(makeUserScript(engine))
        }

        if let bridge = bridge {
            controller.add(bridge, name: Bridge.messageHandlerName)
        } else {
            NSLog("Oriel: a web view was built before the bridge was connected; it will have no host.")
        }

        return configuration
    }

    private func makeUserScript(_ source: String) -> WKUserScript {
        return WKUserScript(
            source: source,
            injectionTime: WKUserScriptInjectionTime.atDocumentStart,
            forMainFrameOnly: false
        )
    }

    // MARK: - Navigation

    private func load(_ urlString: String, into webView: WKWebView) {
        guard let url = URL(string: urlString) else {
            webView.loadHTMLString(WebViewFactory.blankPageHTML, baseURL: nil)
            return
        }
        let scheme: String = (url.scheme ?? "").lowercased()
        guard scheme == "http" || scheme == "https" else {
            // about:blank and anything else this shell will not navigate to.
            // TODO(api): a real new-tab page, once oriel.chrome.newTab exists.
            webView.loadHTMLString(WebViewFactory.blankPageHTML, baseURL: nil)
            return
        }
        _ = webView.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        syncTab(for: webView, reason: "navigated")
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        syncTab(for: webView, reason: "navigated")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        syncTab(for: webView, reason: "titled")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSLog("Oriel: navigation failed — %@", error.localizedDescription)
        syncTab(for: webView, reason: "navigated")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        NSLog("Oriel: navigation failed before it started — %@", error.localizedDescription)
        syncTab(for: webView, reason: "navigated")
    }

    /// Copy what the web view knows into the tab value, and tell the chrome.
    private func syncTab(for webView: WKWebView, reason: String) {
        guard let id = tabID(for: webView) else { return }
        guard let store = tabs else { return }

        store.update(id: id) { tab in
            if let url = webView.url {
                tab.url = url.absoluteString
            }
            if let title = webView.title, !title.isEmpty {
                tab.title = title
            }
            tab.isLoading = webView.isLoading
            tab.canGoBack = webView.canGoBack
            tab.canGoForward = webView.canGoForward
        }

        bridge?.emitTabsChanged(reason, store)
    }

    // MARK: - Bundled JavaScript

    private static func loadEngineSource() -> String? {
        guard let url = Bundle.main.url(
            forResource: "engine",
            withExtension: "js",
            subdirectory: WebViewFactory.webDirectory
        ) else {
            NSLog("Oriel: %@/engine.js is missing from the app bundle. Run 'pnpm build'.", WebViewFactory.webDirectory)
            return nil
        }
        guard let data = try? Data(contentsOf: url) else {
            NSLog("Oriel: %@/engine.js could not be read.", WebViewFactory.webDirectory)
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private static func surfaceSource(_ surface: String) -> String {
        return "window.__orielSurface = \"" + surface + "\";"
    }

    /// The JavaScript half of the transport.
    ///
    /// Kept here rather than in `engine/` because it is the transport, not the
    /// engine: it knows the message handler name and the reply shape, both of
    /// which are facts about this Swift. The engine's `ios` host is written
    /// against `window.__orielBridge.send(namespace, method, args)` and nothing
    /// below it.
    ///
    /// Deliberately ES5-flavoured and dependency-free. It runs at document
    /// start on every frame of every page, including ones that have not loaded
    /// yet, so it must not assume anything about the document.
    private static let bootstrapSource: String = #"""
    (function () {
      if (window.__orielBridge) { return; }

      var pending = Object.create(null);
      var listeners = [];
      var counter = 0;

      function send(namespace, method, args) {
        return new Promise(function (resolve, reject) {
          var handler = window.webkit
            && window.webkit.messageHandlers
            && window.webkit.messageHandlers.oriel;
          if (!handler) {
            reject(new Error("The Oriel bridge is not available here."));
            return;
          }
          counter = counter + 1;
          var id = "c" + counter;
          pending[id] = { resolve: resolve, reject: reject };
          try {
            handler.postMessage({ id: id, namespace: namespace, method: method, args: args || {} });
          } catch (error) {
            delete pending[id];
            reject(error);
          }
        });
      }

      // Called by Swift, once per command, always.
      function settle(reply) {
        if (!reply || !reply.id) { return; }
        var entry = pending[reply.id];
        if (!entry) { return; }
        delete pending[reply.id];
        if (reply.ok) {
          entry.resolve(reply.value === undefined ? null : reply.value);
          return;
        }
        var message = (reply.error && reply.error.message) || "The browser refused the request.";
        var failure = new Error(message);
        failure.code = (reply.error && reply.error.code) || "error";
        entry.reject(failure);
      }

      // Called by Swift for things nobody asked for: tabs changing, pages
      // loading. One listener throwing must not stop the others.
      function dispatch(message) {
        if (!message) { return; }
        for (var i = 0; i < listeners.length; i = i + 1) {
          try {
            listeners[i](message.event, message.payload);
          } catch (error) {
            if (window.console && window.console.error) {
              window.console.error("Oriel: an event listener threw.", error);
            }
          }
        }
      }

      window.__orielBridge = {
        host: "ios",
        surface: window.__orielSurface || "page",
        send: send,
        on: function (listener) {
          if (typeof listener !== "function") { return function () {}; }
          listeners.push(listener);
          return function () {
            var index = listeners.indexOf(listener);
            if (index >= 0) { listeners.splice(index, 1); }
          };
        }
      };

      window.__oriel_bridge_settle = settle;
      window.__oriel_bridge_event = dispatch;
    })();
    """#

    private static let blankPageHTML: String = #"""
    <!doctype html>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>New tab</title>
    <style>
      html, body { margin: 0; height: 100%; background: Canvas; color: CanvasText; }
    </style>
    <body></body>
    """#

    private static let chromeMissingHTML: String = #"""
    <!doctype html>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Chrome missing</title>
    <style>
      body { margin: 0; font: 15px -apple-system, system-ui, sans-serif; padding: 12px; }
    </style>
    <body>The browser interface is missing from this build. Run <code>pnpm build</code> and rebuild.</body>
    """#
}
