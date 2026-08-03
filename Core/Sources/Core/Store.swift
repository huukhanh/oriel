import Foundation

/// Everything the app persists, in one document.
///
/// One document rather than several because the whole thing is a few kilobytes
/// and a single atomic write cannot leave the app's state half-updated.
public struct AppState: Hashable, Sendable, Codable {
    /// Bumped only when a change cannot be handled by tolerant decoding.
    public static let currentVersion: Int = 1

    public var version: Int
    public var scripts: [Script]
    public var bookmarks: [Bookmark]
    public var settings: Settings
    /// Keyed by built-in id. Source lives in the bundle, never here.
    public var builtinState: [String: BuiltinState]
    /// `GM_setValue` data, keyed by script id then by key.
    public var scriptValues: [String: [String: String]]

    public init(
        version: Int = AppState.currentVersion,
        scripts: [Script] = [],
        bookmarks: [Bookmark] = AppState.defaultBookmarks,
        settings: Settings = Settings(),
        builtinState: [String: BuiltinState] = [:],
        scriptValues: [String: [String: String]] = [:]
    ) {
        self.version = version
        self.scripts = scripts
        self.bookmarks = bookmarks
        self.settings = settings
        self.builtinState = builtinState
        self.scriptValues = scriptValues
    }

    /// A launcher with nothing in it looks broken on first run.
    public static let defaultBookmarks: [Bookmark] = [
        Bookmark(id: "youtube", title: "YouTube", url: "https://m.youtube.com/", order: 0),
        Bookmark(id: "reddit", title: "Reddit", url: "https://www.reddit.com/", order: 1),
    ]

    /// Tolerant decoding: every field takes a default when absent.
    ///
    /// This is the migration strategy. A field added in a later version simply
    /// reads as its default from an older document, and a field removed is
    /// ignored — so the common cases need no migration code at all, which is
    /// code that would be unverifiable if it lived in the app target.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decodeIfPresent(Int.self, forKey: .version) ?? 0
        scripts = try container.decodeIfPresent([Script].self, forKey: .scripts) ?? []
        bookmarks =
            try container.decodeIfPresent([Bookmark].self, forKey: .bookmarks)
            ?? AppState.defaultBookmarks
        settings = try container.decodeIfPresent(Settings.self, forKey: .settings) ?? Settings()
        builtinState =
            try container.decodeIfPresent([String: BuiltinState].self, forKey: .builtinState) ?? [:]
        scriptValues =
            try container.decodeIfPresent([String: [String: String]].self, forKey: .scriptValues)
            ?? [:]
    }
}

public enum StoreError: Error, Equatable {
    case couldNotWrite(String)
}

/// File-backed persistence.
///
/// Deliberately all Foundation, so it is provable on the Linux box rather than
/// guessed at behind SwiftData — see
/// `docs/decisions/006-codable-store-not-swiftdata.md`. The app target's only
/// job is to hand it a directory.
public final class FileStore: @unchecked Sendable {
    private let fileURL: URL
    private let backupURL: URL
    private let fileManager: FileManager
    /// Serialises reads and writes. The store is touched from the main actor
    /// and from message-handler callbacks, and a torn read is not worth the
    /// risk of assuming otherwise.
    private let lock = NSLock()

    public init(directory: URL, filename: String = "oriel-state.json") {
        self.fileURL = directory.appendingPathComponent(filename)
        self.backupURL = directory.appendingPathComponent(filename + ".corrupt")
        self.fileManager = FileManager.default
    }

    public var url: URL { fileURL }

    /// Load, or return defaults.
    ///
    /// A document that cannot be decoded is **moved aside, not deleted**, and
    /// defaults are returned. Crashing on launch because of a bad state file
    /// would leave the user with an app they cannot open to fix it — and
    /// silently deleting their scripts would be worse than either.
    public func load() -> (state: AppState, recoveredFromCorruption: Bool) {
        lock.lock()
        defer { lock.unlock() }

        guard let data = try? Data(contentsOf: fileURL) else {
            return (AppState(), false)
        }
        do {
            var state = try JSONDecoder().decode(AppState.self, from: data)
            state.version = AppState.currentVersion
            return (state, false)
        } catch {
            try? fileManager.removeItem(at: backupURL)
            try? fileManager.moveItem(at: fileURL, to: backupURL)
            return (AppState(), true)
        }
    }

    /// Write atomically, creating the directory if needed.
    public func save(_ state: AppState) throws {
        lock.lock()
        defer { lock.unlock() }

        var toWrite = state
        toWrite.version = AppState.currentVersion

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

        do {
            let directory = fileURL.deletingLastPathComponent()
            if fileManager.fileExists(atPath: directory.path) == false {
                try fileManager.createDirectory(
                    at: directory,
                    withIntermediateDirectories: true
                )
            }
            let data = try encoder.encode(toWrite)
            // .atomic writes to a temporary file and renames, so a crash or a
            // kill mid-write leaves the previous document intact rather than a
            // truncated one.
            try data.write(to: fileURL, options: .atomic)
        } catch {
            throw StoreError.couldNotWrite(String(describing: error))
        }
    }
}

/// Merges bundle built-ins with stored user scripts into the single ordered
/// list the injection engine and the UI both work from.
///
/// Kept here because the merge is exactly the awkward part of
/// [002](../../../docs/decisions/002-builtin-script-storage.md): two sources,
/// one list, one ordering. Doing it in the app target would make the app's most
/// error-prone list operation the least testable one.
public enum ScriptCatalog {

    /// - Parameters:
    ///   - builtins: id → source, read from the app bundle.
    ///   - state: the persisted document.
    public static func merge(builtins: [String: String], state: AppState) -> [Script] {
        var result: [Script] = []

        for (id, source) in builtins {
            let stored = state.builtinState[id]
            result.append(
                Script(
                    id: id,
                    source: source,
                    // Built-ins are on unless the user turned them off. A media
                    // feature the user has to discover and enable is a media
                    // feature that does not exist.
                    isEnabled: stored?.isEnabled ?? true,
                    order: stored?.order ?? defaultOrder(for: id),
                    origin: .builtIn
                )
            )
        }

        result.append(contentsOf: state.scripts)

        return result.sorted { left, right in
            if left.order != right.order {
                return left.order < right.order
            }
            return left.id < right.id
        }
    }

    /// Built-ins that override page behaviour must run before scripts that read
    /// it, so they get negative default ordering and land ahead of user scripts.
    private static func defaultOrder(for id: String) -> Int {
        switch id {
        case "visibility-spoof": return -100
        case "playsinline": return -90
        default: return -50
        }
    }

    /// Drop stored state for built-ins that no longer ship.
    ///
    /// Cheap, and it keeps a removed built-in from leaving a permanent orphan
    /// row that a future id could collide with.
    public static func pruneOrphanedState(
        builtins: Set<String>,
        state: AppState
    ) -> AppState {
        var pruned = state
        pruned.builtinState = state.builtinState.filter { builtins.contains($0.key) }
        return pruned
    }
}
