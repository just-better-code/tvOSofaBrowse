// swift-tools-version:5.6
import PackageDescription

let package = Package(
    name: "AdGuardConverter",
    platforms: [.tvOS(.v15)],
    products: [
        .library(name: "ContentBlockerConverter", targets: ["ContentBlockerConverter"]),
    ],
    dependencies: [
        .package(url: "https://github.com/gumob/PunycodeSwift.git", exact: "3.0.0"),
        .package(url: "https://github.com/ameshkov/swift-psl", exact: "1.1.183"),
    ],
    targets: [
        .target(name: "ContentBlockerConverter", dependencies: [
            .product(name: "Punycode", package: "PunycodeSwift"),
            .product(name: "PublicSuffixList", package: "swift-psl"),
        ], swiftSettings: [
            // Filter conversion is CPU-heavy even in an inspectable Debug app.
            .unsafeFlags(["-O"], .when(configuration: .debug)),
        ]),
    ]
)
