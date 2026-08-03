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

    private static let startURL = URL(string: "https://m.youtube.com/")

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
