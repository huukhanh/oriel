import XCTest

@testable import Core

final class ScriptTests: XCTestCase {

    private func makeScript(
        id: String,
        match: String = "*://*.youtube.com/*",
        enabled: Bool = true,
        order: Int = 0,
        origin: ScriptOrigin = .user,
        name: String = "S"
    ) -> Script {
        let source = """
            // ==UserScript==
            // @name  \(name)
            // @match \(match)
            // ==/UserScript==
            console.log("\(id)");
            """
        return Script(id: id, source: source, isEnabled: enabled, order: order, origin: origin)
    }

    func testInitFromSourceTakesNameFromMetadata() {
        let script = makeScript(id: "a", name: "Hide Shorts")
        XCTAssertEqual(script.name, "Hide Shorts")
        XCTAssertEqual(script.metadata.matches.count, 1)
    }

    func testUnnamedScriptGetsAPlaceholderRatherThanAnEmptyRow() {
        let script = Script(id: "a", source: "console.log(1);")
        XCTAssertEqual(script.name, "Untitled")
    }

    // MARK: - applies(to:)

    func testAppliesRequiresBothEnabledAndMatching() {
        let enabled = makeScript(id: "a", enabled: true)
        XCTAssertTrue(enabled.applies(to: "https://m.youtube.com/watch?v=1"))
        XCTAssertFalse(enabled.applies(to: "https://example.com/"))

        let disabled = makeScript(id: "b", enabled: false)
        XCTAssertFalse(
            disabled.applies(to: "https://m.youtube.com/watch?v=1"),
            "a disabled script that still runs is the bug the user actually notices — "
                + "they turned it off to fix a site and the site stayed broken"
        )
    }

    func testScriptWithNoValidMatchesAppliesNowhere() {
        let script = Script(
            id: "a",
            source: """
                // ==UserScript==
                // @match nonsense
                // ==/UserScript==
                """
        )
        XCTAssertFalse(script.applies(to: "https://example.com/"))
        XCTAssertFalse(script.applies(to: "https://m.youtube.com/"))
    }

    // MARK: - resolution

    func testResolverReturnsOnlyMatchingEnabledScripts() {
        let scripts = [
            makeScript(id: "yt", match: "*://*.youtube.com/*"),
            makeScript(id: "example", match: "*://*.example.com/*"),
            makeScript(id: "off", match: "*://*.youtube.com/*", enabled: false),
        ]
        let resolved = ScriptResolver.scripts(for: "https://m.youtube.com/watch", in: scripts)
        XCTAssertEqual(resolved.map { $0.id }, ["yt"])
    }

    func testInjectionOrderIsListOrder() {
        let scripts = [
            makeScript(id: "third", order: 30),
            makeScript(id: "first", order: 10),
            makeScript(id: "second", order: 20),
        ]
        let resolved = ScriptResolver.scripts(for: "https://m.youtube.com/", in: scripts)
        XCTAssertEqual(resolved.map { $0.id }, ["first", "second", "third"])
    }

    /// An unstable order would make one script's effect on another depend on
    /// iteration order — a bug that reproduces only sometimes.
    func testEqualOrdersResolveDeterministically() {
        let scripts = [
            makeScript(id: "zebra", order: 5),
            makeScript(id: "alpha", order: 5),
            makeScript(id: "mango", order: 5),
        ]
        let once = ScriptResolver.scripts(for: "https://m.youtube.com/", in: scripts)
        let twice = ScriptResolver.scripts(for: "https://m.youtube.com/", in: scripts.reversed())
        XCTAssertEqual(once.map { $0.id }, ["alpha", "mango", "zebra"])
        XCTAssertEqual(once.map { $0.id }, twice.map { $0.id })
    }

    func testResolverOnEmptyInput() {
        XCTAssertTrue(ScriptResolver.scripts(for: "https://example.com/", in: []).isEmpty)
    }

    func testSummarySplitsByOrigin() {
        let scripts = [
            makeScript(id: "spoof", origin: .builtIn, name: "visibility-spoof"),
            makeScript(id: "mine", origin: .user, name: "my tweak"),
            makeScript(id: "elsewhere", match: "*://*.example.com/*", origin: .user),
        ]
        let summary = ScriptResolver.summary(for: "https://m.youtube.com/watch", in: scripts)
        XCTAssertEqual(summary.builtIn.map { $0.id }, ["spoof"])
        XCTAssertEqual(summary.user.map { $0.id }, ["mine"])
    }

    func testBuiltInsAndUserScriptsShareOneOrdering() {
        // Per decision 002 the two live in different stores but one list, so
        // ordering has to span them.
        let scripts = [
            makeScript(id: "user-early", order: 1, origin: .user),
            makeScript(id: "builtin-late", order: 2, origin: .builtIn),
        ]
        let resolved = ScriptResolver.scripts(for: "https://m.youtube.com/", in: scripts)
        XCTAssertEqual(resolved.map { $0.id }, ["user-early", "builtin-late"])
    }

    // MARK: - round-trips

    func testScriptCodableRoundTrip() throws {
        let original = makeScript(id: "a", order: 7, origin: .builtIn)
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(Script.self, from: data)
        XCTAssertEqual(original, decoded)
        XCTAssertTrue(decoded.applies(to: "https://m.youtube.com/"))
    }

    func testBookmarkCodableRoundTrip() throws {
        let original = Bookmark(id: "b", title: "YouTube", url: "https://m.youtube.com/", order: 2)
        let data = try JSONEncoder().encode(original)
        XCTAssertEqual(try JSONDecoder().decode(Bookmark.self, from: data), original)
    }
}
