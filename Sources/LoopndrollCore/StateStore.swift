import Darwin
import Foundation

public struct StateStore: @unchecked Sendable {
    public let stateURL: URL
    public let lockURL: URL

    public init(stateURL: URL, lockURL: URL) {
        self.stateURL = stateURL
        self.lockURL = lockURL
    }

    public func load() throws -> PersistedState {
        try withExclusiveLock {
            try readState() ?? PersistedState.defaultValue
        }
    }

    @discardableResult
    public func ensureExists() throws -> PersistedState {
        let (state, _) = try mutate { state in
            state
        }
        return state
    }

    @discardableResult
    public func mutate<T>(_ update: (inout PersistedState) throws -> T) throws -> (PersistedState, T) {
        try withExclusiveLock {
            var state = try readState() ?? PersistedState.defaultValue
            let originalState = state
            let result = try update(&state)

            if state != originalState || !FileManager.default.fileExists(atPath: stateURL.path) {
                try write(state: state)
            }

            return (state, result)
        }
    }

    private func withExclusiveLock<T>(_ operation: () throws -> T) throws -> T {
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: lockURL.deletingLastPathComponent(), withIntermediateDirectories: true)

        let descriptor = open(lockURL.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else {
            throw CocoaError(.fileWriteUnknown)
        }

        defer {
            flock(descriptor, LOCK_UN)
            close(descriptor)
        }

        guard flock(descriptor, LOCK_EX) == 0 else {
            throw CocoaError(.fileWriteUnknown)
        }

        return try operation()
    }

    private func readState() throws -> PersistedState? {
        guard FileManager.default.fileExists(atPath: stateURL.path) else {
            return nil
        }

        let data = try Data(contentsOf: stateURL)
        return try Self.decoder.decode(PersistedState.self, from: data)
    }

    private func write(state: PersistedState) throws {
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: stateURL.deletingLastPathComponent(), withIntermediateDirectories: true)

        let temporaryURL = stateURL
            .deletingLastPathComponent()
            .appendingPathComponent(".state-\(UUID().uuidString).tmp")

        let data = try Self.encoder.encode(state)
        try data.write(to: temporaryURL, options: .atomic)

        if fileManager.fileExists(atPath: stateURL.path) {
            try fileManager.removeItem(at: stateURL)
        }

        try fileManager.moveItem(at: temporaryURL, to: stateURL)
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(makeISO8601Formatter().string(from: date))
        }
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            guard let date = makeISO8601Formatter().date(from: value) else {
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Invalid ISO8601 date: \(value)"
                )
            }
            return date
        }
        return decoder
    }()
}

private func makeISO8601Formatter() -> ISO8601DateFormatter {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}
