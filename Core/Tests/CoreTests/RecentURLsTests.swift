import XCTest

@testable import Core

final class RecentURLsTests: XCTestCase {

    func testMostRecentFirst() {
        var recents = RecentURLs()
        recents.record(url: "https://a.test/", title: "A")
        recents.record(url: "https://b.test/", title: "B")
        XCTAssertEqual(recents.entries.map { $0.url }, ["https://b.test/", "https://a.test/"])
    }

    /// A list showing the same site six times is worse than no list.
    func testRevisitingMovesRatherThanDuplicates() {
        var recents = RecentURLs()
        recents.record(url: "https://a.test/", title: "A")
        recents.record(url: "https://b.test/", title: "B")
        recents.record(url: "https://a.test/", title: "A again")

        XCTAssertEqual(recents.entries.count, 2)
        XCTAssertEqual(recents.entries.first?.url, "https://a.test/")
        XCTAssertEqual(recents.entries.first?.title, "A again", "the title should refresh")
    }

    func testBoundedGrowth() {
        var recents = RecentURLs()
        for i in 0..<(RecentURLs.limit + 10) {
            recents.record(url: "https://site\(i).test/", title: "S\(i)")
        }
        XCTAssertEqual(recents.entries.count, RecentURLs.limit)
        XCTAssertEqual(
            recents.entries.first?.url,
            "https://site\(RecentURLs.limit + 9).test/",
            "the newest must survive the trim"
        )
    }

    /// `about:blank` and friends are not somewhere the user chose to go.
    func testOnlyRealPagesAreRecorded() {
        var recents = RecentURLs()
        recents.record(url: "about:blank", title: "")
        recents.record(url: "", title: "")
        recents.record(url: "   ", title: "x")
        recents.record(url: "file:///etc/passwd", title: "x")
        XCTAssertTrue(recents.entries.isEmpty)
    }

    func testUntitledPageFallsBackToItsURL() {
        var recents = RecentURLs()
        recents.record(url: "https://a.test/x", title: "   ")
        XCTAssertEqual(recents.entries.first?.title, "https://a.test/x")
    }

    func testRemoveAndClear() {
        var recents = RecentURLs()
        recents.record(url: "https://a.test/", title: "A")
        recents.record(url: "https://b.test/", title: "B")
        recents.remove(url: "https://a.test/")
        XCTAssertEqual(recents.entries.map { $0.url }, ["https://b.test/"])
        recents.clear()
        XCTAssertTrue(recents.entries.isEmpty)
    }

    func testCodableRoundTrip() throws {
        var recents = RecentURLs()
        recents.record(url: "https://a.test/", title: "A")
        let data = try JSONEncoder().encode(recents)
        XCTAssertEqual(try JSONDecoder().decode(RecentURLs.self, from: data), recents)
    }
}
