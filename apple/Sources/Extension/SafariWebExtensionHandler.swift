import Foundation

/// The extension point's required principal class.
///
/// Oriel uses no native messaging: everything it does happens in JavaScript,
/// and there is nothing on this side of the boundary for a message to ask for.
/// So this handler completes every request immediately and holds no state.
///
/// Resisting the urge to put anything here is deliberate. Code in this file
/// cannot be compiled, run, or tested anywhere in this project's development
/// loop — the nearest thing to a test is a person with an iPhone. Every line
/// that lives here instead of in `extension/src/` is a line nobody can check.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        context.completeRequest(returningItems: [], completionHandler: nil)
    }
}
