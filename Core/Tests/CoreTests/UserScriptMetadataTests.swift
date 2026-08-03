import XCTest

@testable import Core

final class UserScriptMetadataTests: XCTestCase {

    private func warning(_ metadata: UserScriptMetadata, key: String) -> MetadataWarning? {
        return metadata.warnings.first(where: { $0.key == key })
    }

    func testParsesARealisticPastedHeader() {
        let source = """
            // ==UserScript==
            // @name        Hide Shorts
            // @namespace   https://example.com/scripts
            // @version     1.2.0
            // @description Removes Shorts shelves from the home page
            // @match       *://*.youtube.com/*
            // @match       *://*.youtu.be/*
            // @run-at      document-start
            // @world       page
            // @noframes
            // ==/UserScript==

            console.log("body");
            """

        let metadata = UserScriptMetadata.parse(source)

        XCTAssertTrue(metadata.hasMetadataBlock)
        XCTAssertEqual(metadata.name, "Hide Shorts")
        XCTAssertEqual(metadata.namespace, "https://example.com/scripts")
        XCTAssertEqual(metadata.version, "1.2.0")
        XCTAssertEqual(metadata.description, "Removes Shorts shelves from the home page")
        XCTAssertEqual(metadata.matches.count, 2)
        XCTAssertEqual(metadata.runAt, .documentStart)
        XCTAssertEqual(metadata.world, .page)
        XCTAssertTrue(metadata.noFrames)
        XCTAssertTrue(metadata.warnings.isEmpty, "clean header should warn about nothing")
        XCTAssertTrue(metadata.matches[0].matches("https://m.youtube.com/watch?v=1"))
    }

    func testDefaultsAreTheOnesTheMediaScriptsNeed() {
        let metadata = UserScriptMetadata.parse(
            """
            // ==UserScript==
            // @match *://example.com/*
            // ==/UserScript==
            """
        )
        XCTAssertEqual(metadata.runAt, .documentStart, "document-start is mandatory for §7 scripts")
        XCTAssertEqual(metadata.world, .page)
        XCTAssertFalse(metadata.noFrames)
    }

    /// Defaults are correct but silent, so the parser says when it assumed one.
    func testAssumedDefaultsAreAnnounced() {
        let metadata = UserScriptMetadata.parse(
            """
            // ==UserScript==
            // @match *://example.com/*
            // ==/UserScript==
            """
        )
        XCTAssertNotNil(warning(metadata, key: "run-at"))
        XCTAssertNotNil(warning(metadata, key: "world"))
    }

    // MARK: - failing closed

    /// The central safety property: a broken @match is dropped, never widened.
    func testMalformedMatchIsDroppedNotWidened() {
        let metadata = UserScriptMetadata.parse(
            """
            // ==UserScript==
            // @match not-a-pattern
            // @match ftp://example.com/*
            // ==/UserScript==
            """
        )
        XCTAssertTrue(metadata.matches.isEmpty, "a malformed @match must not become a live one")
        XCTAssertEqual(metadata.warnings.filter { $0.key == "match" }.count, 3)
    }

    func testScriptWithNoMatchRunsNowhereAndSaysSo() {
        let metadata = UserScriptMetadata.parse(
            """
            // ==UserScript==
            // @name Nothing
            // ==/UserScript==
            """
        )
        XCTAssertTrue(metadata.matches.isEmpty)
        XCTAssertEqual(
            warning(metadata, key: "match")?.message,
            "no usable @match — this script will not run on any page."
        )
    }

    func testOneBadMatchDoesNotDiscardTheGoodOnes() {
        let metadata = UserScriptMetadata.parse(
            """
            // ==UserScript==
            // @match *://*.example.com/*
            // @match ???
            // @match *://*.test.com/*
            // ==/UserScript==
            """
        )
        XCTAssertEqual(metadata.matches.count, 2)
        XCTAssertEqual(metadata.warnings.filter { $0.key == "match" }.count, 1)
    }

    func testUnknownRunAtAndWorldFallBackAndWarn() {
        let metadata = UserScriptMetadata.parse(
            """
            // ==UserScript==
            // @match *://example.com/*
            // @run-at whenever
            // @world sandbox
            // ==/UserScript==
            """
        )
        XCTAssertEqual(metadata.runAt, .documentStart)
        XCTAssertEqual(metadata.world, .page)
        XCTAssertTrue(warning(metadata, key: "run-at")?.message.contains("whenever") ?? false)
        XCTAssertTrue(warning(metadata, key: "world")?.message.contains("sandbox") ?? false)
    }

    // MARK: - tolerating real-world input

    func testMissingBlockIsNotFatal() {
        let metadata = UserScriptMetadata.parse("console.log('just code');")
        XCTAssertFalse(metadata.hasMetadataBlock)
        XCTAssertTrue(metadata.matches.isEmpty)
        XCTAssertEqual(metadata.warnings.count, 1)
        XCTAssertTrue(metadata.warnings[0].message.contains("no ==UserScript== block"))
    }

    func testUnclosedBlockIsNotFatal() {
        let metadata = UserScriptMetadata.parse(
            """
            // ==UserScript==
            // @match *://example.com/*
            console.log("oops, never closed");
            """
        )
        XCTAssertFalse(metadata.hasMetadataBlock)
        XCTAssertTrue(metadata.warnings[0].message.contains("never closed"))
    }

    /// A stray `\r` on every value is invisible and would break every pattern.
    func testCRLFLineEndings() {
        let source =
            "// ==UserScript==\r\n"
            + "// @name CRLF\r\n"
            + "// @match *://*.example.com/*\r\n"
            + "// ==/UserScript==\r\n"
        let metadata = UserScriptMetadata.parse(source)
        XCTAssertEqual(metadata.name, "CRLF")
        XCTAssertEqual(metadata.matches.count, 1)
        XCTAssertTrue(metadata.matches[0].matches("https://a.example.com/"))
    }

    func testIrregularSpacingAndIndentation() {
        let source = """
              //   ==UserScript==
              //@name       Squished
              //   @match   *://example.com/*
              //   ==/UserScript==
            """
        let metadata = UserScriptMetadata.parse(source)
        XCTAssertTrue(metadata.hasMetadataBlock)
        XCTAssertEqual(metadata.name, "Squished")
        XCTAssertEqual(metadata.matches.count, 1)
    }

    func testTabSeparatedValues() {
        let metadata = UserScriptMetadata.parse(
            "// ==UserScript==\n// @name\tTabbed\n// @match\t*://example.com/*\n// ==/UserScript=="
        )
        XCTAssertEqual(metadata.name, "Tabbed")
        XCTAssertEqual(metadata.matches.count, 1)
    }

    func testNonEntryLinesInsideTheBlockAreIgnored() {
        let metadata = UserScriptMetadata.parse(
            """
            // ==UserScript==
            //
            // just a comment, not a key
            // @match *://example.com/*
            // ==/UserScript==
            """
        )
        XCTAssertEqual(metadata.matches.count, 1)
        XCTAssertTrue(metadata.warnings.filter { $0.key == "match" }.isEmpty)
    }

    // MARK: - unsupported keys

    /// "unknown key" is not actionable; naming the key and saying what to do
    /// instead is. These appear constantly in pasted scripts.
    func testKnownUnsupportedKeysExplainThemselves() {
        let metadata = UserScriptMetadata.parse(
            """
            // ==UserScript==
            // @match *://example.com/*
            // @require https://code.jquery.com/jquery.min.js
            // @grant GM_setValue
            // @include http://*
            // ==/UserScript==
            """
        )
        XCTAssertTrue(warning(metadata, key: "require")?.message.contains("Paste") ?? false)
        XCTAssertTrue(
            warning(metadata, key: "grant")?.message.contains("userscript-api") ?? false
        )
        XCTAssertTrue(warning(metadata, key: "include")?.message.contains("@match") ?? false)
    }

    func testTrulyUnknownKeyStillWarns() {
        let metadata = UserScriptMetadata.parse(
            """
            // ==UserScript==
            // @match *://example.com/*
            // @wibble something
            // ==/UserScript==
            """
        )
        XCTAssertEqual(warning(metadata, key: "wibble")?.message, "unrecognised key, ignored.")
    }

    func testWarningsCarryUsableLineNumbers() {
        let metadata = UserScriptMetadata.parse(
            """
            // ==UserScript==
            // @match *://example.com/*
            // @wibble x
            // ==/UserScript==
            """
        )
        XCTAssertEqual(warning(metadata, key: "wibble")?.line, 3)
    }

    func testCodableRoundTrip() throws {
        let original = UserScriptMetadata.parse(
            """
            // ==UserScript==
            // @name Round Trip
            // @match *://*.example.com/*
            // @run-at document-end
            // @world isolated
            // ==/UserScript==
            """
        )
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(UserScriptMetadata.self, from: data)
        XCTAssertEqual(original, decoded)
        XCTAssertEqual(decoded.runAt, .documentEnd)
        XCTAssertEqual(decoded.world, .isolated)
    }
}
