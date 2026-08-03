import Core
import Foundation
import SwiftUI
import UIKit

@main
struct OrielApp: App {
    @StateObject private var model: AppModel = OrielApp.makeModel()

    var body: some Scene {
        WindowGroup {
            BrowserView(initialURL: OrielApp.startURL)
                .environmentObject(model)
        }
    }

    /// UI tests pass `-uitest`, which starts on a blank page.
    ///
    /// Without it every UI test would depend on the network and on YouTube's
    /// markup — two things that can fail for reasons having nothing to do with
    /// this app, in a runner with no obvious way to tell the difference.
    private static var startURL: URL? {
        if ProcessInfo.processInfo.arguments.contains("-uitest") {
            return URL(string: "about:blank")
        }
        return URL(string: "https://m.youtube.com/")
    }

    @MainActor
    private static func makeModel() -> AppModel {
        let directory =
            FileManager.default.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            ).first ?? URL(fileURLWithPath: NSTemporaryDirectory())

        return AppModel(
            store: FileStore(directory: directory),
            builtins: BuiltinLibrary.load(),
            media: MediaCoordinator()
        )
    }
}
