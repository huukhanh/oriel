import Core
import Foundation
import SwiftUI

/// The webview plus the toolbar. One webview, no tabs — §1's non-goal.
struct BrowserView: View {
    @EnvironmentObject private var model: AppModel

    @State private var showingScripts = false
    @State private var showingSettings = false
    @State private var showingLog = false
    @State private var showingLauncher = false
    @State private var addressText = ""
    @State private var editingAddress = false

    let initialURL: URL?

    var body: some View {
        VStack(spacing: 0) {
            if model.state.settings.showAddressBar {
                addressBar
            }
            // Keyed on the generation counter: when a configuration-affecting
            // setting changes, AppModel bumps it and SwiftUI discards this
            // webview and builds a new one. That is the only way those flags
            // can change, since the configuration was copied at creation.
            WebViewContainer(model: model, initialURL: initialURL)
                .id(model.webViewGeneration)
            toolbar
        }
        .sheet(isPresented: $showingScripts) {
            ScriptListView()
                .environmentObject(model)
        }
        .sheet(isPresented: $showingSettings) {
            SettingsView()
                .environmentObject(model)
        }
        .sheet(isPresented: $showingLog, onDismiss: { model.acknowledgeErrors() }) {
            LogView()
                .environmentObject(model)
        }
        .sheet(isPresented: $showingLauncher) {
            LauncherView(onOpen: { showingLauncher = false })
                .environmentObject(model)
        }
    }

    private var addressBar: some View {
        HStack(spacing: 8) {
            TextField("Address", text: $addressText)
                .accessibilityIdentifier("addressField")
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled(true)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
                .onSubmit {
                    submitAddress()
                }
            if model.isLoading {
                ProgressView()
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .onAppear {
            addressText = model.currentURL?.absoluteString ?? ""
        }
        .onChange(of: model.currentURL) { _, newValue in
            // Only follow the page while the user is not mid-edit, or typing
            // gets stomped by a redirect.
            if editingAddress == false {
                addressText = newValue?.absoluteString ?? ""
            }
        }
    }

    private var toolbar: some View {
        HStack {
            // Six items, evenly spread. Deliberately not six buttons separated
            // by five Spacers: that is eleven children, and a ViewBuilder takes
            // at most ten.
            Button(action: { model.goBack() }) {
                Image(systemName: "chevron.backward")
                    .frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("toolbar.back")
            .disabled(model.canGoBack == false)

            Button(action: { model.reload() }) {
                Image(systemName: "arrow.clockwise")
                    .frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("toolbar.reload")

            // PiP entry is this button and nothing else. §7.1: it needs real
            // user activation, and every automated path fails silently.
            Button(action: { model.enterPictureInPicture() }) {
                Image(systemName: "pip.enter")
                    .frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("toolbar.pip")

            // The system picker, not a custom control: only the system can
            // move an in-flight media session to another device. §4.3 lists
            // AirPlay in the toolbar.
            AirPlayButton()
                .frame(width: 34, height: 34)
                .accessibilityIdentifier("toolbar.airplay")

            Button(action: { showingScripts = true }) {
                // The count is the point: "3 scripts active here" is the fast
                // path to switching one off when a site breaks.
                Label(
                    "\(model.scriptsForCurrentPage.count)",
                    systemImage: "curlybraces"
                )
                .frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("toolbar.scripts")

            Button(action: { showingLog = true }) {
                // The count, not just the icon: a script that threw is
                // otherwise invisible unless you happen to open the log.
                Label(
                    model.errorCount > 0 ? "\(model.errorCount)" : "",
                    systemImage: model.errorCount > 0
                        ? "exclamationmark.triangle.fill" : "text.alignleft"
                )
                .foregroundStyle(model.errorCount > 0 ? Color.orange : Color.accentColor)
                .frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("toolbar.log")

            // Home, not a bookmarks grid. With the address bar hidden this is
            // the only way to reach a different site, so it is not optional
            // chrome — #34.
            Button(action: { showingLauncher = true }) {
                Image(systemName: "house")
                    .frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("toolbar.home")

            Button(action: { showingSettings = true }) {
                Image(systemName: "gearshape")
                    .frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("toolbar.settings")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private func submitAddress() {
        editingAddress = false
        // Parsing lives in Core, where the awkward cases — bare hosts, search
        // phrases, `javascript:` typed into the bar — are covered by a test
        // table rather than by hope.
        guard let url = URLNormalizer.url(from: addressText) else {
            return
        }
        model.load(url)
    }
}
