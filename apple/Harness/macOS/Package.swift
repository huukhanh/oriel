// swift-tools-version:6.0
//
// The macOS half of the typecheck harness. Read `apple/Package.swift` first —
// this is the same idea with one dependency swapped.
//
// `apple/Package.swift` compiles `Sources/Browser` against stubs of SwiftUI,
// WebKit, Combine and **UIKit**. That proves the iOS branch of every
// `#if canImport(UIKit)` in the browser shell. It proves nothing at all about
// the `#elseif canImport(AppKit)` branch, which would sit there unparsed until
// a Mac saw it — and an unexercised conditional branch is exactly what this
// harness exists to catch.
//
// So the same sources are compiled a second time here with the **AppKit** stub
// in UIKit's place. The mechanism is bluntly simple: `canImport(UIKit)` is true
// whenever the UIKit stub is reachable, so this package must not depend on it,
// directly or transitively. Nothing below does, and nothing below may.
//
// WHY A SECOND PACKAGE, rather than a second target in the first one: the
// browser's sources say `import SwiftUI` and `import WebKit`, so the stubs have
// to be modules with exactly those names, and one SwiftPM package cannot hold
// two targets called `SwiftUI`. A second package can. The stub sources are not
// copied — `Sources/` here is five symlinks to the one copy in
// `Harness/Sources/` and `Sources/Browser`, so there is nothing to keep in
// sync. The stub files branch on `canImport` internally and pick their own
// flavour from which of UIKit and AppKit this manifest hands them.
//
// Run both. Green in one and red in the other is the normal shape of a
// platform bug here:
//
//     swift build --package-path apple
//     swift build --package-path apple/Harness/macOS

import PackageDescription

let swift5: [SwiftSetting] = [.swiftLanguageMode(.v5)]

let package = Package(
    name: "OrielHarnessMacOS",
    targets: [
        .target(
            name: "AppKit",
            path: "Sources/AppKit",
            swiftSettings: swift5
        ),
        .target(
            name: "Combine",
            path: "Sources/Combine",
            swiftSettings: swift5
        ),
        .target(
            name: "SwiftUI",
            dependencies: ["AppKit", "Combine"],
            path: "Sources/SwiftUI",
            swiftSettings: swift5
        ),
        .target(
            name: "WebKit",
            dependencies: ["AppKit"],
            path: "Sources/WebKit",
            swiftSettings: swift5
        ),
        .target(
            name: "Browser",
            dependencies: ["SwiftUI", "AppKit", "WebKit", "Combine"],
            path: "Sources/Browser",
            // Not Swift, and not resources either: the two Info.plists and the
            // macOS entitlements belong to the Xcode targets in project.yml.
            exclude: ["Info.plist", "Info.macOS.plist", "Oriel.macOS.entitlements"],
            swiftSettings: swift5
        )
    ]
)
