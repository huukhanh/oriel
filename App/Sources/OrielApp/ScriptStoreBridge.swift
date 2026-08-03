import Core
import Foundation
import WebKit

/// Backs `GM_setValue` / `GM_getValue`.
///
/// A separate handler type from `ScriptBridge` because it needs a *reply*:
/// `WKScriptMessageHandlerWithReply` resolves a JavaScript promise, whereas the
/// plain handler is fire-and-forget. Mixing the two on one object would mean one
/// of the protocol methods silently never being called.
///
/// Values are stored per script id, so two scripts using the key `"count"` do
/// not collide — and deleting a script takes its data with it.
/// `@MainActor`, like the other WebKit handler protocols. That matters here
/// beyond tidiness: `replyHandler` is a non-`Sendable` closure, so hopping to
/// another actor to call it is a data race the compiler rejects outright.
@MainActor
final class ScriptStoreBridge: NSObject, WKScriptMessageHandlerWithReply {

    static let handlerName = "scriptStore"

    /// Reads and writes run on the main actor, where `AppModel` owns the state.
    private let read: @MainActor (String, String) -> String?
    private let write: @MainActor (String, String, String?) -> Void
    private let list: @MainActor (String) -> [String]

    init(
        read: @escaping @MainActor (String, String) -> String?,
        write: @escaping @MainActor (String, String, String?) -> Void,
        list: @escaping @MainActor (String) -> [String]
    ) {
        self.read = read
        self.write = write
        self.list = list
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
            replyHandler(read(scriptID, key), nil)
        case "set":
            write(scriptID, key, value)
            replyHandler(nil, nil)
        case "delete":
            write(scriptID, key, nil)
            replyHandler(nil, nil)
        case "list":
            replyHandler(list(scriptID), nil)
        default:
            replyHandler(nil, "unknown storage op: \(op)")
        }
    }
}
