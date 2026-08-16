import SwiftUI

/// One numbered instruction.
///
/// iOS gives an app no way to ask whether its own Safari extension is enabled,
/// and no way to enable it. So the container app cannot show progress, cannot
/// verify anything, and cannot deep-link into the right Settings pane. All it
/// can honestly do is tell the truth in the right order — which makes the
/// wording of these steps the entire feature.
struct StepRow: View {
    let number: Int
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Text("\(number)")
                .font(.footnote.weight(.semibold))
                .frame(width: 26, height: 26)
                .background(Color.accentColor.opacity(0.15))
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.body.weight(.semibold))
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
    }
}
