import SwiftUI
import UIKit

@main
struct SpikeApp: App {
    @StateObject private var log = ProbeLog()
    private let audio = AudioSessionController()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(log)
                .onAppear {
                    // Idle timer off for the whole run: the spike must not be
                    // killed by the screen auto-locking on its own schedule
                    // halfway through a 10-minute measurement. Screen lock is
                    // tested deliberately, by pressing the button.
                    UIApplication.shared.isIdleTimerDisabled = true
                    audio.activate(log: log)
                    log.record("RUN", "spike started")
                }
        }
    }
}
