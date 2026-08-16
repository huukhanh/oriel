import Combine
import Foundation

/// The tab list and everything that happens to it.
///
/// This is the one file in `apple/` worth reading. Every rule about tabs —
/// where a new one is inserted, which one is focused when you close the current
/// one, what survives a relaunch — is here, in plain Swift over plain values,
/// rather than spread across view code. Nothing in this file touches WebKit or
/// UIKit, so its behaviour can be described exactly in a review even though
/// nobody in this project's loop can run it.
///
/// Invariants, maintained by every mutating method:
///
/// - `tabs` is never empty after `restore()`. Closing the last tab opens a
///   blank one rather than leaving a browser with nothing in it.
/// - `activeID`, when non-nil, always names a tab that is in `tabs`.
@MainActor
final class TabStore: ObservableObject {
    @Published private(set) var tabs: [Tab] = []
    @Published private(set) var activeID: String?

    private let defaults: UserDefaults
    private let storageKey: String = "oriel.tabs.v1"
    private var restored: Bool = false

    /// The persisted form. Nested so the file still has one top-level type.
    private struct SavedState: Codable {
        var tabs: [Tab]
        var activeID: String?
    }

    init(defaults: UserDefaults = UserDefaults.standard) {
        self.defaults = defaults
    }

    // MARK: - Reading

    var activeTab: Tab? {
        guard let activeID = activeID else { return nil }
        guard let position = index(of: activeID) else { return nil }
        return tabs[position]
    }

    func index(of id: String) -> Int? {
        return tabs.firstIndex(where: { $0.id == id })
    }

    func tab(withID id: String) -> Tab? {
        guard let position = index(of: id) else { return nil }
        return tabs[position]
    }

    // MARK: - Lifecycle

    /// Load the saved session, or start a fresh one.
    ///
    /// Idempotent: SwiftUI may run `onAppear` more than once for the same view,
    /// and restoring twice would either duplicate the session or throw away
    /// tabs opened in between.
    func restore() {
        if restored { return }
        restored = true

        if let data = defaults.data(forKey: storageKey) {
            let decoder: JSONDecoder = JSONDecoder()
            if let saved = try? decoder.decode(SavedState.self, from: data) {
                tabs = saved.tabs
                activeID = saved.activeID
            }
        }

        if tabs.isEmpty {
            let first: Tab = Tab()
            tabs = [first]
            activeID = first.id
        }

        // A saved active id that names a tab we no longer have would leave the
        // browser showing nothing at all.
        if let current = activeID, index(of: current) != nil { return }
        activeID = tabs.first?.id
    }

    // MARK: - Mutating

    /// Open a tab immediately after its anchor — the tab named by `after`, or
    /// the current one. Appending to the end instead is the behaviour people
    /// complain about in every browser that has it.
    @discardableResult
    func open(url: String, background: Bool = false, after: String? = nil) -> Tab {
        let destination: String = url.isEmpty ? Tab.blankURL : url
        let tab: Tab = Tab(url: destination)
        let anchorID: String = after ?? activeID ?? ""

        if let anchor = index(of: anchorID) {
            tabs.insert(tab, at: anchor + 1)
        } else {
            tabs.append(tab)
        }

        if !background { activeID = tab.id }
        persist()
        return tab
    }

    /// Close a tab, and focus its neighbour rather than jumping to the end.
    ///
    /// The neighbour is the tab that slid into the closed one's index, or the
    /// last tab if the closed one was last. Closing the final tab leaves a
    /// blank one behind.
    func close(id: String) {
        guard let position = index(of: id) else { return }
        let wasActive: Bool = (activeID == id)
        tabs.remove(at: position)

        if tabs.isEmpty {
            let replacement: Tab = Tab()
            tabs = [replacement]
            activeID = replacement.id
        } else if wasActive {
            let neighbour: Int = min(position, tabs.count - 1)
            activeID = tabs[neighbour].id
        }

        persist()
    }

    func activate(id: String) {
        guard index(of: id) != nil else { return }
        activeID = id
        persist()
    }

    /// Move a tab to an index, clamped into the list rather than trapping. The
    /// caller is JavaScript, and an out-of-range index from a skin should be a
    /// harmless no-op, not a crash on a stranger's phone.
    func move(id: String, to destination: Int) {
        guard let position = index(of: id) else { return }
        guard tabs.count > 1 else { return }

        var target: Int = destination
        if target < 0 { target = 0 }
        if target > tabs.count - 1 { target = tabs.count - 1 }
        if target == position { return }

        let moved: Tab = tabs.remove(at: position)
        tabs.insert(moved, at: target)
        persist()
    }

    /// Apply a change to one tab. The navigation callbacks in `WebViewFactory`
    /// come through here, so there is still exactly one place tabs change.
    func update(id: String, apply: (inout Tab) -> Void) {
        guard let position = index(of: id) else { return }
        var tab: Tab = tabs[position]
        apply(&tab)
        guard tab != tabs[position] else { return }
        tabs[position] = tab
        persist()
    }

    // MARK: - Persistence

    private func persist() {
        let state: SavedState = SavedState(tabs: tabs, activeID: activeID)
        let encoder: JSONEncoder = JSONEncoder()
        guard let data = try? encoder.encode(state) else { return }
        defaults.set(data, forKey: storageKey)
    }
}
