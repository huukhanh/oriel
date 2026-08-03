import Core
import Foundation
import WebKit

/// Backs `GM_setValue` / `GM_getValue`.
///
/// A separate handler type from `ScriptBridge` because it needs a *reply*:
/// `WKScriptMessageHandlerWithReply` resolves a JavaScript promise, whereas the
/// plain handler is fire-and-forget. Registering one with the other's `add`
/// overload compiles and then silently never delivers.
///
/// **Nonisolated, and it owns its own data.** The protocol is nonisolated in the
/// real SDK — unlike `WKNavigationDelegate`, which *is* `@MainActor` — and
/// `replyHandler` is a non-`Sendable` closure, so it cannot be carried to the
/// main actor to reach state that lives there. Rather than fight that, the
/// bridge keeps a lock-guarded copy and answers synchronously; writes are
/// mirrored to `AppModel` afterwards, with only `Sendable` strings crossing.
///
/// The side benefit is that a script reading a value never waits on the main
/// actor — which is the thread rendering the page it is running in.
final class ScriptStoreBridge: NSObject, WKScriptMessageHandlerWithReply, @unchecked Sendable {

    static let handlerName = "scriptStore"

    private let lock = NSLock()
    /// script id → key → JSON-encoded value.
    private var values: [String: [String: String]]

    /// Called after a write so the durable store catches up. Fire-and-forget:
    /// the reply has already gone back to JavaScript by then.
    private let persist: @MainActor (String, String, String?) -> Void

    init(
        initialValues: [String: [String: String]],
        persist: @escaping @MainActor (String, String, String?) -> Void
    ) {
        self.values = initialValues
        self.persist = persist
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let body = message.body as? [String: Any],
            let op = body["op"] as? String,
            let scriptID = body["script"] as? String
        else {
            replyHandler(nil, "malformed storage request")
            return
        }

        let key = body["key"] as? String ?? ""
        let value = body["value"] as? String

        switch op {
        case "get":
            replyHandler(read(scriptID: scriptID, key: key), nil)

        case "set":
            write(scriptID: scriptID, key: key, value: value)
            replyHandler(nil, nil)

        case "delete":
            write(scriptID: scriptID, key: key, value: nil)
            replyHandler(nil, nil)

        case "list":
            replyHandler(keys(scriptID: scriptID), nil)

        default:
            replyHandler(nil, "unknown storage op: \(op)")
        }
    }

    // MARK: - storage

    func read(scriptID: String, key: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        return values[scriptID]?[key]
    }

    func keys(scriptID: String) -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return (values[scriptID].map { Array($0.keys) } ?? []).sorted()
    }

    func write(scriptID: String, key: String, value: String?) {
        lock.lock()
        var bucket = values[scriptID] ?? [:]
        if let value {
            bucket[key] = value
        } else {
            bucket.removeValue(forKey: key)
        }
        if bucket.isEmpty {
            values.removeValue(forKey: scriptID)
        } else {
            values[scriptID] = bucket
        }
        lock.unlock()

        let persist = self.persist
        Task { @MainActor in
            persist(scriptID, key, value)
        }
    }
}
