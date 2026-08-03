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

// MARK: - Text input

public enum UITextAutocorrectionType: Int, Sendable {
    case `default` = 0
    case no = 1
    case yes = 2
}

public enum UITextAutocapitalizationType: Int, Sendable {
    case none = 0
    case words = 1
    case sentences = 2
    case allCharacters = 3
}

public enum UITextSpellCheckingType: Int, Sendable {
    case `default` = 0
    case no = 1
    case yes = 2
}

/// The whole reason `UITextView` is in this app: these three properties have no
/// SwiftUI equivalent, and without them iOS silently rewrites `"` into a curly
/// quote that is not valid JavaScript.
public enum UITextSmartQuotesType: Int, Sendable {
    case `default` = 0
    case no = 1
    case yes = 2
}

public enum UITextSmartDashesType: Int, Sendable {
    case `default` = 0
    case no = 1
    case yes = 2
}

public enum UITextSmartInsertDeleteType: Int, Sendable {
    case `default` = 0
    case no = 1
    case yes = 2
}

public struct UIFont: Sendable {
    public static func monospacedSystemFont(ofSize: CGFloat, weight: Weight) -> UIFont {
        UIFont()
    }
    public struct Weight: Sendable {
        public static let regular = Weight()
        public static let medium = Weight()
    }
}

public struct UIEdgeInsets: Sendable {
    public var top: CGFloat
    public var left: CGFloat
    public var bottom: CGFloat
    public var right: CGFloat
    public init(top: CGFloat, left: CGFloat, bottom: CGFloat, right: CGFloat) {
        self.top = top
        self.left = left
        self.bottom = bottom
        self.right = right
    }
}

@MainActor
open class UITextView: UIScrollView {
    public var text: String = ""
    public var font: UIFont?
    public var textColor: UIColor?
    public var isEditable: Bool = true
    public var autocorrectionType: UITextAutocorrectionType = .default
    public var autocapitalizationType: UITextAutocapitalizationType = .sentences
    public var spellCheckingType: UITextSpellCheckingType = .default
    public var smartQuotesType: UITextSmartQuotesType = .default
    public var smartDashesType: UITextSmartDashesType = .default
    public var smartInsertDeleteType: UITextSmartInsertDeleteType = .default
    public var textContainerInset: UIEdgeInsets = UIEdgeInsets(
        top: 0, left: 0, bottom: 0, right: 0
    )
    public var inputAccessoryView: UIView?
    public weak var delegate: UITextViewDelegate?
    public func insertText(_ text: String) {}
}

@MainActor
public protocol UITextViewDelegate: AnyObject {
    func textViewDidChange(_ textView: UITextView)
}

extension UITextViewDelegate {
    public func textViewDidChange(_ textView: UITextView) {}
}
