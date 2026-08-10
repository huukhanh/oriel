import XCTest

@testable import Core

final class SettingsTests: XCTestCase {

    /// §4.2 is the sharpest edge in the app: `WKWebViewConfiguration` is copied
    /// when the webview is created, so a config toggle applied to a live
    /// webview silently does nothing. Getting this predicate wrong in either
    /// direction is a bug the user feels.
    func testConfigurationChangesRequireRebuild() {
        let base = Settings()
        for change in Self.configurationMutations {
            var changed = base
            change.apply(&changed)
            XCTAssertTrue(
                changed.requiresWebViewRebuild(comparedTo: base),
                "\(change.name) is a WKWebViewConfiguration flag — changing it on a live "
                    + "webview does nothing at all, so it must force a rebuild"
            )
        }
    }

    func testLiveChangesDoNotRequireRebuild() {
        let base = Settings()
        for change in Self.liveMutations {
            var changed = base
            change.apply(&changed)
            XCTAssertFalse(
                changed.requiresWebViewRebuild(comparedTo: base),
                "\(change.name) is live-changeable — rebuilding would throw away the "
                    + "user's page for no reason"
            )
        }
    }

    func testIdenticalSettingsNeverRebuild() {
        let settings = Settings()
        XCTAssertFalse(settings.requiresWebViewRebuild(comparedTo: settings))
    }

    /// Guards against a new flag being added and quietly falling into neither
    /// group, which would make it a setting that does nothing.
    func testEveryConfigurationKeyIsCovered() {
        XCTAssertEqual(
            Set(Settings.configurationAffectingKeys),
            Set(Self.configurationMutations.map { $0.name }),
            "a config flag exists that the rebuild predicate does not check, or vice versa"
        )
    }

    func testUserAgentOnlyOverriddenForDesktop() {
        var settings = Settings()
        XCTAssertNil(settings.customUserAgent)
        settings.useDesktopUserAgent = true
        XCTAssertNotNil(settings.customUserAgent)
        XCTAssertTrue(settings.customUserAgent?.contains("Macintosh") ?? false)
    }

    func testDefaultsAreTheUsefulOnes() {
        let settings = Settings()
        XCTAssertTrue(settings.allowsInlineMediaPlayback, "else video is fullscreen-only")
        XCTAssertTrue(settings.usesPersistentDataStore, "else logins do not survive relaunch")
        XCTAssertTrue(settings.allowsPictureInPicture)
        XCTAssertFalse(
            settings.showAddressBar,
            "hidden by default — it is a debugging affordance, not the main UI"
        )
    }

    /// Showing the address bar must not throw away the page: it is chrome, not
    /// a WKWebViewConfiguration flag.
    func testAddressBarIsLiveChangeable() {
        var changed = Settings()
        changed.showAddressBar = true
        XCTAssertFalse(changed.requiresWebViewRebuild(comparedTo: Settings()))
    }

    private struct Mutation {
        let name: String
        let apply: (inout Settings) -> Void
    }

    private static let configurationMutations: [Mutation] = [
        Mutation(name: "allowsInlineMediaPlayback") { $0.allowsInlineMediaPlayback.toggle() },
        Mutation(name: "allowsPictureInPicture") { $0.allowsPictureInPicture.toggle() },
        Mutation(name: "allowsAutoplay") { $0.allowsAutoplay.toggle() },
        Mutation(name: "usesPersistentDataStore") { $0.usesPersistentDataStore.toggle() },
        Mutation(name: "allowsJavaScript") { $0.allowsJavaScript.toggle() },
    ]

    private static let liveMutations: [Mutation] = [
        Mutation(name: "useDesktopUserAgent") { $0.useDesktopUserAgent.toggle() },
        Mutation(name: "showAddressBar") { $0.showAddressBar.toggle() },
        Mutation(name: "disableIdleTimerDuringPlayback") {
            $0.disableIdleTimerDuringPlayback.toggle()
        },
        Mutation(name: "enableBackgroundAudio") { $0.enableBackgroundAudio.toggle() },
    ]
}

final class FileStoreTests: XCTestCase {

    private var directory: URL!

    override func setUpWithError() throws {
        directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("oriel-store-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testLoadingFromNothingGivesDefaults() {
        let store = FileStore(directory: directory)
        let (state, recovered) = store.load()
        XCTAssertFalse(recovered)
        XCTAssertEqual(state.version, AppState.currentVersion)
        XCTAssertFalse(state.bookmarks.isEmpty, "an empty launcher looks broken on first run")
    }

    func testRoundTrip() throws {
        let store = FileStore(directory: directory)
        var state = AppState()
        state.scripts = [
            Script(
                id: "a",
                source: """
                    // ==UserScript==
                    // @name  A
                    // @match *://*.example.com/*
                    // ==/UserScript==
                    """,
                order: 3
            )
        ]
        state.settings.useDesktopUserAgent = true
        state.builtinState["visibility-spoof"] = BuiltinState(isEnabled: false, order: -100)
        state.scriptValues["a"] = ["k": "v"]

        try store.save(state)
        let (loaded, recovered) = store.load()

        XCTAssertFalse(recovered)
        XCTAssertEqual(loaded, state)
        XCTAssertTrue(loaded.scripts[0].applies(to: "https://a.example.com/"))
    }

    func testSaveCreatesMissingDirectory() throws {
        let nested = directory.appendingPathComponent("a/b/c")
        let store = FileStore(directory: nested)
        try store.save(AppState())
        XCTAssertTrue(FileManager.default.fileExists(atPath: store.url.path))
    }

    /// Crashing on launch because of a bad state file leaves the user with an
    /// app they cannot open in order to fix it.
    func testCorruptFileIsSetAsideAndDefaultsReturned() throws {
        let store = FileStore(directory: directory)
        try "{ this is not json".write(to: store.url, atomically: true, encoding: .utf8)

        let (state, recovered) = store.load()

        XCTAssertTrue(recovered)
        XCTAssertEqual(state.version, AppState.currentVersion)
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: store.url.path + ".corrupt"),
            "the unreadable document must be kept — silently deleting the user's "
                + "scripts is worse than either crashing or resetting"
        )
    }

    func testRecoveryIsRepeatable() throws {
        let store = FileStore(directory: directory)
        try "garbage".write(to: store.url, atomically: true, encoding: .utf8)
        _ = store.load()
        try "garbage again".write(to: store.url, atomically: true, encoding: .utf8)
        let (_, recovered) = store.load()
        XCTAssertTrue(recovered, "a second corruption must not be blocked by the first backup")
    }

    /// The migration strategy: absent fields take defaults, unknown fields are
    /// ignored. Most schema changes then need no migration code at all.
    func testTolerantDecodingOfAnOlderOrNewerDocument() throws {
        let store = FileStore(directory: directory)
        let json = """
            {
              "version": 0,
              "scripts": [],
              "somethingFromTheFuture": { "nested": true }
            }
            """
        try json.write(to: store.url, atomically: true, encoding: .utf8)

        let (state, recovered) = store.load()

        XCTAssertFalse(recovered, "a document missing fields is not corrupt")
        XCTAssertEqual(state.version, AppState.currentVersion)
        XCTAssertEqual(state.settings, Settings())
        XCTAssertEqual(state.bookmarks, AppState.defaultBookmarks)
    }

    func testEmptyArraysSurviveAndAreNotReplacedByDefaults() throws {
        let store = FileStore(directory: directory)
        var state = AppState()
        state.bookmarks = []
        try store.save(state)
        let (loaded, _) = store.load()
        XCTAssertEqual(
            loaded.bookmarks,
            [],
            "the user deleting every bookmark must not resurrect the defaults"
        )
    }
}

final class ScriptCatalogTests: XCTestCase {

    private let builtins: [String: String] = [
        "visibility-spoof": """
        // ==UserScript==
        // @name  Keep playing in background
        // @match <all_urls>
        // ==/UserScript==
        """,
        "playsinline": """
        // ==UserScript==
        // @name  Force inline playback
        // @match <all_urls>
        // ==/UserScript==
        """,
    ]

    func testBuiltinsAreOnByDefault() {
        let merged = ScriptCatalog.merge(builtins: builtins, state: AppState())
        XCTAssertEqual(merged.count, 2)
        XCTAssertTrue(
            merged.allSatisfy { $0.isEnabled },
            "a media feature the user must discover and switch on does not exist"
        )
    }

    func testStoredStateOverridesTheDefault() {
        var state = AppState()
        state.builtinState["playsinline"] = BuiltinState(isEnabled: false, order: 5)
        let merged = ScriptCatalog.merge(builtins: builtins, state: state)
        let playsinline = merged.first { $0.id == "playsinline" }
        XCTAssertEqual(playsinline?.isEnabled, false)
        XCTAssertEqual(playsinline?.order, 5)
    }

    /// A script that overrides page behaviour is useless if a script that reads
    /// that behaviour ran first.
    func testBuiltinsSortAheadOfUserScriptsByDefault() {
        var state = AppState()
        state.scripts = [
            Script(
                id: "mine",
                source: "// ==UserScript==\n// @match <all_urls>\n// ==/UserScript==",
                order: 0
            )
        ]
        let merged = ScriptCatalog.merge(builtins: builtins, state: state)
        XCTAssertEqual(merged.map { $0.id }, ["visibility-spoof", "playsinline", "mine"])
    }

    func testBuiltinSourceComesFromTheBundleNotTheStore() {
        var state = AppState()
        state.builtinState["visibility-spoof"] = BuiltinState(isEnabled: true, order: -100)
        let merged = ScriptCatalog.merge(builtins: builtins, state: state)
        let spoof = merged.first { $0.id == "visibility-spoof" }
        XCTAssertEqual(spoof?.source, builtins["visibility-spoof"])
        XCTAssertEqual(spoof?.origin, .builtIn)
    }

    func testOrphanedBuiltinStateIsPruned() {
        var state = AppState()
        state.builtinState["gone"] = BuiltinState(isEnabled: true, order: 0)
        state.builtinState["playsinline"] = BuiltinState(isEnabled: false, order: 1)

        let pruned = ScriptCatalog.pruneOrphanedState(
            builtins: Set(builtins.keys),
            state: state
        )
        XCTAssertNil(pruned.builtinState["gone"])
        XCTAssertNotNil(pruned.builtinState["playsinline"])
    }

    func testMergeIsDeterministicRegardlessOfDictionaryOrder() {
        let first = ScriptCatalog.merge(builtins: builtins, state: AppState())
        for _ in 0..<20 {
            XCTAssertEqual(
                ScriptCatalog.merge(builtins: builtins, state: AppState()).map { $0.id },
                first.map { $0.id },
                "dictionary iteration order must not leak into injection order"
            )
        }
    }

    func testResolvesThroughToTheInjectionSet() {
        let merged = ScriptCatalog.merge(builtins: builtins, state: AppState())
        let resolved = ScriptResolver.scripts(for: "https://m.youtube.com/watch", in: merged)
        XCTAssertEqual(resolved.map { $0.id }, ["visibility-spoof", "playsinline"])
    }
}
