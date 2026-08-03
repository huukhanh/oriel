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
    public static let interruptionTypeKey = "AVAudioSessionInterruptionTypeKey"

    public enum InterruptionType: UInt, Sendable {
        case began = 1
        case ended = 0
    }
}

// MARK: - Now Playing

public final class MPNowPlayingInfoCenter: @unchecked Sendable {
    public static func `default`() -> MPNowPlayingInfoCenter { MPNowPlayingInfoCenter() }
    public var nowPlayingInfo: [String: Any]?
}

public let MPMediaItemPropertyTitle = "MPMediaItemPropertyTitle"
public let MPMediaItemPropertyArtist = "MPMediaItemPropertyArtist"
public let MPMediaItemPropertyPlaybackDuration = "MPMediaItemPropertyPlaybackDuration"
public let MPNowPlayingInfoPropertyElapsedPlaybackTime =
    "MPNowPlayingInfoPropertyElapsedPlaybackTime"
public let MPNowPlayingInfoPropertyPlaybackRate = "MPNowPlayingInfoPropertyPlaybackRate"

public final class MPRemoteCommandCenter: @unchecked Sendable {
    public static func shared() -> MPRemoteCommandCenter { MPRemoteCommandCenter() }
    public let playCommand = MPRemoteCommand()
    public let pauseCommand = MPRemoteCommand()
    public let togglePlayPauseCommand = MPRemoteCommand()
    public let skipForwardCommand = MPRemoteCommand()
    public let skipBackwardCommand = MPRemoteCommand()
}

public final class MPRemoteCommand {
    public var isEnabled: Bool = false
    @discardableResult
    public func addTarget(
        handler: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus
    ) -> Any { self }
    public func removeTarget(_ target: Any?) {}
}

public final class MPRemoteCommandEvent {}

public enum MPRemoteCommandHandlerStatus: Int, Sendable {
    case success = 0
    case noSuchContent = 100
    case commandFailed = 200
}
