import Foundation

/// The wire format, in both directions.
///
/// Two small value types rather than one per file, because they are one thing:
/// the shape of a message crossing the bridge. Changing either without changing
/// the JavaScript in `WebViewFactory.bootstrapSource` breaks the transport, and
/// keeping them adjacent makes that obvious.
///
/// ```
/// page -> Swift   { id, namespace, method, args }
/// Swift -> page   { id, ok: true,  value }
///                 { id, ok: false, error: { code, message } }
/// ```
///
/// Note what is *not* here: a `Codable` model of `args` and `value`. Both are
/// arbitrary JSON, which `Codable` cannot express without a hand-written
/// `JSONValue` enum, and `WKScriptMessage.body` already arrives as bridged
/// Foundation objects. So the incoming direction reads a dictionary and the
/// outgoing direction hands one to `JSONSerialization`. Boring, and no API
/// surface to get wrong.
struct BridgeCommand {
    let id: String
    let namespace: String
    let method: String
    let args: [String: Any]

    /// Parse a `WKScriptMessage.body`. Returns nil for anything that is not a
    /// well-formed command — a page can post whatever it likes to a message
    /// handler, and a malformed one is dropped rather than answered.
    init?(body: Any) {
        guard let dictionary = body as? [String: Any] else { return nil }
        guard let id = dictionary["id"] as? String else { return nil }
        guard let namespace = dictionary["namespace"] as? String else { return nil }
        guard let method = dictionary["method"] as? String else { return nil }

        self.id = id
        self.namespace = namespace
        self.method = method
        self.args = (dictionary["args"] as? [String: Any]) ?? [:]
    }

    /// `namespace.method`, for error messages and logging.
    var name: String {
        return namespace + "." + method
    }

    func string(_ key: String) -> String? {
        return args[key] as? String
    }

    /// JavaScript numbers and booleans arrive as `NSNumber`, so both the native
    /// cast and the `NSNumber` reading are tried.
    func bool(_ key: String, or fallback: Bool) -> Bool {
        if let value = args[key] as? Bool { return value }
        if let value = args[key] as? NSNumber { return value.boolValue }
        return fallback
    }

    func int(_ key: String) -> Int? {
        if let value = args[key] as? Int { return value }
        if let value = args[key] as? NSNumber { return value.intValue }
        return nil
    }
}

/// The answer to a `BridgeCommand`.
///
/// Every command gets exactly one of these, including the ones this shell does
/// not implement — `unsupported` is a reply, not a silence. A dropped reply
/// leaves a promise pending forever on the JavaScript side, which is the worst
/// failure this transport can have because it looks like slowness.
struct BridgeReply {
    let id: String
    let ok: Bool
    let value: Any?
    let errorCode: String?
    let errorMessage: String?

    static func success(_ id: String, _ value: Any?) -> BridgeReply {
        return BridgeReply(id: id, ok: true, value: value, errorCode: nil, errorMessage: nil)
    }

    static func failure(_ id: String, code: String, message: String) -> BridgeReply {
        return BridgeReply(id: id, ok: false, value: nil, errorCode: code, errorMessage: message)
    }

    /// The documented answer for anything this shell has not built yet. The
    /// engine can branch on `code == "unsupported"` and degrade, exactly as
    /// docs/BROWSER-API.md §4 says a skin should.
    static func unsupported(_ id: String, _ name: String) -> BridgeReply {
        return failure(
            id,
            code: "unsupported",
            message: "The iOS browser shell does not implement \"" + name + "\" yet."
        )
    }

    func jsonObject() -> [String: Any] {
        var object: [String: Any] = ["id": id, "ok": ok]
        if ok {
            if let value = value {
                object["value"] = value
            } else {
                // Written out rather than `value ?? NSNull()` so the type of
                // the expression is not something a reader has to work out.
                object["value"] = NSNull()
            }
        } else {
            object["error"] = [
                "code": errorCode ?? "error",
                "message": errorMessage ?? "The browser refused the request."
            ]
        }
        return object
    }
}
