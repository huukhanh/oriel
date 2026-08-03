import Core
import Foundation
import WebKit

/// Owns the `WKUserContentController`'s script set.
///
/// Two WebKit facts drive every line here:
///
/// 1. **User scripts are a set, not individually addressable.** There is no
///    `remove(script)` — only `removeAllUserScripts()`. So the desired set is
///    held in Swift and rebuilt wholesale on any change. Never incrementally.
/// 2. **Worlds do not share globals, and that includes the bridge.** A handler
///    added without a world is invisible to a script running in `.page`. The
///    prelude and the message handlers are therefore installed *per world*, for
///    every world that has scripts in it.
@MainActor
final class InjectionController {

    private let contentController: WKUserContentController
    private let preludeSource: String
    private let bridge: ScriptBridge

    /// Worlds we have already wired a bridge into. Handlers are registered once
    /// per world and never removed, because removing one while a page holds a
    /// reference is a good way to get "undefined is not an object" at random.
    private var wiredWorlds: Set<String> = []

    private let storeBridge: ScriptStoreBridge

    init(
        contentController: WKUserContentController,
        preludeSource: String,
        bridge: ScriptBridge,
        storeBridge: ScriptStoreBridge
    ) {
        self.contentController = contentController
        self.preludeSource = preludeSource
        self.bridge = bridge
        self.storeBridge = storeBridge
    }

    /// Replace the entire injected set.
    ///
    /// Note what this does **not** do: recompute which scripts match the
    /// destination URL before each navigation (the brainstorm's "Layer A").
    /// That is an optimisation, not correctness — the guard compiled into every
    /// wrapper is what actually decides whether a script runs, and it is
    /// re-checked on SPA routes where Layer A never fires at all.
    ///
    /// Skipping it deletes a whole class of bug: a redirect changing the final
    /// URL after the set was computed, and — worse — a subframe navigation
    /// triggering a rebuild that wipes the main frame's scripts, which is how
    /// an iframe ad ends up disabling the user's scripts.
    func rebuild(with scripts: [Script]) {
        contentController.removeAllUserScripts()

        let enabled = scripts.filter { $0.isEnabled }

        // `.page` ALWAYS gets the runtime, even with no scripts enabled.
        //
        // The runtime is not only the script host — it owns the media bridge
        // that the toolbar's PiP button calls into. Deriving the world list
        // purely from enabled scripts meant that turning every script off also
        // silently killed PiP and Now Playing, with `window.__inj` simply
        // undefined. Nothing compiled differently and nothing logged; a
        // simulator test is what caught it.
        var worlds: Set<ScriptWorld> = [.page]
        worlds.formUnion(enabled.map { $0.metadata.world })

        // The prelude must come first in every world that has scripts, because
        // each wrapper's first act is to call `window.__inj.register`.
        for world in worlds.sorted(by: { $0.rawValue < $1.rawValue }) {
            wireBridgeIfNeeded(for: world)
            contentController.addUserScript(
                WKUserScript(
                    source: preludeSource,
                    injectionTime: .atDocumentStart,
                    // Scripts can opt out of frames individually; the runtime
                    // itself must exist wherever one of them might run.
                    forMainFrameOnly: false,
                    in: contentWorld(for: world)
                )
            )
        }

        for script in enabled {
            let wrapped = WrapperBuilder.wrap(
                id: script.id,
                metadata: script.metadata,
                source: script.source
            )
            contentController.addUserScript(
                WKUserScript(
                    source: wrapped,
                    // Always document-start, whatever @run-at says. The wrapper
                    // registers with the runtime; the runtime decides when the
                    // body runs. Injecting late would mean a script that wants
                    // document-start could never get it.
                    injectionTime: .atDocumentStart,
                    forMainFrameOnly: script.metadata.noFrames,
                    in: contentWorld(for: script.metadata.world)
                )
            )
        }
    }

    private func wireBridgeIfNeeded(for world: ScriptWorld) {
        guard wiredWorlds.contains(world.rawValue) == false else {
            return
        }
        wiredWorlds.insert(world.rawValue)
        let target = contentWorld(for: world)
        contentController.add(bridge, contentWorld: target, name: ScriptBridge.logHandlerName)
        contentController.add(bridge, contentWorld: target, name: ScriptBridge.mediaHandlerName)
        // A separate call: the reply variant is a different protocol, and
        // registering it with `add(_:contentWorld:name:)` would compile and
        // then never deliver.
        contentController.addScriptMessageHandler(
            storeBridge,
            contentWorld: target,
            name: ScriptStoreBridge.handlerName
        )
    }

    private func contentWorld(for world: ScriptWorld) -> WKContentWorld {
        switch world {
        case .page: return .page
        case .isolated: return .defaultClient
        }
    }
}
