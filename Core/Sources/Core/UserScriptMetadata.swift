import Foundation

/// When a script's body runs, relative to document parsing.
public enum RunAt: String, Hashable, Sendable, Codable, CaseIterable {
    case documentStart = "document-start"
    case documentEnd = "document-end"
    case documentIdle = "document-idle"
}

/// Which JavaScript world a script runs in.
public enum ScriptWorld: String, Hashable, Sendable, Codable, CaseIterable {
    /// Sees the page's own globals. Required for anything touching site
    /// internals — `document.visibilityState`, `history`, player APIs.
    case page
    /// Shares the DOM only. Safer for untrusted pasted scripts, useless for
    /// the media behaviours.
    case isolated
}

/// Something the user should know about a script's header, surfaced in the
/// editor rather than printed or thrown.
///
/// These are data, not diagnostics: the editor renders them next to the source,
/// so a pasted script that half-works explains itself instead of failing
/// mysteriously.
public struct MetadataWarning: Hashable, Sendable, Codable {
    public let key: String
    public let message: String
    /// 1-based, within the whole source.
    public let line: Int

    public init(key: String, message: String, line: Int) {
        self.key = key
        self.message = message
        self.line = line
    }
}

/// A parsed `// ==UserScript== … // ==/UserScript==` header.
///
/// Parsing never throws. A userscript pasted from the internet is the normal
/// input here, and refusing to open one because its header has a typo would be
/// worse than opening it with a warning attached — the user cannot fix what the
/// editor will not show them.
///
/// Everything unrecognised **fails closed**: a script whose `@match` lines are
/// all malformed matches nothing at all, rather than everything.
public struct UserScriptMetadata: Hashable, Sendable, Codable {
    public var name: String?
    public var description: String?
    public var version: String?
    public var namespace: String?
    public var matches: [MatchPattern]
    public var runAt: RunAt
    public var world: ScriptWorld
    public var noFrames: Bool
    public var warnings: [MetadataWarning]
    /// False when no header was found at all.
    public var hasMetadataBlock: Bool

    public init(
        name: String? = nil,
        description: String? = nil,
        version: String? = nil,
        namespace: String? = nil,
        matches: [MatchPattern] = [],
        runAt: RunAt = .documentStart,
        world: ScriptWorld = .page,
        noFrames: Bool = false,
        warnings: [MetadataWarning] = [],
        hasMetadataBlock: Bool = false
    ) {
        self.name = name
        self.description = description
        self.version = version
        self.namespace = namespace
        self.matches = matches
        self.runAt = runAt
        self.world = world
        self.noFrames = noFrames
        self.warnings = warnings
        self.hasMetadataBlock = hasMetadataBlock
    }

    private static let openMarker: String = "==UserScript=="
    private static let closeMarker: String = "==/UserScript=="

    /// Tampermonkey keys we recognise well enough to explain, but do not
    /// implement. Naming them specifically is the point: "`@require` is not
    /// supported" is actionable, "unknown key" is not.
    private static let knownUnsupported: [String: String] = [
        "require": "not supported — external scripts are not fetched. Paste the dependency inline.",
        "grant":
            "ignored — this app always provides the same GM subset. See docs/userscript-api.md.",
        "resource": "not supported — bundled resources are not fetched.",
        "include":
            "not supported — use @match. @include allows patterns this app deliberately cannot express safely.",
        "exclude": "not supported — there is no exclusion pass; narrow your @match instead.",
        "icon": "ignored — scripts have no icons in this app.",
        "updateURL": "ignored — scripts are never auto-updated. Re-import to update.",
        "downloadURL": "ignored — scripts are never auto-updated.",
        "connect": "ignored — GM_xmlhttpRequest is not implemented.",
        "antifeature": "ignored.",
        "author": "ignored — not displayed.",
        "license": "ignored — not displayed.",
        "homepage": "ignored — not displayed.",
        "supportURL": "ignored — not displayed.",
    ]

    /// Parse a userscript's header.
    ///
    /// `source` is the whole file, header included; the header is left in place
    /// so the editor round-trips exactly what the user pasted.
    public static func parse(_ source: String) -> UserScriptMetadata {
        var result = UserScriptMetadata()

        // Split on newlines, tolerating CRLF — pasted scripts come from
        // anywhere, and a stray \r on every value is invisible and ruins
        // pattern parsing.
        let lines = source.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: "\n")

        guard let openIndex = lines.firstIndex(where: { isMarker($0, openMarker) }) else {
            result.warnings.append(
                MetadataWarning(
                    key: "",
                    message:
                        "no ==UserScript== block found — this script has no @match and will not run "
                        + "on any page until you add one.",
                    line: 1
                )
            )
            return result
        }

        guard
            let closeIndex = lines[lines.index(after: openIndex)...].firstIndex(where: {
                isMarker($0, closeMarker)
            })
        else {
            result.warnings.append(
                MetadataWarning(
                    key: "",
                    message: "==UserScript== block is never closed with ==/UserScript==.",
                    line: openIndex + 1
                )
            )
            return result
        }

        result.hasMetadataBlock = true

        var sawRunAt = false
        var sawWorld = false

        for index in lines.index(after: openIndex)..<closeIndex {
            let lineNumber = index + 1
            guard let (key, value) = parseEntry(lines[index]) else {
                continue
            }

            switch key {
            case "name":
                result.name = value
            case "description":
                result.description = value
            case "version":
                result.version = value
            case "namespace":
                result.namespace = value

            case "match":
                do {
                    result.matches.append(try MatchPattern(value))
                } catch {
                    // Skipped, not defaulted. A malformed @match must never
                    // widen into "runs everywhere".
                    result.warnings.append(
                        MetadataWarning(
                            key: key,
                            message: "`\(value)` is not a valid @match and was ignored.",
                            line: lineNumber
                        )
                    )
                }

            case "run-at":
                sawRunAt = true
                if let parsed = RunAt(rawValue: value) {
                    result.runAt = parsed
                } else {
                    result.warnings.append(
                        MetadataWarning(
                            key: key,
                            message:
                                "`\(value)` is not a known @run-at; using document-start.",
                            line: lineNumber
                        )
                    )
                }

            case "world":
                sawWorld = true
                if let parsed = ScriptWorld(rawValue: value.lowercased()) {
                    result.world = parsed
                } else {
                    result.warnings.append(
                        MetadataWarning(
                            key: key,
                            message: "`\(value)` is not a known @world; using page.",
                            line: lineNumber
                        )
                    )
                }

            case "noframes":
                result.noFrames = true

            default:
                let message =
                    knownUnsupported[key]
                    ?? "unrecognised key, ignored."
                result.warnings.append(
                    MetadataWarning(key: key, message: message, line: lineNumber)
                )
            }
        }

        if result.matches.isEmpty {
            result.warnings.append(
                MetadataWarning(
                    key: "match",
                    message: "no usable @match — this script will not run on any page.",
                    line: openIndex + 1
                )
            )
        }

        // Silence is only safe when it was chosen. The defaults are the ones
        // the media scripts need (§5.3), so say so when they were assumed.
        if sawRunAt == false {
            result.warnings.append(
                MetadataWarning(
                    key: "run-at",
                    message: "not specified; using document-start.",
                    line: openIndex + 1
                )
            )
        }
        if sawWorld == false {
            result.warnings.append(
                MetadataWarning(
                    key: "world",
                    message: "not specified; using page, which sees the site's own globals.",
                    line: openIndex + 1
                )
            )
        }

        return result
    }

    /// A marker line is `// ==UserScript==`, allowing leading whitespace and
    /// any spacing after the slashes.
    private static func isMarker(_ line: String, _ marker: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("//") else {
            return false
        }
        return trimmed.dropFirst(2).trimmingCharacters(in: .whitespaces) == marker
    }

    /// `// @key value` → `("key", "value")`. Returns nil for blank or non-entry
    /// lines, which are legal inside a header and simply carry nothing.
    private static func parseEntry(_ line: String) -> (String, String)? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("//") else {
            return nil
        }
        let afterSlashes = trimmed.dropFirst(2).trimmingCharacters(in: .whitespaces)
        guard afterSlashes.hasPrefix("@") else {
            return nil
        }

        let body = afterSlashes.dropFirst()
        guard let split = body.firstIndex(where: { $0 == " " || $0 == "\t" }) else {
            // A valueless key such as @noframes.
            let key = String(body).trimmingCharacters(in: .whitespaces)
            return key.isEmpty ? nil : (key, "")
        }

        let key = String(body[body.startIndex..<split])
        let value = String(body[split...]).trimmingCharacters(in: .whitespaces)
        return (key, value)
    }
}
