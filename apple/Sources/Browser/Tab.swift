import Foundation

/// A tab, as a plain value.
///
/// Deliberately a `struct` with no reference to a web view. The web views live
/// in `WebViewFactory`, keyed by `id`; everything about what a tab *is* lives
/// here and in `TabStore`, where it can be reasoned about without a simulator.
///
/// `Codable` because the tab list is restored on launch. Adding a property with
/// a default value is a safe change; renaming one is not, and would need the
/// storage key in `TabStore` bumped.
struct Tab: Codable, Identifiable, Equatable {
    /// What a tab shows before it has been sent anywhere.
    static let blankURL: String = "about:blank"

    let id: String
    var url: String
    var title: String
    var isPrivate: Bool
    var isLoading: Bool
    var canGoBack: Bool
    var canGoForward: Bool

    init(
        id: String = UUID().uuidString,
        url: String = Tab.blankURL,
        title: String = "",
        isPrivate: Bool = false,
        isLoading: Bool = false,
        canGoBack: Bool = false,
        canGoForward: Bool = false
    ) {
        self.id = id
        self.url = url
        self.title = title
        self.isPrivate = isPrivate
        self.isLoading = isLoading
        self.canGoBack = canGoBack
        self.canGoForward = canGoForward
    }

    /// The shape `oriel.tabs.list()` promises in docs/BROWSER-API.md §2.2.
    ///
    /// Built as a Foundation dictionary rather than encoded through `Codable`
    /// because it goes straight into `JSONSerialization` on the way to
    /// JavaScript, and because `active` is a property of the store rather than
    /// of the tab.
    ///
    /// `pinned` and `group` are here as documented and always false/null; the
    /// engine can then ship its tab UI against the final shape rather than
    /// against a shape that grows. See the TODO in `Bridge.performTabs`.
    func jsonObject(active: Bool) -> [String: Any] {
        return [
            "id": id,
            "url": url,
            "title": title,
            "active": active,
            "loading": isLoading,
            "private": isPrivate,
            "pinned": false,
            "group": NSNull(),
            "canGoBack": canGoBack,
            "canGoForward": canGoForward
        ]
    }
}
