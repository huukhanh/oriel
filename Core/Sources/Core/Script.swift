import Foundation

/// Where a script came from.
///
/// Per `docs/decisions/002-builtin-script-storage.md`, built-ins are read-only
/// files in the app bundle and only their *state* is persisted. So this is not
/// a stored flag on one table — it records which of the two sources a `Script`
/// was merged in from.
public enum ScriptOrigin: String, Hashable, Sendable, Codable {
    case builtIn
    case user
}

/// A script as the injection engine sees it: built-ins and user scripts already
/// merged into one ordered list.
///
/// Plain `Codable` value type with no persistence machinery, per
/// `docs/decisions/003-minimum-ios.md`. SwiftData `@Model` types live in the app
/// target and convert to and from this — which is what keeps every decision
/// about matching, ordering and enablement testable on a machine with no Xcode.
public struct Script: Identifiable, Hashable, Sendable, Codable {
    /// Stable across edits and across app launches. Built-ins use their bundle
    /// resource name; user scripts get a UUID string at creation.
    public let id: String
    public var name: String
    public var source: String
    public var isEnabled: Bool
    /// Injection order is list order. Lower runs first.
    public var order: Int
    public var origin: ScriptOrigin
    public var metadata: UserScriptMetadata

    public init(
        id: String,
        name: String,
        source: String,
        isEnabled: Bool = true,
        order: Int = 0,
        origin: ScriptOrigin = .user,
        metadata: UserScriptMetadata
    ) {
        self.id = id
        self.name = name
        self.source = source
        self.isEnabled = isEnabled
        self.order = order
        self.origin = origin
        self.metadata = metadata
    }

    /// Build from source, taking the name from `@name` when the caller has none.
    public init(
        id: String,
        source: String,
        isEnabled: Bool = true,
        order: Int = 0,
        origin: ScriptOrigin = .user
    ) {
        let metadata = UserScriptMetadata.parse(source)
        self.init(
            id: id,
            name: metadata.name ?? "Untitled",
            source: source,
            isEnabled: isEnabled,
            order: order,
            origin: origin,
            metadata: metadata
        )
    }

    /// Whether this script should run on `url` — enabled **and** matching.
    ///
    /// Both halves matter: a disabled script that still matches is the bug the
    /// user notices, because they turned it off to fix a site and the site
    /// stayed broken.
    public func applies(to url: String) -> Bool {
        guard isEnabled else {
            return false
        }
        return metadata.matches.contains { $0.matches(url) }
    }
}

/// A launcher entry. The brainstorm's §3 `Site`.
public struct Bookmark: Identifiable, Hashable, Sendable, Codable {
    public let id: String
    public var title: String
    public var url: String
    public var order: Int

    public init(id: String, title: String, url: String, order: Int = 0) {
        self.id = id
        self.title = title
        self.url = url
        self.order = order
    }
}

/// Decides which scripts run on a URL, and in what order.
///
/// This is the whole of the injection engine's decision-making, kept in
/// Foundation-only code so it is provable here rather than guessed at inside a
/// `WKNavigationDelegate`.
///
/// Note what is *not* modelled: the brainstorm's §3 diagram has a `Binding`
/// type joining scripts to sites. There is nothing for it to store —
/// a script's scope is its `@match` patterns, so any binding table would be a
/// second, derived source of truth for the same fact, free to disagree with the
/// first. Scope lives in one place.
public enum ScriptResolver {

    /// Enabled, matching scripts in injection order.
    ///
    /// Ties on `order` fall back to `id` so the result is deterministic. An
    /// unstable injection order would make one script's effect on another
    /// depend on dictionary iteration — a bug that reproduces only sometimes.
    public static func scripts(for url: String, in scripts: [Script]) -> [Script] {
        return
            scripts
            .filter { $0.applies(to: url) }
            .sorted { left, right in
                if left.order != right.order {
                    return left.order < right.order
                }
                return left.id < right.id
            }
    }

    /// Every enabled script matching `url`, whatever its origin — what the
    /// toolbar's "scripts affecting this page" panel shows.
    public static func summary(for url: String, in scripts: [Script]) -> (
        builtIn: [Script], user: [Script]
    ) {
        let matching = self.scripts(for: url, in: scripts)
        return (
            builtIn: matching.filter { $0.origin == .builtIn },
            user: matching.filter { $0.origin == .user }
        )
    }
}
