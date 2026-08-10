import Foundation

/// The sleep timer from the brainstorm's §3 media list.
///
/// In `Core` because the whole of it is arithmetic and state, and the awkward
/// parts are the ones worth testing: what "5 minutes left" means after the app
/// was backgrounded for four of them, and what happens when the deadline passes
/// while nothing is playing.
///
/// Deliberately **not** a `Timer`. A timer firing is not a reliable event on
/// iOS — it does not run while suspended, and coming back from the background
/// means catching up rather than resuming. Storing the deadline and asking
/// "has it passed?" is correct in both cases.
public struct SleepTimer: Hashable, Sendable, Codable {

    /// Offered in the UI, in minutes.
    public static let presets: [Int] = [5, 15, 30, 45, 60, 90]

    /// Absolute, not a countdown: a duration would have to be decremented, and
    /// nothing decrements it while the app is suspended.
    public private(set) var firesAt: Date?

    public init(firesAt: Date? = nil) {
        self.firesAt = firesAt
    }

    public var isActive: Bool {
        firesAt != nil
    }

    public mutating func start(minutes: Int, now: Date = Date()) {
        guard minutes > 0 else {
            cancel()
            return
        }
        firesAt = now.addingTimeInterval(TimeInterval(minutes) * 60)
    }

    public mutating func cancel() {
        firesAt = nil
    }

    /// Whole seconds left, or `nil` when inactive. Never negative — a timer
    /// that is overdue has zero left, not minus four minutes.
    public func remaining(now: Date = Date()) -> Int? {
        guard let firesAt else {
            return nil
        }
        return max(0, Int(firesAt.timeIntervalSince(now).rounded(.down)))
    }

    /// Whether playback should stop, checked on each media tick.
    ///
    /// Returns true exactly once: acting on it clears the timer, so a page that
    /// keeps reporting state does not get paused repeatedly if the user starts
    /// playing again.
    public mutating func shouldStopPlayback(now: Date = Date()) -> Bool {
        guard let firesAt else {
            return false
        }
        guard now >= firesAt else {
            return false
        }
        self.firesAt = nil
        return true
    }

    /// For the settings row: "45 minutes", "4:59", "off".
    public func label(now: Date = Date()) -> String {
        guard let seconds = remaining(now: now) else {
            return "Off"
        }
        if seconds >= 60 {
            let minutes = (seconds + 59) / 60
            return minutes == 1 ? "1 minute" : "\(minutes) minutes"
        }
        return "\(seconds)s"
    }
}
