// swift-tools-version: 6.0
import PackageDescription

// A TYPECHECK HARNESS, not a build product. Xcode never opens this file — the
// real app is generated from App/project.yml and compiles against Apple's SDK.
//
// Its whole purpose is that the dev box has no Xcode. Without it, every line of
// SwiftUI/WebKit/AVFoundation in this app is unverified text that nobody can
// even parse-check. With it, `swift build` on Linux compiles the real app
// sources against stub modules named `SwiftUI`, `UIKit`, `WebKit` and
// `AVFoundation`, and catches the whole class of errors that has nothing to do
// with Apple: typos, wrong types, missing arguments, unbalanced braces, bad
// property-wrapper usage, wrong `Sendable`/actor annotations.
//
// WHAT IT CANNOT CATCH, and this is the important half: a stub encodes what I
// *believe* an Apple API looks like. If a signature here is wrong, the app
// compiles on Linux and fails on a Mac. So the stubs are the project's list of
// API assumptions made executable — see docs/api-notes.md. A green build here
// means "internally consistent", never "will compile in Xcode".
let package = Package(
    name: "OrielAppCheck",
    products: [
        .library(name: "OrielApp", targets: ["OrielApp"])
    ],
    dependencies: [
        .package(path: "../Core")
    ],
    targets: [
        // Stub frameworks. Named exactly as the real ones so `import SwiftUI`
        // in the app sources resolves here on Linux and to the SDK on Apple.
        .target(name: "SwiftUI", dependencies: ["UIKit"], path: "Sources/Shims/SwiftUI"),
        .target(name: "UIKit", path: "Sources/Shims/UIKit"),
        .target(name: "WebKit", dependencies: ["UIKit"], path: "Sources/Shims/WebKit"),
        .target(name: "AVFoundation", path: "Sources/Shims/AVFoundation"),
        .target(name: "MediaPlayer", path: "Sources/Shims/MediaPlayer"),

        // The real app sources, compiled unmodified.
        .target(
            name: "OrielApp",
            dependencies: [
                .product(name: "Core", package: "Core"),
                "SwiftUI",
                "UIKit",
                "WebKit",
                "AVFoundation",
                "MediaPlayer",
            ],
            path: "Sources/OrielApp",
            // Swift 6 language mode, matching what Xcode will build. Actor
            // isolation is the single most common way blind Swift fails to
            // compile, so checking it in Swift 5 mode would miss exactly the
            // errors this harness exists to find.
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
    ]
)
