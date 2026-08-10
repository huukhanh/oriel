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
    private var interruptionObserver: (any NSObjectProtocol)?
    private var isPlaying = false
    private var settings = Settings()

    /// Reported to the log rather than thrown, so a failure is visible without
    /// being fatal.
    private(set) var lastError: String?

    /// Tokens from `addTarget`. Kept because dropping them leaks the handler
    /// for the lifetime of the process, and a second registration would then
    /// mean the lock-screen button fires twice.
    private var commandTokens: [Any] = []

    /// Sends a command to the page. Set once the webview exists; the lock
    /// screen has nothing to drive until then.
    var perform: (@MainActor (MediaCommand) -> Void)?

    func apply(settings: Settings) {
        self.settings = settings
        if settings.enableBackgroundAudio {
            activateSession()
        }
        updateIdleTimer()
        registerRemoteCommands()
        observeInterruptions()
    }

    /// Lock screen and Control Center.
    ///
    /// Registering these is what was missing in #37: metadata was published, so
    /// the card appeared, but nothing was listening — the buttons moved and the
    /// page carried on regardless. A control that looks live and does nothing is
    /// worse than no control.
    private func registerRemoteCommands() {
        guard commandTokens.isEmpty else {
            return
        }
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.isEnabled = true
        commandTokens.append(
            center.playCommand.addTarget { [weak self] _ in
                self?.perform?(.play)
                return .success
            }
        )

        center.pauseCommand.isEnabled = true
        commandTokens.append(
            center.pauseCommand.addTarget { [weak self] _ in
                self?.perform?(.pause)
                return .success
            }
        )

        // Headphone and steering-wheel controls send this rather than
        // play/pause, so without it those do nothing at all.
        center.togglePlayPauseCommand.isEnabled = true
        commandTokens.append(
            center.togglePlayPauseCommand.addTarget { [weak self] _ in
                self?.perform?(.toggle)
                return .success
            }
        )

        center.skipForwardCommand.isEnabled = true
        center.skipForwardCommand.preferredIntervals = [NSNumber(value: 15)]
        commandTokens.append(
            center.skipForwardCommand.addTarget { [weak self] _ in
                self?.perform?(.skipForward(15))
                return .success
            }
        )

        center.skipBackwardCommand.isEnabled = true
        center.skipBackwardCommand.preferredIntervals = [NSNumber(value: 15)]
        commandTokens.append(
            center.skipBackwardCommand.addTarget { [weak self] _ in
                self?.perform?(.skipBackward(15))
                return .success
            }
        )
    }

    /// Called from the page bridge when playback starts or stops.
    func setPlaying(_ playing: Bool) {
        isPlaying = playing
        if playing {
            activateSession()
        }
        updateIdleTimer()
    }

    /// Interruptions: a call, an alarm, another app taking the session.
    ///
    /// Without this, the first interruption ends background playback until the
    /// app is relaunched — the session is deactivated by the system and nothing
    /// ever reactivates it. That is indistinguishable from "background audio
    /// does not work", which is how it would be reported.
    func observeInterruptions() {
        guard interruptionObserver == nil else {
            return
        }
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: nil
        ) { [weak self] notification in
            let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            Task { @MainActor in
                guard let self else {
                    return
                }
                if raw == AVAudioSession.InterruptionType.began.rawValue {
                    // The system has already deactivated it; just record that.
                    self.isSessionActive = false
                } else {
                    self.activateSession()
                    self.resumeAfterInterruption?()
                }
            }
        }
    }

    /// Called after an interruption ends, so the page can resume.
    var resumeAfterInterruption: (@MainActor () -> Void)?

    /// Activating once at launch is not enough.
    ///
    /// Another app taking the session deactivates ours, and an interruption —
    /// a call, an alarm — does the same. If we only ever activate at startup,
    /// the first phone call silently ends background playback for the rest of
    /// the session. So this is called again whenever playback starts, and the
    /// already-active guard makes that cheap.
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

        let center = MPRemoteCommandCenter.shared()
        for token in commandTokens {
            center.playCommand.removeTarget(token)
            center.pauseCommand.removeTarget(token)
            center.togglePlayPauseCommand.removeTarget(token)
            center.skipForwardCommand.removeTarget(token)
            center.skipBackwardCommand.removeTarget(token)
        }
        commandTokens.removeAll()

        if let interruptionObserver {
            NotificationCenter.default.removeObserver(interruptionObserver)
            self.interruptionObserver = nil
        }
    }
}
