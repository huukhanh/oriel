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
        /// Whether the category has already been set this launch.
        ///
        /// Deliberately *not* "is the session active": an interruption clears
        /// that, and rebuilding on it is what produced the loop.
        public var hasConfigured: Bool
        /// Whether the page reports media playing.
        public var isPlaying: Bool

        public init(enabled: Bool, hasConfigured: Bool, isPlaying: Bool) {
            self.enabled = enabled
            self.hasConfigured = hasConfigured
            self.isPlaying = isPlaying
        }
    }

    /// Whether the app should ever call `setActive(true)`.
    ///
    /// **Never.** Kept as a named constant rather than deleted code, because
    /// this is counter-intuitive enough that someone will try it again.
    ///
    /// The device evidence is unambiguous: every `setActive(true)` the app
    /// makes is immediately followed by an interruption, because it seizes a
    /// session `WKWebView` is already using. WebKit activates the session
    /// itself when the page plays media — the app's job is only to declare the
    /// *category*, which is passive configuration and does not seize anything.
    public static let appShouldActivateSession = false

    /// Whether to configure the session's category now.
    ///
    /// Once per launch. Guarding on "already active" was not enough: an
    /// interruption clears that flag, which re-arms activation, which causes
    /// the next interruption. The loop was driven by the interruptions
    /// themselves, so the count has to be independent of them.
    public static func shouldConfigure(_ state: State) -> Bool {
        guard state.enabled else {
            return false
        }
        return state.hasConfigured == false
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
