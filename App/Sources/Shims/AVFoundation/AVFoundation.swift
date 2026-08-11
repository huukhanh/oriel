// Stub of the AVFoundation / MediaPlayer surface this app uses.
// Linux only — see App/Package.swift.
import Foundation

public final class AVAudioSession: @unchecked Sendable {
    public struct Category: RawRepresentable, Sendable {
        public let rawValue: String
        public init(rawValue: String) { self.rawValue = rawValue }
        public static let playback = Category(rawValue: "AVAudioSessionCategoryPlayback")
        public static let ambient = Category(rawValue: "AVAudioSessionCategoryAmbient")
        public static let soloAmbient = Category(rawValue: "AVAudioSessionCategorySoloAmbient")
    }

    public struct Mode: RawRepresentable, Sendable {
        public let rawValue: String
        public init(rawValue: String) { self.rawValue = rawValue }
        public static let moviePlayback = Mode(rawValue: "AVAudioSessionModeMoviePlayback")
        public static let `default` = Mode(rawValue: "AVAudioSessionModeDefault")
    }

    public struct CategoryOptions: OptionSet, Sendable {
        public let rawValue: UInt
        public init(rawValue: UInt) { self.rawValue = rawValue }
        public static let mixWithOthers = CategoryOptions(rawValue: 1)
        public static let duckOthers = CategoryOptions(rawValue: 2)
        public static let allowAirPlay = CategoryOptions(rawValue: 64)
    }

    public struct SetActiveOptions: OptionSet, Sendable {
        public let rawValue: UInt
        public init(rawValue: UInt) { self.rawValue = rawValue }
        public static let notifyOthersOnDeactivation = SetActiveOptions(rawValue: 1)
    }

    public struct Port: RawRepresentable, Sendable {
        public let rawValue: String
        public init(rawValue: String) { self.rawValue = rawValue }
    }

    public final class PortDescription {
        public var portType: Port = Port(rawValue: "unknown")
        public var portName: String = ""
    }

    public final class RouteDescription {
        public var outputs: [PortDescription] = []
        public var inputs: [PortDescription] = []
    }

    public static func sharedInstance() -> AVAudioSession { AVAudioSession() }

    public var category: Category = .soloAmbient
    public var mode: Mode = .default
    public var currentRoute: RouteDescription = RouteDescription()

    public func setCategory(
        _ category: Category,
        mode: Mode,
        options: CategoryOptions = []
    ) throws {}
    public func setCategory(_ category: Category) throws {}
    public func setActive(_ active: Bool, options: SetActiveOptions = []) throws {}

    public static let interruptionNotification = Notification.Name(
        "AVAudioSessionInterruptionNotification"
    )
    public static let routeChangeNotification = Notification.Name(
        "AVAudioSessionRouteChangeNotification"
    )

    public enum InterruptionType: UInt, Sendable {
        case began = 1
        case ended = 0
    }

    public enum InterruptionReason: UInt, Sendable {
        case `default` = 0
        /// The app was suspended by the system. If this is what we see on
        /// screen lock, background audio is not being granted at all.
        case appWasSuspended = 1
        case builtInMicMuted = 2
        case routeDisconnected = 4
    }

    public struct InterruptionOptions: OptionSet, Sendable {
        public let rawValue: UInt
        public init(rawValue: UInt) { self.rawValue = rawValue }
        public static let shouldResume = InterruptionOptions(rawValue: 1)
    }
}

// Top-level constants, not static members of AVAudioSession — the real SDK
// rejected `AVAudioSession.interruptionTypeKey` with "has no member".
public let AVAudioSessionInterruptionTypeKey = "AVAudioSessionInterruptionTypeKey"
public let AVAudioSessionInterruptionOptionKey = "AVAudioSessionInterruptionOptionKey"
/// iOS 14.5+. The field that says *why* — and the difference between
/// "another app took the session" and "iOS suspended us" is the difference
/// between two completely different bugs.
public let AVAudioSessionInterruptionReasonKey = "AVAudioSessionInterruptionReasonKey"
