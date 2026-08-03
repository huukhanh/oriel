import AVFoundation
import Foundation

/// Configures and activates the audio session. Half of the mechanism under
/// test — the other half is `UIBackgroundModes: audio` in Info.plist. Both are
/// required; either one alone does nothing.
@MainActor
final class AudioSessionController {
    private let session: AVAudioSession = AVAudioSession.sharedInstance()

    /// Activated eagerly at launch rather than on first play. The spike wants
    /// the session up before any media starts, because activating it *after*
    /// WebKit has already begun playing is a different code path and would
    /// muddy the result.
    func activate(log: ProbeLog) {
        do {
            try session.setCategory(.playback, mode: .moviePlayback, options: [])
        } catch {
            log.record("AUDIO", "setCategory failed: \(error.localizedDescription)")
            return
        }

        do {
            try session.setActive(true, options: [])
        } catch {
            log.record("AUDIO", "setActive failed: \(error.localizedDescription)")
            return
        }

        log.record(
            "AUDIO",
            "session active, category=\(session.category.rawValue) "
                + "output=\(describeOutputs())"
        )
    }

    func describeOutputs() -> String {
        let outputs = session.currentRoute.outputs.map { $0.portType.rawValue }
        return outputs.isEmpty ? "none" : outputs.joined(separator: ",")
    }
}
