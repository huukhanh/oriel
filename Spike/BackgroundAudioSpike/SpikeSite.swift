import Foundation

/// The three media stacks issue #1 asks about. Kept as a small enum so the
/// three cases can be switched on device without three rebuild-and-re-sign
/// cycles — free Apple accounts cap App IDs at 10 per 7 days
/// (docs/decisions/001-distribution.md), so rebuilds are not free here.
enum SpikeSite: String, CaseIterable, Identifiable {
    /// Plain `<audio>` element, locally generated tone, no network, no MSE.
    /// The control: if background audio fails *here*, it fails everywhere and
    /// the cause is not the site.
    case control
    /// Real MSE player that also self-pauses on `visibilitychange`, so a
    /// failure here may be the page rather than the media process.
    case youtube
    /// Anything else worth trying without a rebuild.
    case custom

    var id: String { rawValue }

    var label: String {
        switch self {
        case .control: return "Control"
        case .youtube: return "YouTube"
        case .custom: return "Custom"
        }
    }

    /// `nil` for `.custom` — the caller supplies it from the text field.
    func url() -> URL? {
        switch self {
        case .control:
            return Bundle.main.url(forResource: "control", withExtension: "html")
        case .youtube:
            return URL(string: "https://m.youtube.com/")
        case .custom:
            return nil
        }
    }
}
