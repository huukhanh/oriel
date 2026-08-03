// swift-tools-version: 5.9
import PackageDescription

// Foundation-only. Must never import WebKit/UIKit/SwiftUI/SwiftData —
// those do not exist on Linux and would break the only CI this project has.
let package = Package(
    name: "Core",
    products: [.library(name: "Core", targets: ["Core"])],
    targets: [
        .target(name: "Core"),
        .testTarget(name: "CoreTests", dependencies: ["Core"]),
    ]
)
