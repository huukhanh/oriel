import Core
import Foundation
import SwiftUI

/// §1's launcher: a bookmark grid, not a tab bar.
struct LauncherView: View {
    @EnvironmentObject private var model: AppModel

    /// Called after a bookmark is opened, so the sheet closes and the user is
    /// looking at the page they just asked for.
    let onOpen: () -> Void

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
                                onOpen()
                            }
                        }
                        .swipeActions {
                            Button("Delete", role: .destructive) {
                                model.deleteBookmark(id: bookmark.id)
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
                ToolbarItem(placement: .cancellationAction) {
                    Button("Add current page") {
                        if let url = model.currentURL {
                            model.addBookmark(
                                title: model.pageTitle.isEmpty
                                    ? url.absoluteString : model.pageTitle,
                                url: url.absoluteString
                            )
                        }
                    }
                    .disabled(model.currentURL == nil)
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
