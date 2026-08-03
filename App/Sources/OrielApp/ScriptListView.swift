import Core
import Foundation
import SwiftUI

/// Built-ins and user scripts as one list, per decision 002 — two sources, one
/// ordering, one UI.
struct ScriptListView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var creatingNew = false
    @State private var editingScriptID: String?

    var body: some View {
        NavigationStack {
            List {
                Section("On this page") {
                    ForEach(model.scriptsForCurrentPage, id: \.id) { script in
                        row(for: script)
                    }
                }
                Section("All scripts") {
                    ForEach(model.scripts, id: \.id) { script in
                        row(for: script)
                    }
                }
            }
            .navigationTitle("Scripts")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("New") {
                        creatingNew = true
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .sheet(isPresented: $creatingNew) {
            ScriptEditorView(scriptID: nil)
                .environmentObject(model)
        }
        .sheet(isPresented: editingBinding) {
            ScriptEditorView(scriptID: editingScriptID)
                .environmentObject(model)
        }
    }

    private var editingBinding: Binding<Bool> {
        Binding(
            get: { editingScriptID != nil },
            set: { presented in
                if presented == false {
                    editingScriptID = nil
                }
            }
        )
    }

    private func row(for script: Script) -> some View {
        HStack {
            Button(action: { open(script) }) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(script.name)
                    Text(ScriptListView.matchSummary(for: script))
                        .font(.caption)
                        .foregroundStyle(Color.secondary)
                    if script.metadata.warnings.isEmpty == false {
                        Text("\(script.metadata.warnings.count) warnings")
                            .font(.caption)
                            .foregroundStyle(Color.orange)
                    }
                }
            }
            .buttonStyle(.plain)

            Spacer()

            if script.origin == .builtIn {
                Text("built-in")
                    .font(.caption)
                    .foregroundStyle(Color.secondary)
            }

            Toggle(
                "",
                isOn: Binding(
                    get: { script.isEnabled },
                    set: { model.setEnabled($0, forScriptID: script.id) }
                )
            )
        }
        .swipeActions {
            if script.origin == .user {
                Button("Delete", role: .destructive) {
                    model.deleteUserScript(id: script.id)
                }
            }
        }
    }

    /// Tapping a built-in opens a *copy*, per decision 002 — bundle source is
    /// read-only, and silently doing nothing on tap would be worse than either
    /// editing it or refusing.
    private func open(_ script: Script) {
        if script.origin == .builtIn {
            editingScriptID = model.duplicateForEditing(id: script.id)
        } else {
            editingScriptID = script.id
        }
    }

    /// A script that matches nothing is the most confusing state in this list —
    /// it looks enabled and does nothing — so it says so outright rather than
    /// showing an empty match column.
    static func matchSummary(for script: Script) -> String {
        let patterns = script.metadata.matches
        if patterns.isEmpty {
            return "matches nothing — will never run"
        }
        if patterns.count == 1 {
            return patterns[0].source
        }
        return "\(patterns[0].source) +\(patterns.count - 1) more"
    }
}
