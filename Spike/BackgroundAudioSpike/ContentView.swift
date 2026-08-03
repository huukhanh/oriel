import SwiftUI
import UIKit

struct ContentView: View {
    @EnvironmentObject private var log: ProbeLog
    @Environment(\.scenePhase) private var scenePhase

    @State private var site: SpikeSite = .control
    @State private var customText: String = "https://"
    @State private var showTranscript: Bool = false
    @State private var tick: Date = Date()

    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var currentURL: URL? {
        if site == .custom {
            return URL(string: customText)
        }
        return site.url()
    }

    var body: some View {
        VStack(spacing: 0) {
            picker
            webArea
            statusBar
        }
        .onReceive(timer) { value in
            tick = value
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                log.noteEnteredBackground()
            case .active:
                log.noteEnteredForeground()
            case .inactive:
                log.record("APP", "inactive (lock screen or app switcher)")
            @unknown default:
                break
            }
        }
        .sheet(isPresented: $showTranscript) {
            TranscriptView(text: log.transcript)
        }
    }

    private var picker: some View {
        VStack(spacing: 6) {
            Picker("Site", selection: $site) {
                ForEach(SpikeSite.allCases) { value in
                    Text(value.label).tag(value)
                }
            }
            .pickerStyle(.segmented)

            if site == .custom {
                TextField("https://", text: $customText)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled(true)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private var webArea: some View {
        if let url = currentURL {
            SpikeWebView(url: url, log: log)
        } else {
            Color.black.overlay(
                Text("Enter a URL").foregroundStyle(.secondary)
            )
        }
    }

    private var statusBar: some View {
        VStack(alignment: .leading, spacing: 4) {
            // The two numbers that answer the issue. Elapsed keeps counting in
            // Swift regardless of what WebKit does; heartbeats stop when the
            // media process is suspended. Divergence between them is the
            // finding.
            HStack {
                Text(String(format: "elapsed %.0fs", tick.timeIntervalSince(log.startedAt)))
                    .monospacedDigit()
                Spacer()
                Text("beats \(log.heartbeatCount)")
                    .monospacedDigit()
                Spacer()
                Text(log.isPlaying ? "PLAYING" : "silent")
                    .foregroundStyle(log.isPlaying ? Color.green : Color.secondary)
                    .bold()
            }

            HStack {
                Text(String(format: "media t=%.1f", log.lastMediaTime))
                    .monospacedDigit()
                Spacer()
                Text(String(format: "worst gap %.1fs", log.largestGap))
                    .monospacedDigit()
                    .foregroundStyle(log.largestGap > 3 ? Color.red : Color.secondary)
                Spacer()
                Text(lastBeatDescription)
                    .monospacedDigit()
            }

            HStack {
                Button("Copy transcript") {
                    UIPasteboard.general.string = log.transcript
                }
                Spacer()
                Button("View") {
                    showTranscript = true
                }
                Spacer()
                Button("Reset") {
                    log.reset()
                }
            }
            .buttonStyle(.bordered)
            .padding(.top, 2)
        }
        .font(.footnote)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.thinMaterial)
    }

    private var lastBeatDescription: String {
        guard let last = log.lastHeartbeatAt else {
            return "no beats"
        }
        return String(format: "last %.0fs ago", tick.timeIntervalSince(last))
    }
}

struct TranscriptView: View {
    let text: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(text)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }
            .navigationTitle("Transcript")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
