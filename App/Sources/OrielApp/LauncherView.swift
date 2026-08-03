import Core
import Foundation
import SwiftUI

/// §1's launcher: a bookmark grid, not a tab bar.
struct LauncherView: View {
    @EnvironmentObject private var model: AppModel

    @State private var newTitle = ""
    @State private var newURL = ""
    @State private var adding = false

    var body: some View {
        NavigationStack {
            List {
                Section("Bookmarks") {
                    ForEach(model.state.bookmarks.sorted(by: { $0.order < $1.order }), id: \.id) {
                        bookmark in
                        Button(bookmark.title) {
                            if let url = URLNormalizer.url(from: bookmark.url) {
                                model.load(url)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Oriel")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Add") { adding = true }
                }
            }
        }
        .sheet(isPresented: $adding) {
            addSheet
        }
    }

    private var addSheet: some View {
        NavigationStack {
            Form {
                TextField("Title", text: $newTitle)
                TextField("URL", text: $newURL)
                    .autocorrectionDisabled(true)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
            }
            .navigationTitle("New bookmark")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        model.addBookmark(title: newTitle, url: newURL)
                        newTitle = ""
                        newURL = ""
                        adding = false
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { adding = false }
                }
            }
        }
    }
}
