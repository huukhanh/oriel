// Stub of the UIKit surface this app uses. Linux only — see App/Package.swift.
import Foundation

// NSObject comes from Foundation; declaring it here too made every
// `: NSObject` conformance ambiguous.

@MainActor
open class UIResponder: NSObject {}

/// `@MainActor`, as the real UIKit classes are. Getting this annotation right
/// is the point — actor isolation is the single most common way blind Swift 6
/// code fails to build, and a stub that is laxer than the SDK would hide
/// exactly those errors.
@MainActor
open class UIView: UIResponder {
    public var frame: CGRect = .zero
    public var isHidden: Bool = false
    public var backgroundColor: UIColor?
    public func addSubview(_ view: UIView) {}
    public func removeFromSuperview() {}
}

@MainActor
open class UIScrollView: UIView {
    public var contentOffset: CGPoint = .zero
    public var contentSize: CGSize = .zero
}

public struct UIColor: Sendable {
    public static let clear = UIColor()
    public static let black = UIColor()
    public static let white = UIColor()
    public static let systemBackground = UIColor()
}

public final class UIApplication: @unchecked Sendable {
    public static let shared = UIApplication()
    public var isIdleTimerDisabled: Bool = false
    public func open(_ url: URL) {}
    public func canOpenURL(_ url: URL) -> Bool { true }
}

public final class UIPasteboard: @unchecked Sendable {
    public static let general = UIPasteboard()
    public var string: String?
}

public final class UIImpactFeedbackGenerator {
    public enum FeedbackStyle: Sendable { case light, medium, heavy, soft, rigid }
    public init(style: FeedbackStyle) {}
    public func impactOccurred() {}
    public func prepare() {}
}
