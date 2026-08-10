import Foundation

/// A media control the system can send — from the lock screen, Control Center,
/// headphones, or a car.
///
/// In `Core` with its JavaScript spelled out here rather than inline in the
/// coordinator, because the mapping is exactly the kind of string that rots
/// silently: a typo produces a lock-screen button that does nothing, with no
/// error anywhere. Here it is covered by a test.
public enum MediaCommand: Hashable, Sendable {
    case play
    case pause
    case toggle
    case skipForward(Int)
    case skipBackward(Int)

    /// The call to evaluate in the page.
    public var javaScript: String {
        switch self {
        case .play: return "window.__inj.media.play()"
        case .pause: return "window.__inj.media.pause()"
        case .toggle: return "window.__inj.media.toggle()"
        case .skipForward(let seconds): return "window.__inj.media.seekBy(\(seconds))"
        case .skipBackward(let seconds): return "window.__inj.media.seekBy(-\(seconds))"
        }
    }
}
