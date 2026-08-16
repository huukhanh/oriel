import Foundation

/// The wire format, in both directions.
///
/// **This file does not get to choose the format.** `hosts/ios/bridge.js` is the
/// other end, it was written first, and it is the half covered by tests. Every
/// shape below is read off that file; changing one here without changing it
/// there breaks the transport silently, because the failure looks like a call
/// that never answers.
///
/// ```
/// page  -> Swift   { id, namespace, method, args }   id is a Number, args an Array
/// Swift -> page    window.__orielReply(id, true,  value)
///                  window.__orielReply(id, false, { error, unsupported })
/// events           window.__oriel.dispatch(channel, data)
/// ```
///
/// Two things to keep hold of, both easy to get subtly wrong:
///
/// - **`id` is a number.** `createBridge` keys a `Map` with `nextId++`. Echoing
///   `"3"` back instead of `3` finds nothing in that map and the promise hangs
///   until its ten-second timeout.
/// - **`args` is positional**, not named. `oriel.tabs.open(url, options)`
///   arrives as `[url, options]`, because the host forwards `(...args)`.
///
/// Note what is *not* here: a `Codable` model. Both `args` and `value` are
/// arbitrary JSON, which `Codable` cannot express without a hand-written
/// `JSONValue` enum, and `WKScriptMessage.body` already arrives as bridged
/// Foundation objects. So the incoming direction reads a dictionary and the
/// outgoing direction hands one to `JSONSerialization`.
struct BridgeCommand {
    let id: Int
    let namespace: String
    let method: String
    let args: [Any]

    /// Parse a `WKScriptMessage.body`. Returns nil for anything that is not a
    /// well-formed command — a page can post whatever it likes to a message
    /// handler, and a malformed one is dropped rather than answered, since
    /// there is no id to answer to.
    init?(body: Any) {
        guard let dictionary = body as? [String: Any] else { return nil }
        guard let namespace = dictionary["namespace"] as? String else { return nil }
        guard let method = dictionary["method"] as? String else { return nil }

        // JavaScript numbers arrive as NSNumber. An id that is not a whole
        // number could not be echoed back to the right map entry anyway.
        guard let rawID = dictionary["id"] as? NSNumber else { return nil }

        self.id = rawID.intValue
        self.namespace = namespace
        self.method = method
        self.args = (dictionary["args"] as? [Any]) ?? []
    }

    /// `namespace.method`, for error messages.
    var name: String {
        return namespace + "." + method
    }

    func string(at index: Int) -> String? {
        guard index >= 0, index < args.count else { return nil }
        return args[index] as? String
    }

    func int(at index: Int) -> Int? {
        guard index >= 0, index < args.count else { return nil }
        if let value = args[index] as? NSNumber { return value.intValue }
        return nil
    }

    /// An options object — the `{ background, after }` in
    /// `oriel.tabs.open(url, { background, after })`.
    func options(at index: Int) -> [String: Any] {
        guard index >= 0, index < args.count else { return [:] }
        return (args[index] as? [String: Any]) ?? [:]
    }

    func flag(_ key: String, in options: [String: Any], or fallback: Bool) -> Bool {
        if let value = options[key] as? NSNumber { return value.boolValue }
        if let value = options[key] as? Bool { return value }
        return fallback
    }
}

/// The answer to a `BridgeCommand`.
///
/// Every command gets exactly one, including the ones this shell does not
/// implement — `unsupported` is a reply, not a silence. A dropped reply leaves
/// the caller waiting for `createBridge`'s ten-second timeout, which reads as
/// slowness rather than as a bug.
///
/// The failure payload is shaped for `toError` in `hosts/ios/bridge.js`: it
/// reads `error` for the message and `unsupported` to decide whether this is a
/// missing capability or a real failure. `code` is extra, and ignored there.
struct BridgeReply {
    let id: Int
    let ok: Bool
    let value: Any?
    let errorCode: String?
    let errorMessage: String?
    let isUnsupported: Bool

    static func success(_ id: Int, _ value: Any?) -> BridgeReply {
        return BridgeReply(
            id: id,
            ok: true,
            value: value,
            errorCode: nil,
            errorMessage: nil,
            isUnsupported: false
        )
    }

    static func failure(_ id: Int, code: String, message: String) -> BridgeReply {
        return BridgeReply(
            id: id,
            ok: false,
            value: nil,
            errorCode: code,
            errorMessage: message,
            isUnsupported: false
        )
    }

    /// The documented answer for anything this shell has not built yet. The
    /// engine turns it into a `HostUnsupportedError` and a skin degrades,
    /// exactly as docs/BROWSER-API.md §4 says it should.
    static func unsupported(_ id: Int, _ name: String) -> BridgeReply {
        return BridgeReply(
            id: id,
            ok: false,
            value: nil,
            errorCode: "unsupported",
            errorMessage: "The iOS browser shell does not implement \"" + name + "\" yet.",
            isUnsupported: true
        )
    }

    /// The three arguments of `window.__orielReply(id, ok, value)`, as one JSON
    /// array. Sent that way, and `apply`d, so a value that is an array, an
    /// object, a string or null all cross without a special case here — and
    /// without needing JSONSerialization's fragment option.
    ///
    /// The third argument is the full `{ ok, value }` envelope rather than the
    /// bare value, which is what `test/ios-bridge.test.js` demonstrates as
    /// "exactly what Swift does". `unwrap` on the other side peels it. Sending
    /// the bare value would work for everything this shell returns today and
    /// then quietly mangle the first payload that happened to have its own
    /// `value` or `ok` key.
    func callArguments() -> [Any] {
        if ok {
            let envelope: [String: Any] = ["ok": true, "value": value ?? NSNull()]
            return [id, true, envelope]
        }

        // Read by `toError` in hosts/ios/bridge.js: `error` is the message, and
        // `unsupported` is what makes "not built yet" a missing capability
        // rather than a bug in the skin. `code` is extra, and ignored there.
        let payload: [String: Any] = [
            "ok": false,
            "error": errorMessage ?? "The browser refused the request.",
            "code": errorCode ?? "error",
            "unsupported": isUnsupported
        ]
        return [id, false, payload]
    }
}
