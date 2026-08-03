import Core
import Foundation
import SwiftUI
import UIKit
import WebKit

/// The app's single source of truth.
///
/// Deliberately thin: every decision that can be expressed against value types
/// — which scripts match, whether a settings change needs a rebuild, how
/// built-ins merge with user scripts — lives in `Core` and is tested. What is
/// left here is wiring, which is the part no one on this project can compile.
@MainActor
final class AppModel: ObservableObject {

    @Published private(set) var state: AppState
    @Published private(set) var scripts: [Script] = []
    @Published private(set) var log: [LogEntry] = []
    @Published var currentURL: URL?
    @Published var pageTitle: String = ""
    @Published var canGoBack: Bool = false
    @Published var isLoading: Bool = false

    /// Bumped whenever the webview must be thrown away and rebuilt. The browser
    /// view keys its representable on this, so SwiftUI does the recreation.
    @Published private(set) var webViewGeneration: Int = 0

    /// Surfaced on screen rather than silently swallowed — a store that failed
    /// to save looks exactly like one that worked until the app relaunches.
    @Published var storeProblem: String?

    private let store: FileStore
    private let builtins: [String: String]
    private var injection: InjectionController?
    private weak var webView: WKWebView?
    private let media: MediaCoordinator

    private static let maxLogEntries = 500

    init(store: FileStore, builtins: [String: String], media: MediaCoordinator) {
        self.store = store
        self.builtins = builtins
        self.media = media

        let loaded = store.load()
        self.state = ScriptCatalog.pruneOrphanedState(
            builtins: Set(builtins.keys),
            state: loaded.state
        )
        if loaded.recoveredFromCorruption {
            self.storeProblem =
                "Saved data could not be read and was reset. The old file was kept as "
                + "oriel-state.json.corrupt."
        }
        refreshScripts()
    }

    // MARK: - Wiring

    func attach(webView: WKWebView, injection: InjectionController) {
        self.webView = webView
        self.injection = injection
        injection.rebuild(with: scripts)
        media.apply(settings: state.settings)
    }

    func record(_ entry: LogEntry) {
        log.append(entry)
        if log.count > AppModel.maxLogEntries {
            log.removeFirst(log.count - AppModel.maxLogEntries)
        }
    }

    func clearLog() {
        log.removeAll()
    }

    // MARK: - Derived

    /// Scripts that would run on the page currently open — what the toolbar's
    /// scripts button shows.
    var scriptsForCurrentPage: [Script] {
        guard let url = currentURL?.absoluteString else {
            return []
        }
        return ScriptResolver.scripts(for: url, in: scripts)
    }

    // MARK: - Mutation
    //
    // Every mutator funnels through `persist`, so there is exactly one place
    // that can forget to save.

    func setSettings(_ newSettings: Settings) {
        let old = state.settings
        state.settings = newSettings
        persist()

        media.apply(settings: newSettings)

        if newSettings.requiresWebViewRebuild(comparedTo: old) {
            // The config flags were copied into the existing webview at
            // creation and cannot be changed. Rebuilding is the only way these
            // toggles can mean anything at all.
            rebuildWebView()
        } else if let webView {
            WebViewFactory.apply(settings: newSettings, to: webView)
        }
    }

    func setEnabled(_ isEnabled: Bool, forScriptID id: String) {
        if let index = state.scripts.firstIndex(where: { $0.id == id }) {
            state.scripts[index].isEnabled = isEnabled
        } else if builtins[id] != nil {
            let existing = state.builtinState[id]
            state.builtinState[id] = BuiltinState(
                isEnabled: isEnabled,
                order: existing?.order ?? 0
            )
        }
        persist()
        refreshScripts()
        reinject()
    }

    func upsertUserScript(id: String?, source: String) -> String {
        let scriptID = id ?? UUID().uuidString
        let script = Script(
            id: scriptID,
            source: source,
            isEnabled: true,
            order: id == nil ? nextUserOrder() : currentOrder(of: scriptID),
            origin: .user
        )
        if let index = state.scripts.firstIndex(where: { $0.id == scriptID }) {
            state.scripts[index] = script
        } else {
            state.scripts.append(script)
        }
        persist()
        refreshScripts()
        reinject()
        return scriptID
    }

    func deleteUserScript(id: String) {
        state.scripts.removeAll { $0.id == id }
        state.scriptValues.removeValue(forKey: id)
        persist()
        refreshScripts()
        reinject()
    }

    /// "Duplicate & edit" for a built-in — decision 002's answer to editing
    /// something that lives read-only in the bundle. The built-in is untouched
    /// and keeps its own enabled state.
    func duplicateForEditing(id: String) -> String? {
        guard let source = builtins[id] else {
            return nil
        }
        let copy = source.replacingOccurrences(
            of: "// @name",
            with: "// @name        Copy of",
            options: [],
            range: source.range(of: "// @name")
        )
        return upsertUserScript(id: nil, source: copy)
    }

    func addBookmark(title: String, url: String) {
        let bookmark = Bookmark(
            id: UUID().uuidString,
            title: title,
            url: url,
            order: (state.bookmarks.map { $0.order }.max() ?? -1) + 1
        )
        state.bookmarks.append(bookmark)
        persist()
    }

    func deleteBookmark(id: String) {
        state.bookmarks.removeAll { $0.id == id }
        persist()
    }

    // MARK: - Webview actions

    func load(_ url: URL) {
        currentURL = url
        webView?.load(URLRequest(url: url))
    }

    func goBack() {
        webView?.goBack()
    }

    func reload() {
        webView?.reload()
    }

    /// The only way into Picture-in-Picture.
    ///
    /// §7.1 rates a user-tapped button as the one reliable mechanism, and the
    /// gesture is why: `requestPictureInPicture()` outside genuine user
    /// activation fails *silently*. This must stay wired to a real tap — never
    /// to `visibilitychange`, a timer, or a navigation callback.
    func enterPictureInPicture() {
        guard let webView else {
            return
        }
        webView.evaluateJavaScript("window.__inj.media.enterPiP()", in: nil, in: .page) {
            [weak self] result in
            guard let self else {
                return
            }
            let outcome: String
            switch result {
            case .success(let value):
                outcome = String(describing: value)
            case .failure(let error):
                outcome = "failed: \(error)"
            }
            // Surfaced rather than swallowed: "unsupported" and "no-media" are
            // the two cases where the button legitimately does nothing, and a
            // button that appears dead is the worst possible outcome.
            if outcome != "requested" {
                self.record(
                    LogEntry(
                        id: UUID(),
                        at: Date(),
                        scriptID: "pip",
                        level: "warn",
                        message: "Picture in Picture: \(outcome)"
                    )
                )
            }
        }
    }

    func mediaStateChanged(_ state: MediaState) {
        media.setPlaying(state.playing)
        if state.hasMedia, state.playing {
            media.nowPlaying(
                title: state.title,
                duration: state.duration,
                elapsed: state.currentTime,
                rate: 1
            )
        } else if state.hasMedia == false {
            media.clearNowPlaying()
        }
    }

    /// §6's "Run on current page now" — the feature that makes on-device
    /// authoring bearable, because the alternative is a reload per keystroke.
    ///
    /// Runs the wrapped form, not the raw source, so what the user sees here is
    /// what they get after a reload — including the match guard. A script that
    /// does not match the current page will correctly do nothing.
    func runOnCurrentPage(source: String, id: String) {
        guard let webView else {
            return
        }
        let metadata = UserScriptMetadata.parse(source)
        let wrapped = WrapperBuilder.wrap(id: id, metadata: metadata, source: source)
        webView.evaluateJavaScript(wrapped, in: nil, in: .page) { _ in }
    }

    func rebuildWebView() {
        webViewGeneration += 1
    }

    // MARK: - Internals

    private func reinject() {
        injection?.rebuild(with: scripts)
    }

    private func refreshScripts() {
        scripts = ScriptCatalog.merge(builtins: builtins, state: state)
    }

    private func nextUserOrder() -> Int {
        return (state.scripts.map { $0.order }.max() ?? 0) + 1
    }

    private func currentOrder(of id: String) -> Int {
        return state.scripts.first(where: { $0.id == id })?.order ?? nextUserOrder()
    }

    private func persist() {
        do {
            try store.save(state)
            storeProblem = nil
        } catch {
            storeProblem = "Could not save: \(error)"
        }
    }
}
