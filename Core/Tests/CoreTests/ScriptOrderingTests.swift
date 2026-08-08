import XCTest

@testable import Core

final class ScriptOrderingTests: XCTestCase {

    private let builtins: [String: String] = [
        "visibility-spoof":
            "// ==UserScript==\n// @name S\n// @match <all_urls>\n// ==/UserScript==",
        "playsinline":
            "// ==UserScript==\n// @name I\n// @match <all_urls>\n// ==/UserScript==",
    ]

    private func stateWithUserScripts(_ ids: [String]) -> AppState {
        var state = AppState()
        state.scripts = ids.enumerated().map { index, id in
            Script(
                id: id,
                source:
                    "// ==UserScript==\n// @name \(id)\n// @match <all_urls>\n// ==/UserScript==",
                order: 100 + index,
                origin: .user
            )
        }
        return state
    }

    private func merged(_ state: AppState) -> [Script] {
        ScriptCatalog.merge(builtins: builtins, state: state)
    }

    func testMovingAUserScriptAboveTheBuiltins() {
        let state = stateWithUserScripts(["mine"])
        let before = merged(state)
        XCTAssertEqual(before.map { $0.id }, ["visibility-spoof", "playsinline", "mine"])

        let moved = ScriptOrdering.move(
            in: before,
            from: IndexSet(integer: 2),
            to: 0,
            state: state
        )
        XCTAssertEqual(merged(moved).map { $0.id }, ["mine", "visibility-spoof", "playsinline"])
    }

    /// The list spans two stores, so a move has to renumber across both.
    func testMoveRewritesBothStores() {
        let state = stateWithUserScripts(["a", "b"])
        let moved = ScriptOrdering.move(
            in: merged(state),
            from: IndexSet(integer: 0),
            to: 4,
            state: state
        )
        XCTAssertNotNil(moved.builtinState["visibility-spoof"], "built-in order was not persisted")
        XCTAssertEqual(merged(moved).map { $0.id }, ["playsinline", "a", "b", "visibility-spoof"])
    }

    /// An order that does not survive a save silently reverts on next launch,
    /// which is worse than not offering the feature.
    func testOrderSurvivesAStoreRoundTrip() throws {
        let directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("oriel-order-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }

        let state = stateWithUserScripts(["a", "b"])
        let moved = ScriptOrdering.move(
            in: merged(state),
            from: IndexSet(integer: 3),
            to: 0,
            state: state
        )
        let expected = merged(moved).map { $0.id }

        let store = FileStore(directory: directory)
        try store.save(moved)
        let (loaded, _) = store.load()

        XCTAssertEqual(merged(loaded).map { $0.id }, expected)
    }

    /// Two scripts sharing an order fall back to id ordering, which silently
    /// ignores what the user arranged.
    func testOrdersAreDenseAndUnique() {
        let state = stateWithUserScripts(["a", "b"])
        let moved = ScriptOrdering.applying(order: merged(state).reversed(), to: state)
        let orders = merged(moved).map { $0.order }
        XCTAssertEqual(orders, Array(0..<orders.count))
    }

    func testReorderingPreservesEnabledState() {
        var state = stateWithUserScripts(["mine"])
        state.builtinState["visibility-spoof"] = BuiltinState(isEnabled: false, order: -100)

        let moved = ScriptOrdering.move(
            in: merged(state),
            from: IndexSet(integer: 0),
            to: 3,
            state: state
        )
        XCTAssertEqual(
            moved.builtinState["visibility-spoof"]?.isEnabled,
            false,
            "moving a script must not switch it back on"
        )
    }

    func testMovingSeveralAtOnce() {
        let state = stateWithUserScripts(["a", "b", "c"])
        let moved = ScriptOrdering.move(
            in: merged(state),
            from: IndexSet([0, 1]),
            to: 5,
            state: state
        )
        XCTAssertEqual(
            merged(moved).map { $0.id }, ["a", "b", "c", "visibility-spoof", "playsinline"])
    }
}
