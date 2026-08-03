import XCTest

@testable import Core

final class WrapperBuilderTests: XCTestCase {

    private static func repoRoot() -> URL {
        return URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // CoreTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // Core
            .deletingLastPathComponent()  // repo root
    }

    private static let sampleSource = """
        GM_addStyle("ytd-reel-shelf-renderer { display: none }");
        GM_log("hid the shelf");
        """

    private static func sampleMetadata() -> UserScriptMetadata {
        return UserScriptMetadata.parse(
            """
            // ==UserScript==
            // @name  Hide Shorts
            // @match *://*.youtube.com/*
            // @run-at document-start
            // @world page
            // ==/UserScript==
            """
        )
    }

    /// The generated wrapper is committed at `fixtures/wrapper-golden.js`, and
    /// the JavaScript suite evaluates that exact file. So this assertion is not
    /// really about the string — it is what makes the JS side's proof apply to
    /// what Swift actually emits.
    ///
    /// Regenerate deliberately with `UPDATE_GOLDEN=1 swift test`.
    func testGeneratedWrapperMatchesGoldenFile() throws {
        let generated = WrapperBuilder.wrap(
            id: "hide-shorts",
            metadata: Self.sampleMetadata(),
            source: Self.sampleSource
        )
        let goldenURL = Self.repoRoot().appendingPathComponent("fixtures/wrapper-golden.js")

        if ProcessInfo.processInfo.environment["UPDATE_GOLDEN"] == "1" {
            try generated.write(to: goldenURL, atomically: true, encoding: .utf8)
        }

        let golden = try String(contentsOf: goldenURL, encoding: .utf8)
        XCTAssertEqual(
            generated,
            golden,
            "wrapper output changed — rerun with UPDATE_GOLDEN=1 and check the JS tests still pass"
        )
    }

    /// The CSP rule, asserted rather than trusted. A user script is exempt from
    /// the page's Content-Security-Policy; `eval` inside it is not. If either
    /// ever appears here, the app breaks on every strict-CSP site — which is
    /// most sites worth scripting.
    func testWrapperNeverUsesEval() {
        let wrapper = WrapperBuilder.wrap(
            id: "x",
            metadata: Self.sampleMetadata(),
            source: Self.sampleSource
        )
        XCTAssertFalse(wrapper.contains("eval("))
        XCTAssertFalse(wrapper.contains("new Function"))
    }

    /// The source is embedded as code, not as a string, so it appears verbatim.
    func testUserSourceIsEmbeddedLiterally() {
        let source = "console.log('hello');"
        let wrapper = WrapperBuilder.wrap(
            id: "x",
            metadata: Self.sampleMetadata(),
            source: source
        )
        XCTAssertTrue(wrapper.contains(source))
    }

    func testPatternsAreEmittedAsDescriptors() {
        let wrapper = WrapperBuilder.wrap(
            id: "x",
            metadata: Self.sampleMetadata(),
            source: ""
        )
        XCTAssertTrue(wrapper.contains("\"hostKind\":\"suffix\""))
        XCTAssertTrue(wrapper.contains("\"host\":\"youtube.com\""))
        XCTAssertTrue(wrapper.contains("\"path\":\"\\/*\"") || wrapper.contains("\"path\":\"/*\""))
    }

    /// A script whose every `@match` was malformed must emit an empty pattern
    /// list — matching nothing — never a missing or wildcard one.
    func testScriptWithNoValidMatchesEmitsEmptyPatternList() {
        let metadata = UserScriptMetadata.parse(
            """
            // ==UserScript==
            // @match nonsense
            // ==/UserScript==
            """
        )
        let wrapper = WrapperBuilder.wrap(id: "x", metadata: metadata, source: "")
        XCTAssertTrue(wrapper.contains("register(\"x\", [],"))
    }

    // MARK: - string escaping

    func testIdIsEscaped() {
        let wrapper = WrapperBuilder.wrap(
            id: "we\"ird\\id\nnewline",
            metadata: Self.sampleMetadata(),
            source: ""
        )
        XCTAssertTrue(wrapper.contains(#"register("we\"ird\\id\nnewline""#))
    }

    /// U+2028/U+2029 are legal in JSON strings but were JavaScript line
    /// terminators before ES2019 — unescaped, they end a statement mid-string.
    func testLineSeparatorsAreEscaped() {
        let wrapper = WrapperBuilder.wrap(
            id: "a\u{2028}b\u{2029}c",
            metadata: Self.sampleMetadata(),
            source: ""
        )
        XCTAssertTrue(wrapper.contains("a\\u2028b\\u2029c"))
        XCTAssertFalse(wrapper.contains("\u{2028}"))
    }

    func testControlCharactersAreEscaped() {
        XCTAssertEqual(WrapperBuilder.jsString("a\u{0007}b"), "\"a\\u0007b\"")
        XCTAssertEqual(WrapperBuilder.jsString("tab\there"), "\"tab\\there\"")
        XCTAssertEqual(WrapperBuilder.jsString("carriage\r"), "\"carriage\\r\"")
    }

    func testUnicodePassesThroughUnharmed() {
        XCTAssertEqual(WrapperBuilder.jsString("日本語 🎬"), "\"日本語 🎬\"")
    }
}
