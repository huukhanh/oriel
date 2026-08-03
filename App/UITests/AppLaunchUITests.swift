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

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-uitest"]
        app.launch()
    }

    /// The one that matters most. An app that traps during `AppModel.init` —
    /// a bad store path, a missing bundle resource — fails here and nowhere
    /// else in this project.
    func testAppLaunchesAndShowsTheBrowser() {
        XCTAssertTrue(
            app.textFields["addressField"].waitForExistence(timeout: 20),
            "the browser chrome never appeared — the app probably trapped on launch"
        )
    }

    func testToolbarIsPresent() {
        XCTAssertTrue(app.textFields["addressField"].waitForExistence(timeout: 20))
        for identifier in [
            "toolbar.reload",
            "toolbar.pip",
            "toolbar.scripts",
            "toolbar.log",
            "toolbar.bookmarks",
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
        XCTAssertTrue(app.textFields["addressField"].waitForExistence(timeout: 20))
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
        XCTAssertTrue(app.textFields["addressField"].waitForExistence(timeout: 20))
        app.buttons["toolbar.settings"].tap()

        XCTAssertTrue(
            app.staticTexts["Reloads the page"].waitForExistence(timeout: 10),
            "the settings screen does not warn which toggles throw the page away"
        )
        XCTAssertTrue(app.staticTexts["Applies immediately"].exists)
    }

    func testLogOpensAndIsEmptyOnACleanLaunch() {
        XCTAssertTrue(app.textFields["addressField"].waitForExistence(timeout: 20))
        app.buttons["toolbar.log"].tap()
        XCTAssertTrue(app.staticTexts["No output yet"].waitForExistence(timeout: 10))
    }

    func testBookmarksSheetOpens() {
        XCTAssertTrue(app.textFields["addressField"].waitForExistence(timeout: 20))
        app.buttons["toolbar.bookmarks"].tap()
        // The seeded defaults, so an empty launcher on first run would fail here.
        XCTAssertTrue(app.staticTexts["YouTube"].waitForExistence(timeout: 10))
    }

    /// The authoring loop, end to end through the real UI.
    func testCreatingAScriptFromTheEditor() {
        XCTAssertTrue(app.textFields["addressField"].waitForExistence(timeout: 20))
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
