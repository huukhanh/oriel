import XCTest

/// Does the app actually run?
///
/// Compiling settles signatures; the unit tests settle the injection layer
/// against a real `WKWebView`. Neither says anything about whether SwiftUI
/// presents any of it — a view that traps on launch, a sheet that never
/// appears, an `@EnvironmentObject` that was never injected. All of those
/// compile perfectly.
///
/// Launched with `-uitest`, which starts on `about:blank`. Otherwise every test
/// here would depend on the network and on YouTube's markup, and a failure
/// would be indistinguishable from a real regression.
/// `@MainActor` because `XCUIApplication` is, under Swift 6.
@MainActor
final class AppLaunchUITests: XCTestCase {

    private var app: XCUIApplication!

    // `async throws` deliberately: the synchronous `setUp()` override inherits
    // XCTestCase's nonisolated context and cannot touch XCUIApplication, which
    // is main-actor isolated. The async variant carries the class's isolation.
    override func setUp() async throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-uitest"]
        app.launch()
    }

    /// The one that matters most. An app that traps during `AppModel.init` —
    /// a bad store path, a missing bundle resource — fails here and nowhere
    /// else in this project.
    func testAppLaunchesAndShowsTheBrowser() {
        // The toolbar, not the address bar: the address bar is hidden by
        // default now (#33), so its absence is correct rather than a crash.
        XCTAssertTrue(
            app.buttons["toolbar.home"].waitForExistence(timeout: 20),
            "the toolbar never appeared — the app probably trapped on launch"
        )
    }

    /// #33: a fresh install should not show the address bar.
    func testAddressBarIsHiddenOnAFreshInstall() {
        XCTAssertTrue(app.buttons["toolbar.home"].waitForExistence(timeout: 20))
        XCTAssertFalse(
            app.textFields["addressField"].exists,
            "the address bar should be off by default — it is a debugging affordance"
        )
    }

    /// #33: and the setting must bring it back, without a restart.
    func testTheSettingShowsTheAddressBar() {
        XCTAssertTrue(app.buttons["toolbar.home"].waitForExistence(timeout: 20))
        app.buttons["toolbar.settings"].tap()

        let toggle = app.switches["Show address bar (debug)"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), "the toggle is missing from Settings")

        let before = toggle.value as? String
        // Tap the right-hand side, where the switch actually is. A plain
        // `.tap()` on a SwiftUI Form row lands on the label and does nothing —
        // which is what the previous run proved, by reporting the value
        // unchanged rather than the address bar missing.
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()

        // Separating these two matters: if the switch never flipped, the fault
        // is the tap; if it flipped and the bar stayed hidden, the fault is the
        // app not reacting to the setting. Asserting only the end state cannot
        // tell them apart.
        let after = toggle.value as? String
        XCTAssertNotEqual(before, after, "tapping the switch did not change it (\(before ?? "nil"))")

        app.buttons["Done"].tap()

        XCTAssertTrue(
            app.textFields["addressField"].waitForExistence(timeout: 10),
            "the switch flipped but the address bar stayed hidden"
        )
    }

    /// #34: Home has to be reachable from a loaded page, and has to offer URL
    /// entry — with the address bar hidden it is the only way to another site.
    func testHomeButtonOpensURLEntry() {
        XCTAssertTrue(app.buttons["toolbar.home"].waitForExistence(timeout: 20))
        app.buttons["toolbar.home"].tap()

        XCTAssertTrue(
            app.textFields["home.addressField"].waitForExistence(timeout: 10),
            "the home screen has no URL field"
        )
        XCTAssertTrue(app.staticTexts["YouTube"].exists || app.buttons["YouTube"].exists)
    }

    func testToolbarIsPresent() {
        XCTAssertTrue(app.buttons["toolbar.home"].waitForExistence(timeout: 20))
        for identifier in [
            "toolbar.reload",
            "toolbar.pip",
            "toolbar.scripts",
            "toolbar.log",
            "toolbar.home",
            "toolbar.settings",
        ] {
            XCTAssertTrue(
                app.buttons[identifier].exists,
                "\(identifier) is missing from the toolbar"
            )
        }
    }

    /// Proves the built-in scripts made it out of the bundle, through
    /// `ScriptCatalog.merge`, and onto the screen. A missing resource shows up
    /// here as an empty list.
    func testScriptsSheetListsTheBuiltIns() {
        XCTAssertTrue(app.buttons["toolbar.home"].waitForExistence(timeout: 20))
        app.buttons["toolbar.scripts"].tap()

        XCTAssertTrue(
            app.staticTexts["Keep playing in background"].waitForExistence(timeout: 10),
            "the built-in scripts did not reach the list — check they are in the "
                + "target's resources"
        )
        XCTAssertTrue(app.staticTexts["Force inline playback"].exists)
    }

    /// §4.2's split has to be visible, not just implemented.
    func testSettingsSeparatesReloadingTogglesFromLiveOnes() {
        XCTAssertTrue(app.buttons["toolbar.home"].waitForExistence(timeout: 20))
        app.buttons["toolbar.settings"].tap()

        // Matched case-insensitively on a substring: a Form section header is
        // styled by the platform, and asserting an exact string couples the
        // test to that styling rather than to the behaviour.
        let reloadHeader = app.staticTexts
            .matching(NSPredicate(format: "label CONTAINS[c] %@", "Reloads the page"))
            .firstMatch
        XCTAssertTrue(
            reloadHeader.waitForExistence(timeout: 15),
            "the settings screen does not warn which toggles throw the page away"
        )

        // The toggles themselves matter more than the headers: one from each
        // group proves the split reached the screen.
        XCTAssertTrue(app.switches["Inline playback"].exists, "config-group toggle missing")
        XCTAssertTrue(app.switches["Desktop site"].exists, "live-group toggle missing")
    }

    func testLogOpensAndIsEmptyOnACleanLaunch() {
        XCTAssertTrue(app.buttons["toolbar.home"].waitForExistence(timeout: 20))
        app.buttons["toolbar.log"].tap()
        XCTAssertTrue(app.staticTexts["No output yet"].waitForExistence(timeout: 10))
    }

    func testBookmarksSheetOpens() {
        XCTAssertTrue(app.buttons["toolbar.home"].waitForExistence(timeout: 20))
        app.buttons["toolbar.home"].tap()
        // A SwiftUI Button is a button, not a staticText — the seeded default,
        // so an empty launcher on first run fails here.
        XCTAssertTrue(app.buttons["YouTube"].waitForExistence(timeout: 15))
    }

    /// The authoring loop, end to end through the real UI.
    func testCreatingAScriptFromTheEditor() {
        XCTAssertTrue(app.buttons["toolbar.home"].waitForExistence(timeout: 20))
        app.buttons["toolbar.scripts"].tap()
        XCTAssertTrue(app.buttons["New"].waitForExistence(timeout: 10))
        app.buttons["New"].tap()

        // The template's @name, so the editor opened with something that runs
        // rather than an empty buffer.
        XCTAssertTrue(
            app.navigationBars["New script"].waitForExistence(timeout: 10),
            "the editor did not open, or the template is not being parsed"
        )
        XCTAssertTrue(app.buttons["Save"].exists)
        XCTAssertTrue(app.buttons["Run on this page now"].exists)
    }
}
