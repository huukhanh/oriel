import Core
import Foundation
import SwiftUI

/// Settings, grouped by whether changing them throws the page away.
///
/// §4.2 asks for this split to be *visible*, not just implemented: a toggle
/// that silently reloads the page is a surprise, and one that silently does
/// nothing is a bug. The section header is the honest version.
struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var showingScripts = false

    var body: some View {
        NavigationStack {
            Form {
                // First, deliberately. The reporter of #32 looked for
                // "Settings → Custom Scripts", found nothing, and concluded
                // scripting was broken. The toolbar's {} button is the fast
                // path from a page; this is the one people go looking for.
                Section("Scripts") {
                    Button(action: { showingScripts = true }) {
                        HStack {
                            Text("Scripts")
                            Spacer()
                            Text("\(model.scripts.count)")
                                .foregroundStyle(Color.secondary)
                        }
                    }
                    .accessibilityIdentifier("settings.scripts")
                    Text("Write or paste userscripts. Also on the {} button in the toolbar.")
                        .font(.footnote)
                        .foregroundStyle(Color.secondary)
                }

                Section("Reloads the page") {
                    toggle("Inline playback", \.allowsInlineMediaPlayback)
                    toggle("Picture in Picture", \.allowsPictureInPicture)
                    toggle("Autoplay", \.allowsAutoplay)
                    toggle("Keep cookies and logins", \.usesPersistentDataStore)
                    toggle("JavaScript", \.allowsJavaScript)
                }

                Section("Applies immediately") {
                    toggle("Show address bar (debug)", \.showAddressBar)
                    toggle("Desktop site", \.useDesktopUserAgent)
                    toggle("Keep screen awake while playing", \.disableIdleTimerDuringPlayback)
                    toggle("Background audio", \.enableBackgroundAudio)
                }

                Section("Sleep timer") {
                    if model.state.sleepTimer.isActive {
                        HStack {
                            Text("Stops in")
                            Spacer()
                            Text(model.state.sleepTimer.label())
                                .foregroundStyle(Color.secondary)
                        }
                        Button("Cancel timer", role: .destructive) {
                            model.cancelSleepTimer()
                        }
                    } else {
                        ForEach(SleepTimer.presets, id: \.self) { minutes in
                            Button("\(minutes) minutes") {
                                model.startSleepTimer(minutes: minutes)
                            }
                        }
                    }
                }

                Section("About background audio") {
                    // Honest rather than encouraging. Decision 004: this has
                    // never been verified on hardware, and a toggle that
                    // promises something unproven is worse than one that says
                    // what it is.
                    Text(
                        "Whether audio survives locking the screen depends on iOS and on the "
                            + "site. If a site pauses itself when you switch away, the "
                            + "\"Keep playing in background\" script is what fixes that — it is "
                            + "a separate thing from this toggle."
                    )
                    .font(.footnote)
                    .foregroundStyle(Color.secondary)
                }

                if let problem = model.storeProblem {
                    Section("Problem") {
                        Text(problem)
                            .font(.footnote)
                            .foregroundStyle(Color.orange)
                    }
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(isPresented: $showingScripts) {
                ScriptListView()
                    .environmentObject(model)
            }
        }
    }

    private func toggle(
        _ title: String,
        _ keyPath: WritableKeyPath<Settings, Bool>
    ) -> some View {
        Toggle(
            title,
            isOn: Binding(
                get: { model.state.settings[keyPath: keyPath] },
                set: { newValue in
                    var settings = model.state.settings
                    settings[keyPath: keyPath] = newValue
                    // One entry point, so the rebuild decision is made in
                    // exactly one place and cannot be forgotten per-toggle.
                    model.setSettings(settings)
                }
            )
        )
    }
}
