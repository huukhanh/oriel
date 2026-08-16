// A STUB. This is not UIKit.
//
// It is this project's *belief* about the parts of UIKit that
// `apple/Sources/Browser` uses, written from memory on a machine with no iOS
// SDK. A green build proves the browser's Swift agrees with the surface
// described here; it proves nothing about whether that surface is Apple's.
//
// Every declaration below is a claim to check against Xcode's autocomplete.

@_exported import Foundation

open class UIResponder: NSObject {
    public override init() { super.init() }
}

open class UIView: UIResponder {
    public struct AutoresizingMask: OptionSet {
        public let rawValue: UInt
        public init(rawValue: UInt) { self.rawValue = rawValue }

        public static let flexibleWidth: AutoresizingMask = AutoresizingMask(rawValue: 1 << 1)
        public static let flexibleHeight: AutoresizingMask = AutoresizingMask(rawValue: 1 << 4)
    }

    open var frame: CGRect = CGRect.zero
    open var bounds: CGRect = CGRect.zero
    open var backgroundColor: UIColor?
    open var isOpaque: Bool = true
    open var clipsToBounds: Bool = false
    open var autoresizingMask: AutoresizingMask = []

    open private(set) var subviews: [UIView] = []
    open private(set) weak var superview: UIView?

    public init(frame: CGRect) {
        super.init()
        self.frame = frame
    }

    public override init() { super.init() }

    open func addSubview(_ view: UIView) {
        view.superview = self
        subviews.append(view)
    }

    open func removeFromSuperview() {
        superview = nil
    }
}

open class UIScrollView: UIView {
    open var bounces: Bool = true
    open var isScrollEnabled: Bool = true
    open var contentInsetAdjustmentBehavior: Int = 0
}

open class UIColor: NSObject {
    public static let clear: UIColor = UIColor()
    public static let systemBackground: UIColor = UIColor()
    public static let label: UIColor = UIColor()
}
