import XCTest
@testable import Core

final class PlaceholderTests: XCTestCase {
    func testHarnessRuns() {
        XCTAssertEqual(Core.version, "0.0.1")
    }
}
