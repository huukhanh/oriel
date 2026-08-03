import AVFoundation
import Core
import MediaPlayer
import Foundation
import UIKit

/// Audio session, Now Playing, and the idle timer.
///
/// Scoped by `docs/decisions/004-background-audio-unverified.md`: background
/// audio is **opportunistic**. Nothing else in the app may depend on it
/// working, and it must fail quietly — a media feature that throws on launch
/// because the session would not activate is worse than one that simply does
/// not happen.
///
/// What is *not* here, deliberately: any attempt to enter Picture-in-Picture
/// programmatically. `requestPictureInPicture()` outside a genuine user gesture
/// fails silently — the promise rejects, or the presentation-mode event fires
/// with no window ever appearing. Every PiP entry in this app routes through a
/// real tap on the toolbar button, and a future contributor should not try to
/// "fix" this by automating it.
@MainActor
final class MediaCoordinator {

    private let session = AVAudioSession.sharedInstance()
    private var isSessionActive = false
    private var isPlaying = false
    private var settings = Settings()

    /// Reported to the log rather than thrown, so a failure is visible without
    /// being fatal.
    private(set) var lastError: String?

    func apply(settings: Settings) {
        self.settings = settings
        if settings.enableBackgroundAudio {
            activateSession()
        }
        updateIdleTimer()
    }

    /// Called from the page bridge when playback starts or stops.
    func setPlaying(_ playing: Bool) {
        isPlaying = playing
        if playing {
            activateSession()
        }
        updateIdleTimer()
    }

    private func activateSession() {
        guard settings.enableBackgroundAudio, isSessionActive == false else {
            return
        }
        do {
            // `.moviePlayback` rather than `.default`: this is a browser whose
            // audio is nearly always video, and it is the mode AirPlay routing
            // expects.
            try session.setCategory(.playback, mode: .moviePlayback, options: [])
            try session.setActive(true, options: [])
            isSessionActive = true
            lastError = nil
        } catch {
            lastError = "audio session: \(error)"
        }
    }

    func deactivateSession() {
        guard isSessionActive else {
            return
        }
        do {
            try session.setActive(false, options: [.notifyOthersOnDeactivation])
            isSessionActive = false
        } catch {
            lastError = "audio session deactivate: \(error)"
        }
    }

    /// Only while media is actually playing, and cleared on pause and on
    /// teardown — an idle timer left disabled quietly flattens the battery.
    private func updateIdleTimer() {
        UIApplication.shared.isIdleTimerDisabled =
            settings.disableIdleTimerDuringPlayback && isPlaying
    }

    func nowPlaying(title: String, duration: Double, elapsed: Double, rate: Double) {
        var info: [String: Any] = [:]
        info[MPMediaItemPropertyTitle] = title
        if duration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = duration
        }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsed
        info[MPNowPlayingInfoPropertyPlaybackRate] = rate
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    func clearNowPlaying() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    func teardown() {
        UIApplication.shared.isIdleTimerDisabled = false
        clearNowPlaying()
        deactivateSession()
    }
}
