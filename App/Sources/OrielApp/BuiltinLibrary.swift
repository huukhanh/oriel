import Core
import Foundation

/// Reads the built-in scripts and the injection prelude out of the app bundle.
///
/// Per `docs/decisions/002-builtin-script-storage.md` built-in *source* is a
/// read-only bundle resource and is never copied into the store — only the
/// user's enabled/order state is persisted. So this is the only place built-in
/// source comes from, and "reset to default" is free: stop reading the store.
public enum BuiltinLibrary {

    /// Built-in ids, in the order they should sit in a fresh install.
    /// Source of truth for what ships; `ScriptCatalog` assigns their ordering.
    public static let ids: [String] = [
        "visibility-spoof",
        "playsinline",
    ]

    /// `id` → source, for whatever is actually present in the bundle.
    ///
    /// A missing resource is skipped rather than fatal. A built-in that failed
    /// to make it into the target should cost the user that one feature, not
    /// the whole app — and the log will say which.
    public static func load(bundle: Bundle = .main) -> [String: String] {
        var result: [String: String] = [:]
        for id in ids {
            guard let url = bundle.url(forResource: id, withExtension: "js") else {
                continue
            }
            guard let source = try? String(contentsOf: url, encoding: .utf8) else {
                continue
            }
            result[id] = source
        }
        return result
    }

    /// Ids declared above but absent from the bundle — surfaced in the log
    /// rather than silently missing, because "the toggle is there but nothing
    /// happens" is a miserable thing to debug on a phone.
    public static func missing(bundle: Bundle = .main) -> [String] {
        let loaded = load(bundle: bundle)
        return ids.filter { loaded[$0] == nil }
    }

    /// The injection runtime, injected before every user script.
    public static func prelude(bundle: Bundle = .main) -> String? {
        guard let url = bundle.url(forResource: "prelude", withExtension: "js") else {
            return nil
        }
        return try? String(contentsOf: url, encoding: .utf8)
    }
}
