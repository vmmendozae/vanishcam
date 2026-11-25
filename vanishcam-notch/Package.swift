// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "VanishCamNotch",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "VanishCamNotch", path: "Sources/VanishCamNotch")
    ]
)
