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

// MARK: - Accessory row
//
// Closure-based (`UIAction`) rather than target/action: `Selector` is an
// Objective-C runtime type that does not exist on Linux, so `#selector` would
// make the app unbuildable here. It is also the better modern API.

/// The handler takes the action itself — `UIActionHandler` is
/// `(UIAction) -> Void`, not `() -> Void`. The real SDK caught the zero-argument
/// version with "contextual type for closure argument list expects 1 argument".
public struct UIAction: Sendable {
    public typealias Handler = @MainActor @Sendable (UIAction) -> Void
    public let handler: Handler
    public init(handler: @escaping Handler) {
        self.handler = handler
    }
    public init(title: String, handler: @escaping Handler) {
        self.handler = handler
    }
}

public enum UIControl {
    public struct State: OptionSet, Sendable {
        public let rawValue: UInt
        public init(rawValue: UInt) { self.rawValue = rawValue }
        public static let normal = State(rawValue: 0)
    }
    public struct Event: OptionSet, Sendable {
        public let rawValue: UInt
        public init(rawValue: UInt) { self.rawValue = rawValue }
        public static let touchUpInside = Event(rawValue: 1 << 6)
    }
}

@MainActor
open class UILabel: UIView {
    public var text: String?
    public var font: UIFont?
}

@MainActor
open class UIButton: UIView {
    public enum ButtonType: Sendable { case system, custom }
    public init(type: ButtonType) { super.init() }
    public func setTitle(_ title: String?, for state: UIControl.State) {}
    public func setTitleColor(_ color: UIColor?, for state: UIControl.State) {}
    public func addAction(_ action: UIAction, for event: UIControl.Event) {}
    public var titleLabel: UILabel? { nil }
}

@MainActor
open class UIStackView: UIView {
    public enum Axis: Sendable { case horizontal, vertical }
    public enum Distribution: Sendable { case fill, fillEqually, equalSpacing }
    public init(arrangedSubviews: [UIView]) { super.init() }
    public var axis: Axis = .horizontal
    public var distribution: Distribution = .fill
    public var spacing: CGFloat = 0
}
