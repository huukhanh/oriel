import SwiftUI

/// The app entry point, and nothing else.
///
/// This replaces the setup-instructions app that shipped with the Safari
/// extension. Oriel is a browser now; the extension target survives as a test
/// host, but it is no longer what the app is for. See
/// docs/decisions/001-browser-not-extension.md.
@main
struct OrielApp: App {
    var body: some Scene {
        WindowGroup {
            BrowserView()
        }
    }
}
