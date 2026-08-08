import XCTest

@testable import Core

/// The built-in scripts are the app's media features
/// (`docs/decisions/002-builtin-script-storage.md`), so they are held to the
/// same standard as anything else: parsed by the real parser, wrapped by the
/// real generator, and — via `fixtures/builtins/` — executed by the real
/// WebKit suite in `web/webkit/`.
///
/// Regenerate the wrapped fixtures deliberately with `UPDATE_GOLDEN=1 swift test`.
final class BuiltinScriptTests: XCTestCase {

    private static func repoRoot() -> URL {
        return URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    private static func builtinsDirectory() -> URL {
        return repoRoot().appendingPathComponent("web/src/builtins")
    }

    private static func builtinSources() throws -> [(id: String, source: String)] {
        let directory = builtinsDirectory()
        let names = try FileManager.default.contentsOfDirectory(atPath: directory.path)
            .filter { $0.hasSuffix(".js") }
            .sorted()
        return try names.map { name in
            let id = String(name.dropLast(3))
            let source = try String(
                contentsOf: directory.appendingPathComponent(name),
                encoding: .utf8
            )
            return (id: id, source: source)
        }
    }

    func testThereAreBuiltinsToCheck() throws {
        let builtins = try Self.builtinSources()
        XCTAssertFalse(builtins.isEmpty, "no built-in scripts found — did the path move?")
    }

    /// Every built-in must parse cleanly. A warning here is a bug in a script
    /// *we* ship, not in something the user pasted.
    func testEveryBuiltinParsesWithoutWarnings() throws {
        for builtin in try Self.builtinSources() {
            let metadata = UserScriptMetadata.parse(builtin.source)
            XCTAssertTrue(
                metadata.hasMetadataBlock,
                "\(builtin.id) has no ==UserScript== block"
            )
            XCTAssertFalse(
                metadata.matches.isEmpty,
                "\(builtin.id) matches nothing and would never run"
            )
            XCTAssertEqual(
                metadata.warnings.map { "\($0.key): \($0.message)" },
                [],
                "\(builtin.id) produced parse warnings — we ship this script, so fix it"
            )
        }
    }

    /// The timing requirement is per-script, not blanket.
    ///
    /// A built-in that **overrides page behaviour** must beat the page's own
    /// listeners, so document-start is mandatory: spoofing `document.hidden`
    /// after the site installed its `visibilitychange` handler accomplishes
    /// nothing. A built-in that **adds UI** needs a DOM to attach to, so
    /// document-start would break it — `document.body` is nil there.
    ///
    /// Getting either backwards produces a script that loads, logs nothing, and
    /// silently does not work. That is issue #32's failure mode.
    func testEachBuiltinRunsAtTheTimingItsJobRequires() throws {
        let mustBeatThePage: Set<String> = ["visibility-spoof", "playsinline"]

        for builtin in try Self.builtinSources() {
            let metadata = UserScriptMetadata.parse(builtin.source)
            if mustBeatThePage.contains(builtin.id) {
                XCTAssertEqual(
                    metadata.runAt,
                    .documentStart,
                    "\(builtin.id) overrides page behaviour, so it must run before the "
                        + "page's own handlers are installed"
                )
            } else {
                XCTAssertNotEqual(
                    metadata.runAt,
                    .documentStart,
                    "\(builtin.id) touches the DOM, and document.body is nil at "
                        + "document-start"
                )
            }
            XCTAssertEqual(
                metadata.world,
                .page,
                "\(builtin.id) needs the page's own globals"
            )
        }
    }

    func testBuiltinsDoNotUseEval() throws {
        for builtin in try Self.builtinSources() {
            XCTAssertFalse(
                builtin.source.contains("eval("),
                "\(builtin.id) uses eval, which a user script's CSP exemption does not cover"
            )
            XCTAssertFalse(builtin.source.contains("new Function"), "\(builtin.id) uses Function")
        }
    }

    /// A built-in that grabs a listener or an observer and never releases it
    /// keeps affecting the page after the user switches it off — which makes
    /// "toggle it off and see" useless as a diagnostic, and that toggle is the
    /// app's whole answer to a site changing under it.
    func testBuiltinsRegisterCleanup() throws {
        for builtin in try Self.builtinSources() {
            let takesHold =
                builtin.source.contains("addEventListener")
                || builtin.source.contains("MutationObserver")
                || builtin.source.contains("defineProperty")
            guard takesHold else {
                continue
            }
            XCTAssertTrue(
                builtin.source.contains("GM_onCleanup"),
                "\(builtin.id) changes the page but registers no cleanup"
            )
        }
    }

    /// Wrap each built-in with the real generator and pin the output, so the
    /// WebKit suite is running the artifact this code actually produces.
    func testWrappedBuiltinsMatchFixtures() throws {
        let directory = Self.repoRoot().appendingPathComponent("fixtures/builtins")
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        let updating = ProcessInfo.processInfo.environment["UPDATE_GOLDEN"] == "1"

        for builtin in try Self.builtinSources() {
            let metadata = UserScriptMetadata.parse(builtin.source)
            let wrapped = WrapperBuilder.wrap(
                id: builtin.id,
                metadata: metadata,
                source: builtin.source
            )
            let fixtureURL = directory.appendingPathComponent("\(builtin.id).wrapped.js")

            if updating {
                try wrapped.write(to: fixtureURL, atomically: true, encoding: .utf8)
            }

            let onDisk = try String(contentsOf: fixtureURL, encoding: .utf8)
            XCTAssertEqual(
                wrapped,
                onDisk,
                "\(builtin.id) wrapper is stale — rerun with UPDATE_GOLDEN=1, then "
                    + "re-run the WebKit suite"
            )
        }
    }
}
