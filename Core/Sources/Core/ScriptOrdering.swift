import Foundation

/// Reordering the merged script list.
///
/// In `Core` because the awkward part is not the gesture, it is that the list
/// spans two stores (decision 002): built-in order lives in
/// `AppState.builtinState`, user script order lives on the `Script` itself. A
/// move has to renumber across both, and the result has to survive a
/// round-trip — otherwise the order silently reverts on next launch, which is
/// worse than not offering the feature.
public enum ScriptOrdering {

    /// Apply a move, returning state with every affected order rewritten.
    ///
    /// - Parameters:
    ///   - ordered: the merged list as displayed, before the move.
    ///   - source: indices being moved, as SwiftUI's `onMove` supplies them.
    ///   - destination: the insertion index, in the pre-move coordinate space.
    public static func move(
        in ordered: [Script],
        from source: IndexSet,
        to destination: Int,
        state: AppState
    ) -> AppState {
        return applying(order: moved(ordered, from: source, to: destination), to: state)
    }

    /// SwiftUI's `onMove` semantics, implemented explicitly.
    ///
    /// `move(fromOffsets:toOffset:)` is a SwiftUI extension and does not exist
    /// in Foundation, so it cannot be used in `Core`. Writing it out is no loss:
    /// the subtle part is that `destination` is an index in the **pre-move**
    /// list, so removing the moved items first shifts it.
    static func moved<T>(_ items: [T], from source: IndexSet, to destination: Int) -> [T] {
        let taken = source.sorted().compactMap { $0 < items.count ? items[$0] : nil }
        var remaining: [T] = []
        for (index, item) in items.enumerated() where source.contains(index) == false {
            remaining.append(item)
        }
        // Everything removed from above the insertion point moves it up.
        let adjusted = destination - source.filter { $0 < destination }.count
        let clamped = max(0, min(adjusted, remaining.count))
        remaining.insert(contentsOf: taken, at: clamped)
        return remaining
    }

    /// Renumber `state` so the merged list comes back in exactly `ordered`.
    ///
    /// Dense 0-based indices rather than preserving the old spacing: gaps
    /// invite collisions later, and `ScriptResolver` breaks ties by id, so two
    /// scripts sharing an order silently ignore the user's arrangement.
    public static func applying(order ordered: [Script], to state: AppState) -> AppState {
        var updated = state

        for (index, script) in ordered.enumerated() {
            switch script.origin {
            case .builtIn:
                let existing = updated.builtinState[script.id]
                updated.builtinState[script.id] = BuiltinState(
                    isEnabled: existing?.isEnabled ?? script.isEnabled,
                    order: index
                )
            case .user:
                if let position = updated.scripts.firstIndex(where: { $0.id == script.id }) {
                    updated.scripts[position].order = index
                }
            }
        }
        return updated
    }
}
