import Core
import Foundation
import SwiftUI

/// §6's editor. The on-device authoring loop lives or dies here.
struct ScriptEditorView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    let scriptID: String?

    @State private var source: String = ScriptEditorView.template
    @State private var loaded = false

    /// Parsed on every keystroke. It is cheap, and the alternative — telling
    /// the user their `@match` was wrong only after they save and reload — is
    /// the slowest possible feedback loop on a phone.
    private var metadata: UserScriptMetadata {
        UserScriptMetadata.parse(source)
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 0) {
                warnings
                TextEditor(text: $source)
                    .font(.system(.body, design: .monospaced))
                    // All four matter. Smart quotes are the dangerous one:
                    // they replace " with a curly quote that is not valid
                    // JavaScript, and the corruption is invisible in the
                    // editor — the script simply stops working.
                    .autocorrectionDisabled(true)
                    .textInputAutocapitalization(.never)
            }
            .navigationTitle(metadata.name ?? "New script")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Save") {
                        _ = model.upsertUserScript(id: scriptID, source: source)
                        dismiss()
                    }
                }
                ToolbarItem(placement: .bottomBar) {
                    // §6 calls this the feature that makes on-device authoring
                    // bearable, and it is: the alternative is a save and a full
                    // reload per edit. It runs the *wrapped* form, so what
                    // happens here is what happens after a reload — including
                    // the match guard, so a script that does not match the
                    // current page correctly does nothing.
                    Button("Run on this page now") {
                        model.runOnCurrentPage(
                            source: source,
                            id: scriptID ?? "preview"
                        )
                    }
                    .disabled(metadata.matches.isEmpty)
                }
            }
        }
        .onAppear {
            guard loaded == false else {
                return
            }
            loaded = true
            if let id = scriptID,
                let existing = model.scripts.first(where: { $0.id == id })
            {
                source = existing.source
            }
        }
    }

    @ViewBuilder
    private var warnings: some View {
        if metadata.warnings.isEmpty == false {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(metadata.warnings, id: \.self) { warning in
                    Text("line \(warning.line): @\(warning.key) — \(warning.message)")
                        .font(.caption)
                        .foregroundStyle(Color.orange)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
    }

    /// A new script starts from something that already runs. An empty editor
    /// on a phone means typing a metadata block from memory.
    static let template = """
        // ==UserScript==
        // @name        New script
        // @match       *://*.example.com/*
        // @run-at      document-start
        // @world       page
        // ==/UserScript==

        GM_log("hello from my script");
        """
}

/// The keyboard accessory row from §6's ladder — the characters an iOS keyboard
/// buries two shifts deep, which is most of JavaScript's punctuation.
enum EditorAccessory {
    static let characters: [String] = [
        "{", "}", "(", ")", "[", "]", ";", "=", ">", "'", "\"", "$", "_", "/",
    ]
}
