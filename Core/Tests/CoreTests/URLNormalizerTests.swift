import XCTest

@testable import Core

final class URLNormalizerTests: XCTestCase {

    private func normalized(_ input: String) -> String? {
        return URLNormalizer.url(from: input)?.absoluteString
    }

    func testBareHostGetsHTTPS() {
        XCTAssertEqual(normalized("youtube.com"), "https://youtube.com")
        XCTAssertEqual(normalized("m.youtube.com/watch?v=1"), "https://m.youtube.com/watch?v=1")
    }

    func testExistingSchemeIsKept() {
        XCTAssertEqual(normalized("https://a.test/x"), "https://a.test/x")
        XCTAssertEqual(normalized("http://a.test/x"), "http://a.test/x")
    }

    func testWhitespaceIsTrimmed() {
        XCTAssertEqual(normalized("  youtube.com  "), "https://youtube.com")
    }

    func testEmptyInputIsNil() {
        XCTAssertNil(normalized(""))
        XCTAssertNil(normalized("   "))
    }

    func testPhrasesBecomeSearches() {
        XCTAssertEqual(
            normalized("how to fix a bike"),
            "https://duckduckgo.com/?q=how%20to%20fix%20a%20bike"
        )
    }

    func testSingleWordBecomesASearchNotAHost() {
        XCTAssertEqual(normalized("swift"), "https://duckduckgo.com/?q=swift")
    }

    /// A typed `javascript:` URL is either a mistake or an attack. Neither
    /// deserves to be loaded, so it is searched for instead.
    func testDangerousSchemesAreNotLoaded() {
        let result = normalized("javascript:alert(1)")
        XCTAssertNotNil(result)
        XCTAssertTrue(result?.hasPrefix("https://duckduckgo.com/") ?? false)
        XCTAssertEqual(normalized("javascript:alert(1)")?.contains("alert"), true)

        let file = normalized("file:///etc/passwd")
        XCTAssertTrue(file?.hasPrefix("https://duckduckgo.com/") ?? false)

        let data = normalized("data:text/html,<script>x</script>")
        XCTAssertTrue(data?.hasPrefix("https://duckduckgo.com/") ?? false)
    }

    func testMalformedHostsBecomeSearches() {
        XCTAssertTrue(normalized(".com")?.hasPrefix("https://duckduckgo.com/") ?? false)
        XCTAssertTrue(normalized("example.")?.hasPrefix("https://duckduckgo.com/") ?? false)
    }

    /// `+` is legal in a query string but reads as a space to search engines,
    /// so an unescaped one silently changes what the user searched for.
    func testPlusIsEscapedInSearches() {
        XCTAssertEqual(normalized("c++ tutorial")?.contains("%2B%2B"), true)
    }

    func testCustomSearchTemplate() {
        let url = URLNormalizer.url(
            from: "swift concurrency",
            searchTemplate: "https://example.com/find?query={query}"
        )
        XCTAssertEqual(
            url?.absoluteString,
            "https://example.com/find?query=swift%20concurrency"
        )
    }

    func testSchemeMatchingIsCaseInsensitive() {
        XCTAssertEqual(normalized("HTTPS://a.test/x"), "HTTPS://a.test/x")
    }
}
