import Core
import Foundation
import SwiftUI
import UIKit

/// The home screen: type a URL, or pick a recent one or a bookmark.
///
/// Reachable from the toolbar's house button from any page. With the address
/// bar hidden by default (#33) this is the only way to reach a different site,
/// so it is not optional chrome — #34.
struct LauncherView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    /// Called after a page is opened, so the sheet closes onto it.
    let onOpen: () -> Void

    @State private var typed: String = ""
    @State private var addingBookmark = false
    @State private var newTitle = ""

    var body: some View {
        NavigationStack {
            List {
                Section("Go to") {
                    HStack {
                        TextField("Address or search", text: $typed)
                            .accessibilityIdentifier("home.addressField")
                            .autocorrectionDisabled(true)
                            .textInputAutocapitalization(.never)
                            .keyboardType(.URL)
                            .onSubmit { open(typed) }
                        if typed.isEmpty == false {
                            Button("Go") { open(typed) }
                        }
                    }
                    Button("Paste and go") {
                        if let text = UIPasteboard.general.string, text.isEmpty == false {
                            open(text)
                        }
                    }
                }

                if model.state.recents.entries.isEmpty == false {
                    Section("Recent") {
                        ForEach(model.state.recents.entries) { entry in
                            Button(action: { open(entry.url) }) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(entry.title).lineLimit(1)
                                    Text(entry.url)
                                        .font(.caption)
                                        .foregroundStyle(Color.secondary)
                                        .lineLimit(1)
                                }
                            }
                            .buttonStyle(.plain)
                            .swipeActions {
                                Button("Remove", role: .destructive) {
                                    model.removeRecent(url: entry.url)
                                }
                            }
                        }
                    }
                }

                Section("Bookmarks") {
                    ForEach(model.state.bookmarks.sorted(by: { $0.order < $1.order }), id: \.id) {
                        bookmark in
                        Button(bookmark.title) { open(bookmark.url) }
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
                    Button("Bookmark this") {
                        newTitle = model.pageTitle
                        addingBookmark = true
                    }
                    .disabled(model.currentURL == nil)
                }
                ToolbarItem(placement: .cancellationAction) {
                    // Leaving without choosing keeps the current page — and
                    // whatever is playing on it. #34 asks for that to be
                    // defined: this sheet never stops playback, only loading a
                    // different page does.
                    Button("Close") { dismiss() }
                }
            }
            .alert("Bookmark this page", isPresented: $addingBookmark) {
                TextField("Title", text: $newTitle)
                Button("Save") {
                    if let url = model.currentURL {
                        model.addBookmark(
                            title: newTitle.isEmpty ? url.absoluteString : newTitle,
                            url: url.absoluteString
                        )
                    }
                }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    private func open(_ text: String) {
        guard let url = URLNormalizer.url(from: text) else {
            return
        }
        model.load(url)
        typed = ""
        onOpen()
    }
}
