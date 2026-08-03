import Core
import Foundation
import WebKit

/// The only place a `WKWebView` is born.
///
/// This exists because of the sharpest edge in the app (§4.2):
/// `WKWebViewConfiguration` is **copied** when the webview is created. Setting
/// a config flag afterwards does nothing — no error, no effect. A settings
/// toggle wired straight to a live webview is a toggle that silently lies.
///
/// So config-affecting settings do not mutate anything; they rebuild. The
/// decision of *whether* a change needs a rebuild lives in
/// `Settings.requiresWebViewRebuild(comparedTo:)`, in `Core`, where it is
/// tested — not here, where it could only be asserted.
@MainActor
enum WebViewFactory {

    /// What must be captured before a rebuild and restored after, so the user
    /// does not visibly lose their place.
    struct RestorationState {
        let url: URL?
        let scrollOffset: CGPoint

        init(url: URL?, scrollOffset: CGPoint) {
            self.url = url
            self.scrollOffset = scrollOffset
        }
    }

    static func make(
        settings: Settings,
        contentController: WKUserContentController
    ) -> WKWebView {
        let configuration = WKWebViewConfiguration()

        // Every one of these is copied at init. This is the only moment they
        // can be set.
        configuration.allowsInlineMediaPlayback = settings.allowsInlineMediaPlayback
        configuration.allowsPictureInPictureMediaPlayback = settings.allowsPictureInPicture
        configuration.mediaTypesRequiringUserActionForPlayback =
            settings.allowsAutoplay ? [] : .all
        configuration.websiteDataStore =
            settings.usesPersistentDataStore
            ? WKWebsiteDataStore.default()
            : WKWebsiteDataStore.nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = settings.allowsJavaScript
        configuration.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: configuration)

        // Live-changeable, so also applied on update.
        apply(settings: settings, to: webView)

        webView.allowsBackForwardNavigationGestures = true

        #if DEBUG
            // Safari's Web Inspector can then attach to the app's webview from
            // a Mac — by far the biggest quality-of-life win for authoring
            // scripts, and the only way to get a real console on device.
            webView.isInspectable = true
        #endif

        return webView
    }

    /// Settings that *can* change on a live webview. Keeping them in one
    /// function makes the split visible: anything not here needs a rebuild.
    static func apply(settings: Settings, to webView: WKWebView) {
        webView.customUserAgent = settings.customUserAgent
    }

    static func capture(from webView: WKWebView) -> RestorationState {
        return RestorationState(
            url: webView.url,
            scrollOffset: webView.scrollView.contentOffset
        )
    }

    /// Restore after a rebuild.
    ///
    /// The scroll offset cannot be applied yet — there is no content to scroll.
    /// The caller re-applies it once the navigation finishes; doing it here
    /// would silently do nothing, which is the same class of bug this whole
    /// type exists to prevent.
    static func restore(_ state: RestorationState, into webView: WKWebView) {
        guard let url = state.url else {
            return
        }
        webView.load(URLRequest(url: url))
    }
}
