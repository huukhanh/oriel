import XCTest

@testable import Core

/// Drives `MatchPattern` from `fixtures/match-cases.json` at the repo root —
/// the same file the JavaScript guard tests read. Keeping the table out of both
/// languages is what makes "Swift and JS agree" a testable claim rather than an
/// aspiration.
final class MatchPatternTests: XCTestCase {

    private struct Fixture: Decodable {
        struct Case: Decodable {
            let pattern: String
            let url: String
            let match: Bool
            let why: String
        }
        struct Invalid: Decodable {
            let pattern: String
            let why: String
        }
        let cases: [Case]
        let invalidPatterns: [Invalid]
    }

    /// Located relative to this source file so both languages can read the same
    /// path without SwiftPM resource plumbing.
    private static func loadFixture() throws -> Fixture {
        let thisFile = URL(fileURLWithPath: #filePath)
        let repoRoot =
            thisFile
            .deletingLastPathComponent()  // CoreTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // Core
            .deletingLastPathComponent()  // repo root
        let fixtureURL = repoRoot.appendingPathComponent("fixtures/match-cases.json")
        let data = try Data(contentsOf: fixtureURL)
        return try JSONDecoder().decode(Fixture.self, from: data)
    }

    func testSharedFixtureTable() throws {
        let fixture = try Self.loadFixture()
        XCTAssertGreaterThan(fixture.cases.count, 20, "fixture looks truncated")

        for testCase in fixture.cases {
            let pattern: MatchPattern
            do {
                pattern = try MatchPattern(testCase.pattern)
            } catch {
                XCTFail("`\(testCase.pattern)` should parse but threw \(error)")
                continue
            }
            XCTAssertEqual(
                pattern.matches(testCase.url),
                testCase.match,
                "`\(testCase.pattern)` vs `\(testCase.url)` — \(testCase.why)"
            )
        }
    }

    func testInvalidPatternsAreRejected() throws {
        let fixture = try Self.loadFixture()
        for invalid in fixture.invalidPatterns {
            XCTAssertThrowsError(
                try MatchPattern(invalid.pattern),
                "`\(invalid.pattern)` should be rejected — \(invalid.why)"
            )
        }
    }

    /// A rejected pattern must not survive as one that matches everything.
    /// This is the failure mode the error type exists to prevent.
    func testRejectionNeverDegradesIntoMatchAll() throws {
        let fixture = try Self.loadFixture()
        for invalid in fixture.invalidPatterns {
            if let pattern = try? MatchPattern(invalid.pattern) {
                XCTFail(
                    "`\(invalid.pattern)` parsed into \(pattern) instead of throwing — "
                        + "a bad pattern that becomes a live one widens every script that uses it"
                )
            }
        }
    }

    func testErrorsAreSpecific() {
        XCTAssertThrowsError(try MatchPattern("")) { error in
            XCTAssertEqual(error as? MatchPatternError, .empty)
        }
        XCTAssertThrowsError(try MatchPattern("example.com/*")) { error in
            XCTAssertEqual(error as? MatchPatternError, .missingSchemeSeparator("example.com/*"))
        }
        XCTAssertThrowsError(try MatchPattern("ftp://example.com/*")) { error in
            XCTAssertEqual(error as? MatchPatternError, .unsupportedScheme("ftp"))
        }
        XCTAssertThrowsError(try MatchPattern("*://example.com")) { error in
            XCTAssertEqual(error as? MatchPatternError, .missingPath("*://example.com"))
        }
        XCTAssertThrowsError(try MatchPattern("*://ex*ample.com/*")) { error in
            XCTAssertEqual(error as? MatchPatternError, .invalidHost("*://ex*ample.com/*"))
        }
    }

    func testParsedComponents() throws {
        let pattern = try MatchPattern("*://*.youtube.com/watch*")
        XCTAssertEqual(pattern.scheme, .any)
        XCTAssertEqual(pattern.host, .domainOrSubdomain("youtube.com"))
        XCTAssertEqual(pattern.path, "/watch*")
        XCTAssertEqual(pattern.source, "*://*.youtube.com/watch*")
        XCTAssertEqual(pattern.description, "*://*.youtube.com/watch*")
    }

    func testAllURLsNarrowsToHTTPAndHTTPS() throws {
        let pattern = try MatchPattern("<all_urls>")
        XCTAssertTrue(pattern.matches("http://a.test/"))
        XCTAssertTrue(pattern.matches("https://a.test/"))
        XCTAssertFalse(pattern.matches("ftp://a.test/"))
        XCTAssertFalse(pattern.matches("file:///tmp/x"))
    }

    func testCodableRoundTrip() throws {
        let original = try MatchPattern("*://*.example.com/p/*/q")
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(MatchPattern.self, from: data)
        XCTAssertEqual(original, decoded)
        XCTAssertTrue(decoded.matches("https://a.example.com/p/x/q"))
    }

    func testUnparseableURLsDoNotMatch() throws {
        let pattern = try MatchPattern("<all_urls>")
        XCTAssertFalse(pattern.matches(""))
        XCTAssertFalse(pattern.matches("not a url at all"))
        XCTAssertFalse(pattern.matches("https://"))
    }

    // MARK: - glob

    func testGlobBasics() {
        XCTAssertTrue(MatchPattern.glob(pattern: "*", matches: ""))
        XCTAssertTrue(MatchPattern.glob(pattern: "*", matches: "anything/at/all"))
        XCTAssertTrue(MatchPattern.glob(pattern: "/a*b", matches: "/ab"))
        XCTAssertTrue(MatchPattern.glob(pattern: "/a*b", matches: "/axxxb"))
        XCTAssertFalse(MatchPattern.glob(pattern: "/a*b", matches: "/axxx"))
        XCTAssertTrue(MatchPattern.glob(pattern: "/a**b", matches: "/ab"))
        XCTAssertFalse(MatchPattern.glob(pattern: "", matches: "/"))
        XCTAssertTrue(MatchPattern.glob(pattern: "", matches: ""))
    }

    /// A naive recursive glob goes exponential here. This should finish
    /// instantly; if it ever hangs, the matcher was rewritten wrong.
    func testGlobDoesNotBlowUpOnAdversarialInput() {
        let pattern = String(repeating: "a*", count: 24) + "b"
        let text = String(repeating: "a", count: 400)
        XCTAssertFalse(MatchPattern.glob(pattern: pattern, matches: text))
    }
}
