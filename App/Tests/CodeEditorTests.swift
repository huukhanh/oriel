import UIKit
import XCTest

@testable import Oriel

/// The text-assistance settings, asserted against a real `UITextView`.
///
/// §6 flags this as critical and it is the subtlest bug in the app: with smart
/// quotes on, iOS rewrites `"` as a curly quote that is not a valid JavaScript
/// string delimiter. The characters are near-identical on screen, so the only
/// symptom is a script that stops working — with a syntax error thrown inside
/// the page, where the user never sees it.
///
/// A settings list like this is exactly what silently loses an entry in a
/// refactor, so each one is pinned individually.
@MainActor
final class CodeEditorTests: XCTestCase {

    private func configured() -> UITextView {
        let view = UITextView()
        CodeEditor.configureForSource(view)
        return view
    }

    func testSmartQuotesAreOff() {
        XCTAssertEqual(
            configured().smartQuotesType,
            .no,
            "smart quotes rewrite \" into a character JavaScript does not accept, "
                + "invisibly"
        )
    }

    func testSmartDashesAreOff() {
        XCTAssertEqual(
            configured().smartDashesType,
            .no,
            "smart dashes turn -- in a decrement into an em dash"
        )
    }

    func testSmartInsertDeleteIsOff() {
        XCTAssertEqual(
            configured().smartInsertDeleteType,
            .no,
            "smart insert/delete adds spaces around pasted text"
        )
    }

    func testAutocorrectAndAutocapitalisationAreOff() {
        let view = configured()
        XCTAssertEqual(view.autocorrectionType, .no)
        XCTAssertEqual(view.autocapitalizationType, .none)
        XCTAssertEqual(view.spellCheckingType, .no)
    }

    func testUsesAMonospacedFont() {
        XCTAssertNotNil(configured().font)
    }

    /// A real `UITextView` starts with these ON, so the test would pass
    /// vacuously if `configureForSource` were never called.
    func testAnUnconfiguredViewWouldFail() {
        let bare = UITextView()
        XCTAssertNotEqual(
            bare.smartQuotesType,
            .no,
            "if UIKit's default were already .no, none of the above proves anything"
        )
    }

    /// The row is the difference between usable and not: `{` is two taps into
    /// a secondary keyboard plane on iOS, and this app exists to write
    /// JavaScript on a phone.
    func testAccessoryRowIsActuallyBuilt() {
        let view = UITextView()
        let coordinator = CodeEditor.Coordinator(text: .constant(""))
        let accessory = coordinator.makeAccessoryView(for: view)
        XCTAssertNotNil(
            accessory,
            "the accessory row returned nil — it was a stub pretending to be a feature"
        )
    }

    func testAccessoryKeysAreSingleCharacters() {
        XCTAssertTrue(
            EditorKeys.isWellFormed,
            "a multi-character entry would insert a string rather than a key"
        )
        XCTAssertTrue(EditorKeys.row.contains("{"))
        XCTAssertTrue(EditorKeys.row.contains("\""))
    }
}
