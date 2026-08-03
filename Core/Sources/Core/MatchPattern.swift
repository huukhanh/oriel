import Foundation

/// Why a `@match` pattern could not be understood.
///
/// Every case here is a *rejection*. A pattern that cannot be parsed must never
/// degrade into one that matches everything — failing open would silently widen
/// a script's reach from one site to all of them.
public enum MatchPatternError: Error, Equatable, Sendable {
    case empty
    case missingSchemeSeparator(String)
    case unsupportedScheme(String)
    case invalidHost(String)
    case missingPath(String)
}

/// A Chrome/Tampermonkey `@match` pattern, parsed into its three parts.
///
/// Matching is **structural**, not regex-based: the pattern is split into
/// scheme, host and path once, and each part is compared with rules written for
/// that part. That is a deliberate choice. Compiling globs to a regex means
/// hand-escaping every metacharacter and hand-anchoring every pattern, and the
/// two classic bugs there — an unescaped `.` and a missing `^…$` — both fail
/// *open*, turning "runs on example.com" into "runs on exampleXcom" and "runs
/// on any URL containing this text". Those cases are in the shared fixture and
/// they pass here by construction rather than by vigilance.
///
/// Deliberately narrower than Chrome in one respect: only `http` and `https`
/// are supported. This is a web browser for web pages, and refusing `file:`,
/// `ftp:` and `javascript:` outright is the safer default.
public struct MatchPattern: Hashable, Sendable, Codable {
    /// Which schemes a pattern accepts.
    public enum Scheme: String, Hashable, Sendable, Codable {
        /// `*` — http and https only, never file/ftp/javascript.
        case any
        case http
        case https

        func accepts(_ scheme: String) -> Bool {
            switch self {
            case .any: return scheme == "http" || scheme == "https"
            case .http: return scheme == "http"
            case .https: return scheme == "https"
            }
        }
    }

    /// Which hosts a pattern accepts.
    public enum Host: Hashable, Sendable, Codable {
        /// `*` — any host at all.
        case any
        /// `*.example.com` — that domain **or** any subdomain of it.
        case domainOrSubdomain(String)
        /// `example.com` — exactly that host.
        case exact(String)

        func accepts(_ host: String) -> Bool {
            switch self {
            case .any:
                return true
            case .exact(let expected):
                return host == expected
            case .domainOrSubdomain(let domain):
                // The dot is the whole point. A plain `hasSuffix(domain)`
                // accepts evil-example.com, and that is the single most
                // consequential bug this type can have.
                return host == domain || host.hasSuffix("." + domain)
            }
        }
    }

    /// The original `@match` text, kept for display and round-tripping.
    public let source: String
    public let scheme: Scheme
    public let host: Host
    /// Path glob. `*` is the only metacharacter and it may span `/`.
    public let path: String

    private static let allURLs: String = "<all_urls>"

    public init(_ pattern: String) throws {
        let trimmed = pattern.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else {
            throw MatchPatternError.empty
        }

        self.source = trimmed

        if trimmed == MatchPattern.allURLs {
            self.scheme = .any
            self.host = .any
            self.path = "*"
            return
        }

        guard let separator = trimmed.range(of: "://") else {
            throw MatchPatternError.missingSchemeSeparator(trimmed)
        }

        let schemeText = String(trimmed[trimmed.startIndex..<separator.lowerBound]).lowercased()
        switch schemeText {
        case "*": self.scheme = .any
        case "http": self.scheme = .http
        case "https": self.scheme = .https
        default: throw MatchPatternError.unsupportedScheme(schemeText)
        }

        let remainder = String(trimmed[separator.upperBound...])
        guard let slash = remainder.firstIndex(of: "/") else {
            // Chrome requires a path. Defaulting a missing one to `/*` would
            // quietly widen `*://example.com` into every page on the site.
            throw MatchPatternError.missingPath(trimmed)
        }

        let hostText = String(remainder[remainder.startIndex..<slash]).lowercased()
        self.host = try MatchPattern.parseHost(hostText, in: trimmed)
        self.path = String(remainder[slash...])
    }

    private static func parseHost(_ text: String, in pattern: String) throws -> Host {
        if text == "*" {
            return .any
        }
        if text.isEmpty {
            throw MatchPatternError.invalidHost(pattern)
        }
        if text.hasPrefix("*.") {
            let domain = String(text.dropFirst(2))
            // `*.` must be followed by a real domain, and that domain may not
            // itself contain a wildcard.
            if domain.isEmpty || domain.contains("*") {
                throw MatchPatternError.invalidHost(pattern)
            }
            return .domainOrSubdomain(domain)
        }
        // A `*` anywhere else — `*example.com`, `ex*ample.com` — is exactly the
        // shape that looks like a subdomain wildcard and is not one.
        if text.contains("*") {
            throw MatchPatternError.invalidHost(pattern)
        }
        return .exact(text)
    }

    /// Whether this pattern matches `urlString`.
    ///
    /// A URL that cannot be parsed does not match. There is no useful fallback,
    /// and guessing would mean running a script against something we could not
    /// even identify.
    public func matches(_ urlString: String) -> Bool {
        guard let components = URLComponents(string: urlString) else {
            return false
        }
        guard let rawScheme = components.scheme?.lowercased() else {
            return false
        }
        guard scheme.accepts(rawScheme) else {
            return false
        }
        guard let rawHost = components.percentEncodedHost?.lowercased(), rawHost.isEmpty == false
        else {
            return false
        }
        guard host.accepts(rawHost) else {
            return false
        }
        return MatchPattern.glob(pattern: path, matches: MatchPattern.matchablePath(of: components))
    }

    /// The part of a URL the path glob is tested against: path plus query,
    /// never the fragment.
    ///
    /// The port is excluded, matching Chrome. The fragment is excluded because
    /// it is client-side only — including it would let
    /// `https://evil.com/#https://youtube.com/watch` satisfy a YouTube pattern.
    static func matchablePath(of components: URLComponents) -> String {
        var result = components.percentEncodedPath
        if result.isEmpty {
            result = "/"
        }
        if let query = components.percentEncodedQuery {
            result += "?" + query
        }
        return result
    }

    /// Glob match where `*` is the only metacharacter and may span `/`.
    ///
    /// Linear with backtracking only on `*`, so a pathological pattern cannot
    /// turn into the exponential blowup a naive recursive version allows.
    static func glob(pattern: String, matches text: String) -> Bool {
        let patternCharacters = Array(pattern)
        let textCharacters = Array(text)

        var patternIndex = 0
        var textIndex = 0
        var lastStarIndex = -1
        var resumeTextIndex = 0

        while textIndex < textCharacters.count {
            if patternIndex < patternCharacters.count,
                patternCharacters[patternIndex] == textCharacters[textIndex]
            {
                patternIndex += 1
                textIndex += 1
            } else if patternIndex < patternCharacters.count,
                patternCharacters[patternIndex] == "*"
            {
                lastStarIndex = patternIndex
                resumeTextIndex = textIndex
                patternIndex += 1
            } else if lastStarIndex >= 0 {
                patternIndex = lastStarIndex + 1
                resumeTextIndex += 1
                textIndex = resumeTextIndex
            } else {
                return false
            }
        }

        while patternIndex < patternCharacters.count, patternCharacters[patternIndex] == "*" {
            patternIndex += 1
        }
        return patternIndex == patternCharacters.count
    }
}

extension MatchPattern: CustomStringConvertible {
    public var description: String { source }
}
