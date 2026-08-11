import XCTest

@testable import Core

/// Pins the rules that broke playback three times running.
///
/// The governing fact, established from device logs rather than reasoning:
/// `WKWebView` runs its own `AudioSession` in the WebContent process, and every
/// `setActive(true)` the app makes seizes it — producing an interruption that
/// stops the playback it was meant to protect.
final class AudioSessionPolicyTests: XCTestCase {

    private func state(
        enabled: Bool = true,
        configured: Bool = false,
        playing: Bool = false
    ) -> AudioSessionPolicy.State {
        AudioSessionPolicy.State(enabled: enabled, hasConfigured: configured, isPlaying: playing)
    }

    /// The rule the device logs forced.
    func testTheAppNeverActivatesTheSession() {
        XCTAssertFalse(
            AudioSessionPolicy.appShouldActivateSession,
            "every setActive(true) seizes the session WKWebView is using and interrupts it"
        )
    }

    func testConfiguresOnceAtLaunch() {
        XCTAssertTrue(AudioSessionPolicy.shouldConfigure(state(configured: false)))
        XCTAssertFalse(AudioSessionPolicy.shouldConfigure(state(configured: true)))
    }

    func testNeverConfiguresWhenTheUserTurnedItOff() {
        XCTAssertFalse(AudioSessionPolicy.shouldConfigure(state(enabled: false)))
    }

    /// The loop, reproduced as a test.
    ///
    /// Keying on "is the session active" was not enough: an interruption clears
    /// that flag, which re-arms configuration, which causes the next
    /// interruption. Keying on "have we configured this launch" is immune,
    /// because interruptions do not change it.
    func testInterruptionsDoNotReArmConfiguration() {
        var hasConfigured = false
        var calls = 0

        for _ in 0..<20 {
            if AudioSessionPolicy.shouldConfigure(
                state(enabled: true, configured: hasConfigured, playing: true)
            ) {
                calls += 1
                hasConfigured = true
            }
            // An interruption arrives after every call — exactly what the
            // device showed. It must not re-open the loop.
        }

        XCTAssertEqual(
            calls, 1,
            "interruptions re-armed configuration and produced a session-call loop"
        )
    }

    func testABusyPageProducesASingleConfiguration() {
        var hasConfigured = false
        var calls = 0
        for _ in 0..<50 {
            if AudioSessionPolicy.shouldConfigure(
                state(enabled: true, configured: hasConfigured, playing: true)
            ) {
                calls += 1
                hasConfigured = true
            }
        }
        XCTAssertEqual(calls, 1)
    }

    /// The other half of the loop: resuming uninvited produced a play event,
    /// which produced a session call, which interrupted WebKit again.
    func testOnlyResumesWhenTheSystemAsks() {
        XCTAssertTrue(AudioSessionPolicy.shouldResume(systemSaysResume: true, enabled: true))
        XCTAssertFalse(AudioSessionPolicy.shouldResume(systemSaysResume: false, enabled: true))
        XCTAssertFalse(AudioSessionPolicy.shouldResume(systemSaysResume: true, enabled: false))
    }
}
