import Foundation

public struct InstallationHealth: Equatable, Sendable {
    public let isHealthy: Bool
    public let issues: [String]

    public init(isHealthy: Bool, issues: [String]) {
        self.isHealthy = isHealthy
        self.issues = issues
    }
}

public struct InstallationReport: Equatable, Sendable {
    public let didUpdateExecutable: Bool
    public let didUpdateConfig: Bool
    public let didUpdateHooks: Bool
    public let didCreateState: Bool
    public let replacedMalformedHooks: Bool
    public let health: InstallationHealth

    public init(
        didUpdateExecutable: Bool,
        didUpdateConfig: Bool,
        didUpdateHooks: Bool,
        didCreateState: Bool,
        replacedMalformedHooks: Bool,
        health: InstallationHealth
    ) {
        self.didUpdateExecutable = didUpdateExecutable
        self.didUpdateConfig = didUpdateConfig
        self.didUpdateHooks = didUpdateHooks
        self.didCreateState = didCreateState
        self.replacedMalformedHooks = replacedMalformedHooks
        self.health = health
    }
}

public struct InstallationManager: @unchecked Sendable {
    public let paths: LoopndrollPaths

    public init(paths: LoopndrollPaths = .live()) {
        self.paths = paths
    }

    public func validate() -> InstallationHealth {
        let fileManager = FileManager.default
        var issues: [String] = []

        if !fileManager.fileExists(atPath: paths.managedExecutableURL.path) {
            issues.append("Managed hook executable is missing.")
        }

        if let configContents = try? String(contentsOf: paths.codexConfigURL), !ConfigTomlEditor.codexHooksEnabled(in: configContents) {
            issues.append("~/.codex/config.toml does not enable features.codex_hooks.")
        } else if !fileManager.fileExists(atPath: paths.codexConfigURL.path) {
            issues.append("~/.codex/config.toml is missing.")
        }

        if let hooksData = try? Data(contentsOf: paths.codexHooksURL), !HooksConfiguration.containsManagedStopHook(in: hooksData) {
            issues.append("~/.codex/hooks.json does not contain the Loopndroll Stop hook.")
        } else if !fileManager.fileExists(atPath: paths.codexHooksURL.path) {
            issues.append("~/.codex/hooks.json is missing.")
        }

        if !fileManager.fileExists(atPath: paths.stateURL.path) {
            issues.append("Loopndroll state.json is missing.")
        }

        return InstallationHealth(isHealthy: issues.isEmpty, issues: issues)
    }

    public func repair(using sourceExecutableURL: URL) throws -> InstallationReport {
        let fileManager = FileManager.default

        try fileManager.createDirectory(at: paths.codexDirectoryURL, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: paths.appDirectoryURL, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: paths.binDirectoryURL, withIntermediateDirectories: true)

        let didUpdateExecutable = try installManagedExecutable(from: sourceExecutableURL)
        let didUpdateConfig = try repairConfig()
        let hooksResult = try repairHooks()
        let didCreateState = try createDefaultStateIfNeeded()

        let health = validate()
        return InstallationReport(
            didUpdateExecutable: didUpdateExecutable,
            didUpdateConfig: didUpdateConfig,
            didUpdateHooks: hooksResult.didChange,
            didCreateState: didCreateState,
            replacedMalformedHooks: hooksResult.replacedMalformedInput,
            health: health
        )
    }

    private func installManagedExecutable(from sourceExecutableURL: URL) throws -> Bool {
        let fileManager = FileManager.default
        let resolvedSourceURL = sourceExecutableURL.resolvingSymlinksInPath().standardizedFileURL
        let destinationURL = paths.managedExecutableURL.resolvingSymlinksInPath().standardizedFileURL

        if resolvedSourceURL == destinationURL {
            return false
        }

        let temporaryURL = paths.binDirectoryURL.appendingPathComponent(".loopndroll-hook-\(UUID().uuidString).tmp")
        if fileManager.fileExists(atPath: temporaryURL.path) {
            try fileManager.removeItem(at: temporaryURL)
        }

        try fileManager.copyItem(at: resolvedSourceURL, to: temporaryURL)
        try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: temporaryURL.path)

        if fileManager.fileExists(atPath: paths.managedExecutableURL.path) {
            try fileManager.removeItem(at: paths.managedExecutableURL)
        }

        try fileManager.moveItem(at: temporaryURL, to: paths.managedExecutableURL)
        return true
    }

    private func repairConfig() throws -> Bool {
        let fileManager = FileManager.default
        let currentContents = (try? String(contentsOf: paths.codexConfigURL)) ?? ""
        let updatedContents = ConfigTomlEditor.ensuringCodexHooksEnabled(in: currentContents)

        if fileManager.fileExists(atPath: paths.codexConfigURL.path), currentContents == updatedContents {
            return false
        }

        try updatedContents.write(to: paths.codexConfigURL, atomically: true, encoding: .utf8)
        return true
    }

    private func repairHooks() throws -> HooksMergeResult {
        let existingData = try? Data(contentsOf: paths.codexHooksURL)
        let result = try HooksConfiguration.mergedJSON(
            existingData: existingData,
            executableURL: paths.managedExecutableURL
        )

        if result.didChange {
            try result.data.write(to: paths.codexHooksURL, options: .atomic)
        }

        return result
    }

    private func createDefaultStateIfNeeded() throws -> Bool {
        let store = StateStore(stateURL: paths.stateURL, lockURL: paths.lockURL)
        let fileExisted = FileManager.default.fileExists(atPath: paths.stateURL.path)
        _ = try store.ensureExists()
        return !fileExisted
    }
}
