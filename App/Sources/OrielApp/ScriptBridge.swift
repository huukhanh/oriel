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
/// What the page reports about its media, for Now Playing and the idle timer.
struct MediaState: Sendable, Equatable {
    var hasMedia: Bool
    var playing: Bool
    var currentTime: Double
    var duration: Double
    var title: String
}

final class ScriptBridge: NSObject, WKScriptMessageHandler {

    static let logHandlerName = "scriptLog"
    static let mediaHandlerName = "mediaState"

    private let onLog: @MainActor (LogEntry) -> Void
    private let onMedia: @MainActor (MediaState) -> Void

    init(
        onLog: @escaping @MainActor (LogEntry) -> Void,
        onMedia: @escaping @MainActor (MediaState) -> Void
    ) {
        self.onLog = onLog
        self.onMedia = onMedia
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any] else {
            return
        }

        switch message.name {
        case ScriptBridge.logHandlerName:
            let entry = LogEntry(
                id: UUID(),
                at: Date(),
                scriptID: body["script"] as? String ?? "?",
                level: body["level"] as? String ?? "log",
                message: body["msg"] as? String ?? ""
            )
            let handler = onLog
            Task { @MainActor in
                handler(entry)
            }

        case ScriptBridge.mediaHandlerName:
            // `duration` is NaN on a media element with no metadata yet, and a
            // NaN reaching MPNowPlayingInfoCenter shows up as a broken
            // lock-screen scrubber. Clamp it here, once.
            let state = MediaState(
                hasMedia: body["hasMedia"] as? Bool ?? false,
                playing: body["playing"] as? Bool ?? false,
                currentTime: ScriptBridge.finite(body["currentTime"]),
                duration: ScriptBridge.finite(body["duration"]),
                title: body["title"] as? String ?? ""
            )
            let handler = onMedia
            Task { @MainActor in
                handler(state)
            }

        default:
            break
        }
    }

    static func finite(_ value: Any?) -> Double {
        guard let number = value as? Double, number.isFinite else {
            return 0
        }
        return number
    }
}
