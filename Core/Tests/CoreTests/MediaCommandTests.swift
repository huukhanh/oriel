import XCTest

@testable import Core

/// The lock-screen commands map to real entry points in the runtime.
///
/// A typo here is a button that moves and does nothing, with no error anywhere
/// — which is exactly the shape of #37.
final class MediaCommandTests: XCTestCase {

    func testEveryCommandCallsTheRuntime() {
        let commands: [MediaCommand] = [
            .play, .pause, .toggle, .skipForward(15), .skipBackward(15),
        ]
        for command in commands {
            XCTAssertTrue(
                command.javaScript.hasPrefix("window.__inj.media."),
                "\(command) does not call the injection runtime"
            )
        }
    }

    func testSkipDirectionIsNotReversed() {
        XCTAssertEqual(MediaCommand.skipForward(15).javaScript, "window.__inj.media.seekBy(15)")
        XCTAssertEqual(MediaCommand.skipBackward(15).javaScript, "window.__inj.media.seekBy(-15)")
    }

    func testIntervalIsCarriedThrough() {
        XCTAssertEqual(MediaCommand.skipForward(30).javaScript, "window.__inj.media.seekBy(30)")
    }

    /// Guards the pairing that a rename would silently break.
    func testNamesMatchTheRuntimeSurface() {
        XCTAssertEqual(MediaCommand.play.javaScript, "window.__inj.media.play()")
        XCTAssertEqual(MediaCommand.pause.javaScript, "window.__inj.media.pause()")
        XCTAssertEqual(MediaCommand.toggle.javaScript, "window.__inj.media.toggle()")
    }
}
