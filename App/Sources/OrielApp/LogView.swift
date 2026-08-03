import Core
import Foundation
import SwiftUI
import UIKit

/// §5.5's log. Without it, on-device script authoring is guesswork — the real
/// console only exists when tethered to a Mac with Web Inspector attached.
struct LogView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var filter: String = ""

    private var entries: [LogEntry] {
        guard filter.isEmpty == false else {
            return model.log
        }
        return model.log.filter {
            $0.scriptID.localizedCaseInsensitiveContains(filter)
                || $0.message.localizedCaseInsensitiveContains(filter)
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TextField("Filter", text: $filter)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled(true)
                    .textInputAutocapitalization(.never)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)

                if entries.isEmpty {
                    Spacer()
                    Text(model.log.isEmpty ? "No output yet" : "Nothing matches")
                        .foregroundStyle(Color.secondary)
                    Spacer()
                } else {
                    List {
                        ForEach(entries, id: \.id) { entry in
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(entry.scriptID) · \(entry.level)")
                                    .font(.caption)
                                    .foregroundStyle(
                                        entry.level == "error" ? Color.red : Color.secondary
                                    )
                                Text(entry.message)
                                    .font(.system(.caption, design: .monospaced))
                                    .textSelection(.enabled)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Log")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Copy") {
                        UIPasteboard.general.string = LogView.transcript(of: entries)
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Clear") { model.clearLog() }
                }
            }
        }
    }

    static func transcript(of entries: [LogEntry]) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return
            entries
            .map { "\(formatter.string(from: $0.at))  \($0.scriptID)  \($0.level)  \($0.message)" }
            .joined(separator: "\n")
    }
}
