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

    /// Where audio-session events go.
    ///
    /// Added because `lastError` was captured and never read: every activation
    /// failure since the project started was discarded silently, which is
    /// exactly why "stops immediately on lock" could not be diagnosed from
    /// here. The session's actual state now reaches the in-app log, where it
    /// can be copied out of a device.
    var log: (@MainActor (String, String) -> Void)?

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
            activateSession(reason: "launch")
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
        // Activate only if it is not already active — the guard inside makes
        // this a no-op in the normal case. Media events arrive several times a
        // second on a busy page, and turning each into a session call is what
        // broke playback.
        if playing {
            activateSession(reason: "playback started")
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
            let reasonRaw = notification.userInfo?[AVAudioSessionInterruptionReasonKey] as? UInt
            let optionRaw = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt

            Task { @MainActor in
                guard let self else {
                    return
                }
                if raw == AVAudioSession.InterruptionType.began.rawValue {
                    // The system has already deactivated it; just record that.
                    self.isSessionActive = false
                    self.log?(
                        "warn",
                        "audio session interrupted — reason=\(Self.describeReason(reasonRaw))"
                    )
                } else {
                    let shouldResume =
                        (optionRaw ?? 0)
                        & AVAudioSession.InterruptionOptions.shouldResume.rawValue != 0
                    self.log?(
                        "log",
                        "audio session interruption ended — shouldResume=\(shouldResume)"
                    )
                    // Only when the system says so.
                    //
                    // Resuming unconditionally is what closed the loop: our
                    // resume produced a play event, which produced a session
                    // call, which interrupted WebKit again. `shouldResume` is
                    // the system telling us it is safe — absent it, the right
                    // move is to leave playback alone.
                    guard
                        AudioSessionPolicy.shouldResume(
                            systemSaysResume: shouldResume,
                            enabled: self.settings.enableBackgroundAudio
                        )
                    else {
                        self.log?("log", "not resuming — the system did not ask us to")
                        return
                    }
                    self.activateSession(reason: "interruption ended")
                    self.resumeAfterInterruption?()
                }
            }
        }
    }

    /// Called after an interruption ends, so the page can resume.
    var resumeAfterInterruption: (@MainActor () -> Void)?

    /// Assert the playback session — **at most once**, until something
    /// actually invalidates it.
    ///
    /// This guard is load-bearing, and removing it caused a regression worth
    /// recording. `WKWebView` runs its own `AudioSession` inside the WebContent
    /// process. Every `setCategory`/`setActive` call we make on the shared
    /// session *interrupts WebKit's* — WebKit says so itself:
    ///
    ///     AudioSession::beginInterruption but session is already interrupted!
    ///
    /// Re-asserting on every playback event meant four activations in four
    /// seconds, each one interrupting the very playback it was meant to
    /// protect. Combined with resuming after an interruption, that closed a
    /// loop: activate → WebKit interrupted → we resume → play event →
    /// activate. The device log showed interruptions arriving one second after
    /// activation.
    ///
    /// So: configure the session once and let WebKit own playback. The flag is
    /// cleared when an interruption genuinely invalidates it, which is the only
    /// time re-activating is correct.
    private func activateSession(reason: String) {
        guard settings.enableBackgroundAudio else {
            log?("warn", "background audio is switched off in Settings")
            return
        }
        guard
            AudioSessionPolicy.shouldActivate(
                AudioSessionPolicy.State(
                    enabled: settings.enableBackgroundAudio,
                    isActive: isSessionActive,
                    isPlaying: isPlaying
                )
            )
        else {
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
            log?(
                "log",
                "audio session active (\(reason)) — category=\(session.category.rawValue) "
                    + "mode=\(session.mode.rawValue) out=\(describeOutputs())"
            )
        } catch {
            isSessionActive = false
            lastError = "audio session: \(error)"
            // Surfaced, not swallowed. An inactive session is precisely why
            // playback would stop the moment the screen locks, and until now
            // this error went nowhere.
            log?("error", "audio session FAILED (\(reason)): \(error)")
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
            log?("warn", "audio session deactivate failed: \(error)")
        }
    }

    /// Only while media is actually playing, and cleared on pause and on
    /// teardown — an idle timer left disabled quietly flattens the battery.
    private func updateIdleTimer() {
        UIApplication.shared.isIdleTimerDisabled =
            settings.disableIdleTimerDuringPlayback && isPlaying
    }

    /// A copyable snapshot for a bug report. The whole reason this exists is
    /// that "audio stopped" is not actionable and "the session was inactive
    /// with category soloAmbient" is.
    /// The interruption reason in words.
    ///
    /// `appWasSuspended` is the one that matters: it means iOS suspended the
    /// whole app, so the background-audio entitlement is not being granted —
    /// a completely different problem from another app taking the session.
    static func describeReason(_ raw: UInt?) -> String {
        switch raw {
        case AVAudioSession.InterruptionReason.appWasSuspended.rawValue:
            return "appWasSuspended (iOS suspended this app — background audio not granted)"
        case AVAudioSession.InterruptionReason.builtInMicMuted.rawValue:
            return "builtInMicMuted"
        case AVAudioSession.InterruptionReason.routeDisconnected.rawValue:
            return "routeDisconnected (headphones unplugged?)"
        case AVAudioSession.InterruptionReason.default.rawValue:
            return "default (another app or the system took the session)"
        case .none:
            return "not reported (iOS < 14.5)"
        default:
            return "unknown(\(raw.map(String.init) ?? "nil"))"
        }
    }

    /// Which route audio is currently going to. Named in the log because
    /// "playing to the earpiece" and "playing to AirPlay" are different bugs.
    func describeOutputs() -> String {
        let outputs = session.currentRoute.outputs.map { $0.portType.rawValue }
        return outputs.isEmpty ? "none" : outputs.joined(separator: ",")
    }

    func diagnostics() -> String {
        var lines: [String] = []
        lines.append("background audio setting: \(settings.enableBackgroundAudio)")
        lines.append("session believed active: \(isSessionActive)")
        lines.append("category: \(session.category.rawValue)")
        lines.append("mode: \(session.mode.rawValue)")
        lines.append("outputs: \(describeOutputs())")
        lines.append("playing: \(isPlaying)")
        lines.append("last error: \(lastError ?? "none")")
        return lines.joined(separator: "\n")
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
