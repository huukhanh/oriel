// Stub of the MediaPlayer surface this app uses. Linux only.
//
// Split out of the AVFoundation stub because that is where it actually lives:
// MPNowPlayingInfoCenter and MPRemoteCommandCenter are MediaPlayer, and a file
// that imports only AVFoundation will not see them. The real SDK caught this;
// the stub had them in the wrong module.
import Foundation

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
