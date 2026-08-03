import Core
import Foundation
import WebKit

/// One captured line from an injected script.
struct LogEntry: Identifiable, Hashable, Sendable {
    let id: UUID
    let at: Date
    let scriptID: String
    let level: String
    let message: String
}

/// Receives `postMessage` from injected scripts.
///
/// Not `@MainActor`: `WKScriptMessageHandler` conformance is not main-actor
/// bound, so this stays nonisolated and hops explicitly, carrying only
/// `Sendable` scalars across. Marking the class `@MainActor` and hoping is the
/// most common way this file fails to compile under Swift 6.
final class ScriptBridge: NSObject, WKScriptMessageHandler {

    static let logHandlerName = "scriptLog"

    private let onLog: @MainActor (LogEntry) -> Void

    init(onLog: @escaping @MainActor (LogEntry) -> Void) {
        self.onLog = onLog
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == ScriptBridge.logHandlerName else {
            return
        }
        guard let body = message.body as? [String: Any] else {
            return
        }

        let level = body["level"] as? String ?? "log"
        let scriptID = body["script"] as? String ?? "?"
        let text = body["msg"] as? String ?? ""

        let entry = LogEntry(
            id: UUID(),
            at: Date(),
            scriptID: scriptID,
            level: level,
            message: text
        )

        let handler = onLog
        Task { @MainActor in
            handler(entry)
        }
    }
}
