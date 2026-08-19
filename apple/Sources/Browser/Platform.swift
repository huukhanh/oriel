#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// The whole iOS/macOS difference in this shell, in one file.
//
// Oriel is the same browser on both platforms: the tab strip, the address bar
// and the toolbar are a document, not a view hierarchy, so almost nothing here
// is platform-bound. What is left is the container view a `WKWebView` gets
// dropped into, and the colour behind it.
//
// Every branch below is written with `#if canImport(...)` rather than
// `#if os(macOS)`. That is deliberate and load-bearing: the typecheck harness in
// `apple/Harness/` compiles these files twice on Linux — once against a UIKit
// stub and once against an AppKit stub — and `os(macOS)` is false in both, so an
// `os()` test would leave the AppKit half of every branch unchecked. On a real
// SDK the two tests agree: the macOS SDK has no UIKit, and iOS has no AppKit.
// (Mac Catalyst does have UIKit, and taking the UIKit branch there is correct.)

#if canImport(UIKit)

/// `UIView` on iOS, `NSView` on macOS.
typealias PlatformView = UIView

/// `UIColor` on iOS, `NSColor` on macOS.
typealias PlatformColor = UIColor

#elseif canImport(AppKit)

typealias PlatformView = NSView
typealias PlatformColor = NSColor

#endif

extension PlatformView {
    /// The autoresizing mask that makes a subview track its container's size.
    ///
    /// The two frameworks spell the same two options differently —
    /// `.flexibleWidth`/`.flexibleHeight` against `.width`/`.height` — so the
    /// name is resolved once here rather than at each of the three call sites.
    static var orielFillMask: PlatformView.AutoresizingMask {
        #if canImport(UIKit)
        return [PlatformView.AutoresizingMask.flexibleWidth, PlatformView.AutoresizingMask.flexibleHeight]
        #elseif canImport(AppKit)
        return [PlatformView.AutoresizingMask.width, PlatformView.AutoresizingMask.height]
        #endif
    }
}

extension PlatformColor {
    /// What shows through when there is no page: the window's own background.
    ///
    /// `UIColor.systemBackground` has no AppKit twin — there is no
    /// `NSColor.systemBackground` — and inventing one is the exact mistake this
    /// project cannot afford, because it looks like correct code. The nearest
    /// honest thing is `NSColor.windowBackgroundColor`, which is the colour a
    /// window is already painted with and follows the appearance the same way.
    static var orielWindowBackground: PlatformColor {
        #if canImport(UIKit)
        return PlatformColor.systemBackground
        #elseif canImport(AppKit)
        return PlatformColor.windowBackgroundColor
        #endif
    }
}
