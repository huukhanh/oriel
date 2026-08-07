import Foundation
import SwiftUI
import UIKit

/// A `UITextView` wrapped for SwiftUI, purely to turn off the text assistance
/// that corrupts source code.
///
/// §6 of the brainstorm calls this out as critical, and it is the one item on
/// its list that `TextEditor` cannot express: `smartQuotesType` has no SwiftUI
/// equivalent. Left on, iOS silently rewrites `"` as `"` and `'` as `'`, which
/// are not valid JavaScript string delimiters. The corruption is invisible in
/// the editor — the characters look almost identical — and the only symptom is
/// that the script stops working, with a syntax error the user never sees
/// because it happens inside the page.
///
/// Smart dashes are the same hazard for `--` in a decrement, and smart
/// insert/delete adds spaces around pasted text.
struct CodeEditor: UIViewRepresentable {

    @Binding var text: String

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text)
    }

    func makeUIView(context: UIViewRepresentableContext<CodeEditor>) -> UITextView {
        let view = UITextView()
        CodeEditor.configureForSource(view)
        view.delegate = context.coordinator
        view.text = text
        view.inputAccessoryView = context.coordinator.makeAccessoryView(for: view)
        return view
    }

    func updateUIView(
        _ uiView: UITextView,
        context: UIViewRepresentableContext<CodeEditor>
    ) {
        // Only when it actually differs: assigning `text` unconditionally
        // resets the selection on every keystroke.
        if uiView.text != text {
            uiView.text = text
        }
    }

    /// Every property here exists to stop iOS "helping". Pulled out as a static
    /// so it can be asserted directly in a test — this is a settings list, and
    /// a settings list is exactly the sort of thing that silently loses an
    /// entry during a refactor.
    static func configureForSource(_ view: UITextView) {
        view.autocorrectionType = .no
        view.autocapitalizationType = .none
        view.spellCheckingType = .no
        view.smartQuotesType = .no
        view.smartDashesType = .no
        view.smartInsertDeleteType = .no
        view.font = UIFont.monospacedSystemFont(ofSize: 14, weight: .regular)
        view.textContainerInset = UIEdgeInsets(top: 12, left: 8, bottom: 12, right: 8)
    }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate {
        private let text: Binding<String>

        init(text: Binding<String>) {
            self.text = text
        }

        func textViewDidChange(_ textView: UITextView) {
            text.wrappedValue = textView.text
        }

        /// §6's keyboard accessory row: the punctuation an iOS keyboard buries
        /// two shifts deep, which is most of JavaScript's.
        ///
        /// Typing `{` on an iOS keyboard is two taps into a secondary plane.
        /// For an app whose entire purpose is writing JavaScript on a phone,
        /// that is the difference between usable and not.
        func makeAccessoryView(for textView: UITextView) -> UIView? {
            let buttons: [UIView] = EditorKeys.row.map { key in
                let button = UIButton(type: .system)
                button.setTitle(key, for: .normal)
                button.addAction(
                    UIAction { [weak textView] _ in
                        guard let textView else {
                            return
                        }
                        // insertText respects the current selection and the
                        // undo stack, which setting `.text` directly does not.
                        textView.insertText(key)
                        self.text.wrappedValue = textView.text
                    },
                    for: .touchUpInside
                )
                return button
            }

            let stack = UIStackView(arrangedSubviews: buttons)
            stack.axis = .horizontal
            stack.distribution = .fillEqually
            stack.spacing = 2
            stack.frame = CGRect(x: 0, y: 0, width: 0, height: 44)
            return stack
        }
    }
}

/// The characters the accessory row offers. Data rather than layout, so the
/// set is reviewable and testable without a screen.
enum EditorKeys {
    static let row: [String] = [
        "{", "}", "(", ")", "[", "]", ";", "=", ">", "'", "\"", "$", "_", "/", "|", "&",
    ]

    /// Everything here must be a single character — the accessory inserts
    /// literally, and a multi-character entry would silently insert a string.
    static var isWellFormed: Bool {
        return row.allSatisfy { $0.count == 1 }
    }
}
