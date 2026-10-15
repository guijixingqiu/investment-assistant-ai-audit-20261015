// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AnnualRingsGateA",
    platforms: [
        .macOS(.v13),
        .iOS(.v17)
    ],
    products: [
        .library(name: "AnnualRingsGateA", targets: ["AnnualRingsGateA"])
    ],
    targets: [
        .target(
            name: "AnnualRingsGateA",
            resources: [
                .process("Resources")
            ]
        ),
        .testTarget(
            name: "AnnualRingsGateATests",
            dependencies: ["AnnualRingsGateA"],
            exclude: ["ConnectionSettingsTests.swift"],
            resources: [
                .process("Fixtures")
            ]
        )
    ]
)
