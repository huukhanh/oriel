import XCTest

@testable import Core

final class SleepTimerTests: XCTestCase {

    private let epoch = Date(timeIntervalSince1970: 1_000_000)

    func testStartingSetsADeadline() {
        var timer = SleepTimer()
        XCTAssertFalse(timer.isActive)
        timer.start(minutes: 30, now: epoch)
        XCTAssertTrue(timer.isActive)
        XCTAssertEqual(timer.remaining(now: epoch), 1800)
    }

    /// The reason it stores a deadline rather than counting down: nothing
    /// decrements a counter while the app is suspended.
    func testTimeAdvancesWhileTheAppIsNotRunning() {
        var timer = SleepTimer()
        timer.start(minutes: 30, now: epoch)
        let later = epoch.addingTimeInterval(25 * 60)
        XCTAssertEqual(timer.remaining(now: later), 300, "25 minutes should have elapsed")
    }

    func testFiresOnceThePastDeadlineIsReached() {
        var timer = SleepTimer()
        timer.start(minutes: 10, now: epoch)
        XCTAssertFalse(timer.shouldStopPlayback(now: epoch.addingTimeInterval(599)))
        XCTAssertTrue(timer.shouldStopPlayback(now: epoch.addingTimeInterval(600)))
    }

    /// Otherwise a page that keeps reporting state would be paused again every
    /// tick, including after the user deliberately restarted it.
    func testFiresExactlyOnce() {
        var timer = SleepTimer()
        timer.start(minutes: 1, now: epoch)
        let after = epoch.addingTimeInterval(120)
        XCTAssertTrue(timer.shouldStopPlayback(now: after))
        XCTAssertFalse(timer.shouldStopPlayback(now: after), "it fired twice")
        XCTAssertFalse(timer.isActive)
    }

    /// Coming back after the deadline passed must still stop playback, not
    /// silently forget.
    func testADeadlineMissedWhileSuspendedStillFires() {
        var timer = SleepTimer()
        timer.start(minutes: 5, now: epoch)
        XCTAssertTrue(timer.shouldStopPlayback(now: epoch.addingTimeInterval(3600)))
    }

    func testRemainingNeverGoesNegative() {
        var timer = SleepTimer()
        timer.start(minutes: 5, now: epoch)
        XCTAssertEqual(timer.remaining(now: epoch.addingTimeInterval(9999)), 0)
    }

    func testCancelling() {
        var timer = SleepTimer()
        timer.start(minutes: 30, now: epoch)
        timer.cancel()
        XCTAssertFalse(timer.isActive)
        XCTAssertNil(timer.remaining(now: epoch))
        XCTAssertFalse(timer.shouldStopPlayback(now: epoch.addingTimeInterval(9999)))
    }

    func testZeroOrNegativeMinutesMeansOff() {
        var timer = SleepTimer()
        timer.start(minutes: 30, now: epoch)
        timer.start(minutes: 0, now: epoch)
        XCTAssertFalse(timer.isActive, "0 minutes should cancel, not fire immediately")
    }

    func testLabel() {
        var timer = SleepTimer()
        XCTAssertEqual(timer.label(now: epoch), "Off")
        timer.start(minutes: 30, now: epoch)
        XCTAssertEqual(timer.label(now: epoch), "30 minutes")
        // Exactly a minute left reads as a minute, not "60s".
        XCTAssertEqual(timer.label(now: epoch.addingTimeInterval(1740)), "1 minute")
        // Under a minute counts in seconds, so the last stretch is legible.
        XCTAssertEqual(timer.label(now: epoch.addingTimeInterval(1770)), "30s")
        XCTAssertEqual(timer.label(now: epoch.addingTimeInterval(1799)), "1s")
        // Rounded up, so a timer with time left never reads "0 minutes".
        XCTAssertEqual(timer.label(now: epoch.addingTimeInterval(59)), "30 minutes")
    }

    func testCodableRoundTrip() throws {
        var timer = SleepTimer()
        timer.start(minutes: 45, now: epoch)
        let data = try JSONEncoder().encode(timer)
        XCTAssertEqual(try JSONDecoder().decode(SleepTimer.self, from: data), timer)
    }
}
