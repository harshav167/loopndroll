// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Loopndroll",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .library(
            name: "LoopndrollCore",
            targets: ["LoopndrollCore"]
        ),
        .executable(
            name: "Loopndroll",
            targets: ["LoopndrollApp"]
        ),
        .executable(
            name: "LoopndrollHook",
            targets: ["LoopndrollHook"]
        ),
    ],
    targets: [
        .target(
            name: "LoopndrollCore"
        ),
        .executableTarget(
            name: "LoopndrollApp",
            dependencies: ["LoopndrollCore"]
        ),
        .executableTarget(
            name: "LoopndrollHook",
            dependencies: ["LoopndrollCore"]
        ),
        .testTarget(
            name: "LoopndrollCoreTests",
            dependencies: ["LoopndrollCore"]
        ),
    ]
)
