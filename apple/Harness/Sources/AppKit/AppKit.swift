// A STUB. This is not AppKit.
//
// It is this project's *belief* about the parts of AppKit that
// `apple/Sources/Browser` uses, written from memory on a machine with no macOS
// SDK. A green build proves the browser's Swift agrees with the surface
// described here; it proves nothing about whether that surface is Apple's.
//
// This file deserves more suspicion than the others: nothing in this project
// has ever been compiled against real AppKit, so every declaration below is a
// first-time claim rather than one a Mac build has already survived. The three
// worth checking first, because they are the three the code depends on being
// *different* from UIKit:
//
//   - `NSView.AutoresizingMask` spells the two options `.width` and `.height`,
//     not `.flexibleWidth` and `.flexibleHeight`.
//   - `NSView.isOpaque` is get-only. `UIView.isOpaque` is settable, and the
//     shipping code assigns to it — which must therefore be inside a `#if`.
//     Modelled as get-only here so that the harness catches the assignment.
//   - `NSView` has no `backgroundColor` and, before macOS 14, no
//     `clipsToBounds`. Neither is declared here, on purpose: an absent
//     declaration is what turns a use of them into a build error.
//
// `NSColor.systemBackground` is likewise absent, because it does not exist.
// `windowBackgroundColor` is the nearest real thing and is what the code uses.

@_exported import Foundation

open class NSResponder: NSObject {
    public override init() { super.init() }
}

open class NSView: NSResponder {
    public struct AutoresizingMask: OptionSet {
        public let rawValue: UInt
        public init(rawValue: UInt) { self.rawValue = rawValue }

        public static let width: AutoresizingMask = AutoresizingMask(rawValue: 1 << 1)
        public static let height: AutoresizingMask = AutoresizingMask(rawValue: 1 << 4)
    }

    open var frame: CGRect = CGRect.zero
    open var bounds: CGRect = CGRect.zero
    open var autoresizingMask: AutoresizingMask = []
    open var wantsLayer: Bool = false

    /// Get-only, unlike `UIView.isOpaque`. See the header.
    open var isOpaque: Bool { return true }

    open private(set) var subviews: [NSView] = []
    open private(set) weak var superview: NSView?

    public init(frame frameRect: CGRect) {
        super.init()
        self.frame = frameRect
    }

    public override init() { super.init() }

    open func addSubview(_ view: NSView) {
        view.superview = self
        subviews.append(view)
    }

    open func removeFromSuperview() {
        superview = nil
    }
}

open class NSColor: NSObject {
    // Only what the shipping code names. An unused stub declaration is an
    // unchecked claim; `NSColor.clear` and `NSColor.labelColor` are both real,
    // and both stay out of here until something uses them.
    public static let windowBackgroundColor: NSColor = NSColor()
}
