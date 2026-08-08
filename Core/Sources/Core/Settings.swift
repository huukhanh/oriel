import Foundation

/// User-facing settings.
///
/// Split deliberately into two groups, because §4.2 of the brainstorm is the
/// sharpest edge in the whole app: `WKWebViewConfiguration` is **copied** when
/// the webview is created. Mutating it afterwards does nothing — no error, no
/// effect, no warning. A toggle wired to a config flag on a live webview is a
/// setting that silently does not work.
///
/// So the split is not cosmetic. `requiresWebViewRebuild(comparedTo:)` is the
/// single place that decides whether changing a setting means rebuilding the
/// webview, and it is here — in Foundation-only code — rather than inside a
/// view controller where it could only be guessed at.
public struct Settings: Hashable, Sendable, Codable {

    // MARK: - Configuration flags (changing these requires a webview rebuild)

    /// Without this, video is fullscreen-only.
    public var allowsInlineMediaPlayback: Bool
    public var allowsPictureInPicture: Bool
    /// `mediaTypesRequiringUserActionForPlayback = []` when true.
    public var allowsAutoplay: Bool
    /// Persistent by default — this is what keeps logins working.
    public var usesPersistentDataStore: Bool
    public var allowsJavaScript: Bool

    // MARK: - Live settings (safe to change on an existing webview)

    public var useDesktopUserAgent: Bool
    /// Off by default: the address bar makes this feel like a browser rather
    /// than an app, and it is mainly useful while debugging a script.
    public var showAddressBar: Bool
    /// Keeps the screen awake while media plays.
    public var disableIdleTimerDuringPlayback: Bool
    public var enableBackgroundAudio: Bool
    /// Minutes; 0 means off.
    public var sleepTimerMinutes: Int

    public init(
        allowsInlineMediaPlayback: Bool = true,
        allowsPictureInPicture: Bool = true,
        allowsAutoplay: Bool = true,
        usesPersistentDataStore: Bool = true,
        allowsJavaScript: Bool = true,
        useDesktopUserAgent: Bool = false,
        showAddressBar: Bool = false,
        disableIdleTimerDuringPlayback: Bool = true,
        enableBackgroundAudio: Bool = true,
        sleepTimerMinutes: Int = 0
    ) {
        self.allowsInlineMediaPlayback = allowsInlineMediaPlayback
        self.allowsPictureInPicture = allowsPictureInPicture
        self.allowsAutoplay = allowsAutoplay
        self.usesPersistentDataStore = usesPersistentDataStore
        self.allowsJavaScript = allowsJavaScript
        self.useDesktopUserAgent = useDesktopUserAgent
        self.showAddressBar = showAddressBar
        self.disableIdleTimerDuringPlayback = disableIdleTimerDuringPlayback
        self.enableBackgroundAudio = enableBackgroundAudio
        self.sleepTimerMinutes = sleepTimerMinutes
    }

    /// Whether moving from `other` to `self` means the webview must be rebuilt.
    ///
    /// Deliberately conservative: it compares only the config-derived flags, so
    /// flipping a live setting never throws away the user's page. Getting this
    /// backwards in either direction is a bug the user feels — either a setting
    /// that does nothing, or a page that reloads when they toggled something
    /// unrelated.
    public func requiresWebViewRebuild(comparedTo other: Settings) -> Bool {
        return allowsInlineMediaPlayback != other.allowsInlineMediaPlayback
            || allowsPictureInPicture != other.allowsPictureInPicture
            || allowsAutoplay != other.allowsAutoplay
            || usesPersistentDataStore != other.usesPersistentDataStore
            || allowsJavaScript != other.allowsJavaScript
    }

    /// The mobile/desktop switch, kept here so the app target has no string
    /// literals to get wrong. `nil` means "use WebKit's default".
    public var customUserAgent: String? {
        guard useDesktopUserAgent else {
            return nil
        }
        return
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
            + "(KHTML, like Gecko) Version/17.0 Safari/605.1.15"
    }

    /// Settings the UI must group under a "Reloads page" header, in order.
    /// Exposed as data so the settings screen cannot drift from the rebuild
    /// logic above.
    public static let configurationAffectingKeys: [String] = [
        "allowsInlineMediaPlayback",
        "allowsPictureInPicture",
        "allowsAutoplay",
        "usesPersistentDataStore",
        "allowsJavaScript",
    ]
}

/// Persisted state for a built-in script.
///
/// Per [002](../../../docs/decisions/002-builtin-script-storage.md) built-in
/// *source* lives in the app bundle and is never copied here — only whether the
/// user turned it on and where it sits in the list.
public struct BuiltinState: Hashable, Sendable, Codable {
    public var isEnabled: Bool
    public var order: Int

    public init(isEnabled: Bool, order: Int) {
        self.isEnabled = isEnabled
        self.order = order
    }
}
