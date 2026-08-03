import Foundation

/// One recorded observation. Deliberately stringly-typed — this is a spike and
/// the output is meant to be pasted into a GitHub comment, not parsed.
struct ProbeEvent: Identifiable {
    let id: UUID
    let at: Date
    let kind: String
    let detail: String
}

/// Collects everything the spike observes so the answer survives to the
/// foreground.
///
/// This is the actual measuring instrument. The JS probe heartbeats once a
/// second; when WebKit's media process gets suspended, the heartbeats stop.
/// So a **gap in the heartbeat stream is the suspension**, and its length is
/// the answer to "does it survive 10 minutes". Recording it in Swift means the
/// evidence is still here after the app comes back.
@MainActor
final class ProbeLog: ObservableObject {
    /// A heartbeat is emitted every second. Anything beyond this is a stall
    /// worth recording rather than routine jitter.
    private static let gapThreshold: TimeInterval = 3.0

    /// Bounded so a 30-minute run cannot grow without limit.
    private static let maxEvents: Int = 500

    @Published private(set) var events: [ProbeEvent] = []
    @Published private(set) var heartbeatCount: Int = 0
    @Published private(set) var lastHeartbeatAt: Date?
    @Published private(set) var lastMediaTime: Double = 0
    @Published private(set) var lastMediaSource: String = ""
    @Published private(set) var isPlaying: Bool = false
    @Published private(set) var pageHidden: Bool = false
    @Published private(set) var largestGap: TimeInterval = 0
    @Published private(set) var startedAt: Date = Date()

    /// Media time observed at the moment the app last went to the background,
    /// so foreground/background progress can be compared directly.
    private var mediaTimeAtBackground: Double?

    func record(_ kind: String, _ detail: String) {
        let event = ProbeEvent(id: UUID(), at: Date(), kind: kind, detail: detail)
        events.append(event)
        if events.count > ProbeLog.maxEvents {
            events.removeFirst(events.count - ProbeLog.maxEvents)
        }
    }

    func heartbeat(playing: Bool, currentTime: Double, source: String, hidden: Bool) {
        let now = Date()

        if let previous = lastHeartbeatAt {
            let gap = now.timeIntervalSince(previous)
            if gap > ProbeLog.gapThreshold {
                if gap > largestGap {
                    largestGap = gap
                }
                record("STALL", String(format: "no heartbeat for %.1fs", gap))
            }
        }

        if playing != isPlaying {
            record("PLAYBACK", playing ? "started" : "stopped/paused")
        }
        if hidden != pageHidden {
            record("VISIBILITY", hidden ? "document.hidden = true" : "document.hidden = false")
        }

        heartbeatCount += 1
        lastHeartbeatAt = now
        lastMediaTime = currentTime
        lastMediaSource = source
        isPlaying = playing
        pageHidden = hidden
    }

    func noteEnteredBackground() {
        mediaTimeAtBackground = lastMediaTime
        record("APP", String(format: "entered background at media t=%.1fs", lastMediaTime))
    }

    func noteEnteredForeground() {
        if let before = mediaTimeAtBackground {
            let advanced = lastMediaTime - before
            record(
                "APP",
                String(
                    format: "returned to foreground; media advanced %.1fs while backgrounded",
                    advanced
                )
            )
        } else {
            record("APP", "returned to foreground")
        }
        mediaTimeAtBackground = nil
    }

    func reset() {
        events.removeAll()
        heartbeatCount = 0
        lastHeartbeatAt = nil
        lastMediaTime = 0
        lastMediaSource = ""
        isPlaying = false
        pageHidden = false
        largestGap = 0
        startedAt = Date()
        mediaTimeAtBackground = nil
        record("RUN", "log reset")
    }

    /// Plain text for pasting straight into the issue. This is the deliverable.
    var transcript: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"

        var lines: [String] = []
        lines.append("BackgroundAudioSpike transcript")
        lines.append(String(format: "run length: %.0fs", Date().timeIntervalSince(startedAt)))
        lines.append("heartbeats: \(heartbeatCount)")
        lines.append(String(format: "largest heartbeat gap: %.1fs", largestGap))
        lines.append("last media source: \(lastMediaSource)")
        lines.append("")
        for event in events {
            lines.append("\(formatter.string(from: event.at))  \(event.kind)  \(event.detail)")
        }
        return lines.joined(separator: "\n")
    }
}
