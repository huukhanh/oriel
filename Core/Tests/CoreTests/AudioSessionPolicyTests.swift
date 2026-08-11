import XCTest

@testable import Core

/// Pins the rules that broke playback three times.
///
/// `WKWebView` runs its own `AudioSession`; every session call the app makes
/// interrupts WebKit's. These tests exist so "configure once, then leave it
/// alone" is enforced rather than remembered.
final class AudioSessionPolicyTests: XCTestCase {

    private func state(enabled: Bool = true, active: Bool = false, playing: Bool = false)
        -> AudioSessionPolicy.State
    {
        AudioSessionPolicy.State(enabled: enabled, isActive: active, isPlaying: playing)
    }

    func testActivatesWhenNotYetActive() {
        XCTAssertTrue(AudioSessionPolicy.shouldActivate(state(active: false)))
    }

    /// The regression. A busy page emits media events several times a second,
    /// and each session call interrupts WebKit's own session — which is
    /// audible as playback stopping.
    func testDoesNotReactivateAnAlreadyActiveSession() {
        XCTAssertFalse(
            AudioSessionPolicy.shouldActivate(state(active: true, playing: true)),
            "re-asserting an active session interrupts WKWebView's own AudioSession"
        )
    }

    func testNeverActivatesWhenTheUserTurnedItOff() {
        XCTAssertFalse(AudioSessionPolicy.shouldActivate(state(enabled: false, active: false)))
        XCTAssertFalse(AudioSessionPolicy.shouldActivate(state(enabled: false, playing: true)))
    }

    /// After an interruption the session is genuinely gone, so activating
    /// again is correct — that is the one case the guard must not block.
    func testActivatesAgainAfterAnInterruptionInvalidatedTheSession() {
        XCTAssertTrue(AudioSessionPolicy.shouldActivate(state(active: false, playing: true)))
    }

    /// The other half of the loop: resuming unconditionally produced a play
    /// event, which produced a session call, which interrupted WebKit again.
    func testOnlyResumesWhenTheSystemAsks() {
        XCTAssertTrue(AudioSessionPolicy.shouldResume(systemSaysResume: true, enabled: true))
        XCTAssertFalse(
            AudioSessionPolicy.shouldResume(systemSaysResume: false, enabled: true),
            "resuming uninvited is what closed the interrupt/resume loop"
        )
        XCTAssertFalse(AudioSessionPolicy.shouldResume(systemSaysResume: true, enabled: false))
    }

    /// Ten media events in a row must produce exactly one activation.
    func testRepeatedPlayEventsProduceASingleActivation() {
        var isActive = false
        var activations = 0
        for _ in 0..<10 {
            if AudioSessionPolicy.shouldActivate(
                state(enabled: true, active: isActive, playing: true)
            ) {
                activations += 1
                isActive = true
            }
        }
        XCTAssertEqual(activations, 1, "a busy page must not produce a burst of session calls")
    }
}
