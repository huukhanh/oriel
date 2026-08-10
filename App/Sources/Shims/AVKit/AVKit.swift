// Stub of the AVKit surface this app uses. Linux only.
//
// AVRoutePickerView is the system AirPlay button. It is deliberately not
// reimplemented: the picker is a system-provided sheet, and a hand-rolled
// route list cannot switch an active media session.
import Foundation
import UIKit

@MainActor
open class AVRoutePickerView: UIView {
    public enum ActiveTintColor: Sendable { case none }
    public var activeTintColor: UIColor?
    public var prioritizesVideoDevices: Bool = false
    public override init() { super.init() }
}
