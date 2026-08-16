import SwiftUI

/// The whole app.
///
/// Oriel on iOS is a Safari extension; this app is the container iOS requires
/// in order to install one. Opening it after setup is not part of using the
/// product, so it does not try to be a second home for the skin manager — that
/// lives in the extension, reachable from Safari, where the pages are.
struct SetupView: View {
    private let managerURL = URL(string: "https://github.com/huukhanh/oriel/blob/main/docs/SAFARI.md")
    private let formatURL = URL(string: "https://github.com/huukhanh/oriel/blob/main/docs/SKIN-FORMAT.md")

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                header
                steps
                afterwards
                links
            }
            .padding(24)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Oriel")
                .font(.largeTitle.weight(.bold))
            Text("Rebuild any website's interface, and install other people's from a link.")
                .font(.title3)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var steps: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Turn it on")
                .font(.headline)

            StepRow(
                number: 1,
                title: "Open Settings → Apps → Safari",
                detail: "Then Extensions. On older versions of iOS this is Settings → Safari → Extensions."
            )
            StepRow(
                number: 2,
                title: "Turn on Oriel",
                detail: "It will be listed under the extensions you have installed."
            )
            StepRow(
                number: 3,
                title: "Give it access to the sites you want to change",
                detail:
                    "Choose Allow for the sites you plan to skin, or All Websites. "
                    + "Oriel cannot change a page it has not been given access to, and it "
                    + "never sends anything anywhere — everything it does happens on this device."
            )
        }
    }

    private var afterwards: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Then, in Safari")
                .font(.headline)

            StepRow(
                number: 4,
                title: "Tap the page menu, then Oriel",
                detail: "The icon at the left of the address bar. That is where skins are added and turned on and off."
            )
            StepRow(
                number: 5,
                title: "Paste a skin, or a link to one",
                detail:
                    "A skin is a single file. Paste its source, or paste the GitHub URL "
                    + "and Oriel will fetch it."
            )
        }
    }

    private var links: some View {
        VStack(alignment: .leading, spacing: 12) {
            Divider()
            if let managerURL {
                Link("Setup help and troubleshooting", destination: managerURL)
            }
            if let formatURL {
                Link("Write your own skin", destination: formatURL)
            }
            Text("Version \(Self.version)")
                .font(.footnote)
                .foregroundStyle(.tertiary)
        }
    }

    private static var version: String {
        let dictionary = Bundle.main.infoDictionary
        let short = dictionary?["CFBundleShortVersionString"] as? String ?? "0"
        let build = dictionary?["CFBundleVersion"] as? String ?? "0"
        return "\(short) (\(build))"
    }
}
