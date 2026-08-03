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
            addressBar
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
        .sheet(isPresented: $showingLog) {
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
            .disabled(model.canGoBack == false)

            Button(action: { model.reload() }) {
                Image(systemName: "arrow.clockwise")
                    .frame(maxWidth: .infinity)
            }

            // PiP entry is this button and nothing else. §7.1: it needs real
            // user activation, and every automated path fails silently.
            Button(action: { model.enterPictureInPicture() }) {
                Image(systemName: "pip.enter")
                    .frame(maxWidth: .infinity)
            }

            Button(action: { showingScripts = true }) {
                // The count is the point: "3 scripts active here" is the fast
                // path to switching one off when a site breaks.
                Label(
                    "\(model.scriptsForCurrentPage.count)",
                    systemImage: "curlybraces"
                )
                .frame(maxWidth: .infinity)
            }

            Button(action: { showingLog = true }) {
                Image(systemName: "text.alignleft")
                    .frame(maxWidth: .infinity)
            }

            Button(action: { showingLauncher = true }) {
                Image(systemName: "square.grid.2x2")
                    .frame(maxWidth: .infinity)
            }

            Button(action: { showingSettings = true }) {
                Image(systemName: "gearshape")
                    .frame(maxWidth: .infinity)
            }
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
