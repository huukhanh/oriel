import Foundation

/// Decides *when* to touch the audio session.
///
/// This is in `Core`, as a pure function, because getting it wrong has broken
/// playback three times and the failure is invisible without a device.
///
/// The governing fact: **`WKWebView` runs its own `AudioSession` in the
/// WebContent process.** Every `setCategory`/`setActive` the app makes on the
/// shared session interrupts WebKit's. WebKit reports it plainly —
/// `AudioSession::beginInterruption but session is already interrupted!` — and
/// the audible result is playback stopping.
///
/// So the rule is: configure once, then leave it alone. The interesting part is
/// the exceptions, which is what these tests pin down.
public enum AudioSessionPolicy {

    /// The inputs a decision depends on.
    public struct State: Hashable, Sendable {
        /// Whether the user has background audio switched on.
        public var enabled: Bool
        /// Whether we believe the session is currently active.
        public var isActive: Bool
        /// Whether the page reports media playing.
        public var isPlaying: Bool

        public init(enabled: Bool, isActive: Bool, isPlaying: Bool) {
            self.enabled = enabled
            self.isActive = isActive
            self.isPlaying = isPlaying
        }
    }

    /// Whether to call `setCategory` + `setActive` now.
    ///
    /// False when the session is already active — that is the whole point. A
    /// busy page emits media events several times a second, and turning each
    /// into a session call is what broke playback.
    public static func shouldActivate(_ state: State) -> Bool {
        guard state.enabled else {
            return false
        }
        guard state.isActive == false else {
            return false
        }
        return true
    }

    /// Whether to resume playback after an interruption ends.
    ///
    /// Only when the system sets `shouldResume`. Resuming unconditionally
    /// closes a loop: our resume produces a play event, which produces a
    /// session call, which interrupts WebKit again — the device log showed
    /// interruptions arriving one second after activation.
    public static func shouldResume(systemSaysResume: Bool, enabled: Bool) -> Bool {
        return enabled && systemSaysResume
    }
}
