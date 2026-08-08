import Foundation

/// The last few pages visited, for the home screen.
///
/// In `Core` because the awkward parts are pure logic: de-duplication, a bound
/// on growth, and the fact that "most recent" means moving an existing entry
/// rather than adding a second copy of it.
public struct RecentURLs: Hashable, Sendable, Codable {

    /// Small on purpose. This is a shortcut list on a phone screen, not history
    /// — an unbounded list is a scrolling chore and a privacy footgun.
    public static let limit: Int = 12

    public private(set) var entries: [Entry]

    public struct Entry: Hashable, Sendable, Codable, Identifiable {
        public var url: String
        public var title: String
        public var id: String { url }

        public init(url: String, title: String) {
            self.url = url
            self.title = title
        }
    }

    public init(entries: [Entry] = []) {
        self.entries = entries
    }

    /// Record a visit. Most recent first.
    ///
    /// Revisiting a page moves it to the front and refreshes its title rather
    /// than adding a duplicate — a list showing the same site six times is
    /// worse than no list.
    public mutating func record(url: String, title: String) {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else {
            return
        }
        // Blank and placeholder pages are not somewhere the user chose to go.
        guard trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") else {
            return
        }

        entries.removeAll { $0.url == trimmed }
        let displayTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        entries.insert(
            Entry(url: trimmed, title: displayTitle.isEmpty ? trimmed : displayTitle),
            at: 0
        )
        if entries.count > RecentURLs.limit {
            entries.removeLast(entries.count - RecentURLs.limit)
        }
    }

    public mutating func remove(url: String) {
        entries.removeAll { $0.url == url }
    }

    public mutating func clear() {
        entries.removeAll()
    }
}
