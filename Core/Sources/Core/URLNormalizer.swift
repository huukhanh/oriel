import Foundation

/// Turns what someone types in an address bar into a URL.
///
/// In `Core` rather than in the address-bar view because it is entirely
/// decidable from a string, and the interesting cases — a bare hostname, a
/// search phrase, a URL with a query that merely looks like a phrase — are
/// exactly the ones worth a test table. Inlined into a SwiftUI `onSubmit` it
/// would be a guess.
public enum URLNormalizer {

    /// `nil` when there is nothing usable to load.
    public static func url(from text: String, searchTemplate: String = defaultSearchTemplate)
        -> URL?
    {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else {
            return nil
        }

        if let scheme = trimmed.range(of: "://") {
            let prefix = String(trimmed[trimmed.startIndex..<scheme.lowerBound]).lowercased()
            // Anything exotic — javascript:, data:, file: — is treated as a
            // search rather than loaded. A typed `javascript:` URL is either a
            // mistake or an attack, and neither deserves to run.
            guard prefix == "http" || prefix == "https" else {
                return search(for: trimmed, template: searchTemplate)
            }
            return URL(string: trimmed)
        }

        // A space means it is a phrase, not a host. So does the absence of a
        // dot — "localhost" aside, single words are searches.
        if trimmed.contains(" ") || trimmed.contains(".") == false {
            return search(for: trimmed, template: searchTemplate)
        }

        // A leading dot or a trailing-only dot is not a host anyone meant.
        if trimmed.hasPrefix(".") || trimmed.hasSuffix(".") {
            return search(for: trimmed, template: searchTemplate)
        }

        return URL(string: "https://\(trimmed)")
    }

    public static let defaultSearchTemplate = "https://duckduckgo.com/?q={query}"

    private static func search(for text: String, template: String) -> URL? {
        let encoded =
            text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)?
            // `+` is legal in a query but means "space" to most search
            // engines, so a search for "a+b" would silently become "a b".
            .replacingOccurrences(of: "+", with: "%2B") ?? text
        return URL(string: template.replacingOccurrences(of: "{query}", with: encoded))
    }
}
