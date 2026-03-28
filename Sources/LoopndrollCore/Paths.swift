import Foundation

public struct LoopndrollPaths: Equatable, Sendable {
    public let codexDirectoryURL: URL
    public let appDirectoryURL: URL

    public init(codexDirectoryURL: URL, appDirectoryURL: URL) {
        self.codexDirectoryURL = codexDirectoryURL
        self.appDirectoryURL = appDirectoryURL
    }

    public static func live() -> LoopndrollPaths {
        let fileManager = FileManager.default
        let homeDirectoryURL = fileManager.homeDirectoryForCurrentUser
        let codexDirectoryURL = homeDirectoryURL.appendingPathComponent(".codex", isDirectory: true)

        let applicationSupportURL: URL
        if let resolved = try? fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ) {
            applicationSupportURL = resolved
        } else {
            applicationSupportURL = homeDirectoryURL
                .appendingPathComponent("Library", isDirectory: true)
                .appendingPathComponent("Application Support", isDirectory: true)
        }

        let appDirectoryURL = applicationSupportURL.appendingPathComponent("loopndroll", isDirectory: true)
        return LoopndrollPaths(codexDirectoryURL: codexDirectoryURL, appDirectoryURL: appDirectoryURL)
    }

    public var codexConfigURL: URL {
        codexDirectoryURL.appendingPathComponent("config.toml")
    }

    public var codexHooksURL: URL {
        codexDirectoryURL.appendingPathComponent("hooks.json")
    }

    public var stateURL: URL {
        appDirectoryURL.appendingPathComponent("state.json")
    }

    public var lockURL: URL {
        appDirectoryURL.appendingPathComponent("state.lock")
    }

    public var binDirectoryURL: URL {
        appDirectoryURL.appendingPathComponent("bin", isDirectory: true)
    }

    public var managedExecutableURL: URL {
        binDirectoryURL.appendingPathComponent("loopndroll-hook")
    }
}
