// swift-tools-version:6.0
//
// A typecheck harness for the browser shell. Not a shipping product — the
// shipping build is `project.yml` plus XcodeGen, and XcodeGen ignores this file
// sitting beside it.
//
// There is no Xcode, no simulator and no iOS SDK on this machine, but there is
// a Swift compiler. This package compiles `Sources/Browser` — the real files,
// unmodified, not a copy — against hand-written stubs of SwiftUI, UIKit and
// WebKit in `Harness/Sources/`.
//
// WHAT A GREEN BUILD PROVES: the Swift is syntactically valid, its types line
// up, every symbol it names is one it can reach, and it agrees with the API
// surface described in the stubs.
//
// WHAT IT DOES NOT PROVE: that the stubbed surface is Apple's. The stubs are
// this project's *belief* about UIKit and WebKit, written from memory. A wrong
// belief compiles perfectly here and fails on a Mac. So the stubs are exactly
// the list of things a human should check against Xcode's autocomplete — and
// loosening a stub to make code compile turns this from a check into a rubber
// stamp. See Harness/README.md.
//
// Every target is pinned to Swift 5 language mode, because that is what
// `project.yml` pins the Xcode targets to. Without the pin, tools-version 6.0
// would typecheck under Swift 6 strict concurrency — rules the real build never
// applies — and the harness would report errors that do not exist on a Mac.

import PackageDescription

let swift5: [SwiftSetting] = [.swiftLanguageMode(.v5)]

let package = Package(
    name: "OrielHarness",
    targets: [
        .target(
            name: "UIKit",
            path: "Harness/Sources/UIKit",
            swiftSettings: swift5
        ),
        .target(
            name: "Combine",
            path: "Harness/Sources/Combine",
            swiftSettings: swift5
        ),
        .target(
            name: "SwiftUI",
            dependencies: ["UIKit", "Combine"],
            path: "Harness/Sources/SwiftUI",
            swiftSettings: swift5
        ),
        .target(
            name: "WebKit",
            dependencies: ["UIKit"],
            path: "Harness/Sources/WebKit",
            swiftSettings: swift5
        ),
        .target(
            name: "Browser",
            dependencies: ["SwiftUI", "UIKit", "WebKit", "Combine"],
            path: "Sources/Browser",
            exclude: ["Info.plist"],
            swiftSettings: swift5
        )
    ]
)
