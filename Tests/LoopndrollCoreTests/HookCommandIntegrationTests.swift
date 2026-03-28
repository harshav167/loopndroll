import XCTest
@testable import LoopndrollCore

final class HookCommandIntegrationTests: XCTestCase {
    func testDisabledStateProducesNoOutput() throws {
        let directoryURL = try makeTemporaryDirectory()
        let stateURL = directoryURL.appendingPathComponent("state.json")
        let lockURL = directoryURL.appendingPathComponent("state.lock")
        let store = StateStore(stateURL: stateURL, lockURL: lockURL)
        _ = try store.mutate { state in
            state.config = LoopConfig(enabled: false, mode: .indefinite, maxTurns: 3, promptTemplate: "keep going")
            state.touch()
        }

        let result = HookCommand.execute(
            arguments: ["--state-path", stateURL.path],
            stdinData: stopPayload(sessionID: "thread-1", cwd: "/repo")
        )

        XCTAssertEqual(result.exitCode, 0)
        XCTAssertTrue(result.stdout.isEmpty)
    }

    func testIndefiniteStateProducesExactBlockJSON() throws {
        let directoryURL = try makeTemporaryDirectory()
        let stateURL = directoryURL.appendingPathComponent("state.json")
        let lockURL = directoryURL.appendingPathComponent("state.lock")
        let store = StateStore(stateURL: stateURL, lockURL: lockURL)
        _ = try store.mutate { state in
            state.config = LoopConfig(enabled: true, mode: .indefinite, maxTurns: 3, promptTemplate: "Keep going")
            state.touch()
        }

        let result = HookCommand.execute(
            arguments: ["--state-path", stateURL.path],
            stdinData: stopPayload(sessionID: "thread-1", cwd: "/repo")
        )

        let output = try JSONDecoder().decode(StopHookOutput.self, from: result.stdout)
        XCTAssertEqual(output, StopHookOutput(reason: "Keep going"))
    }

    func testMaxTurnsStateCountsDownAcrossExecutions() throws {
        let directoryURL = try makeTemporaryDirectory()
        let stateURL = directoryURL.appendingPathComponent("state.json")
        let lockURL = directoryURL.appendingPathComponent("state.lock")
        let store = StateStore(stateURL: stateURL, lockURL: lockURL)
        _ = try store.mutate { state in
            state.config = LoopConfig(
                enabled: true,
                mode: .maxTurns,
                maxTurns: 2,
                promptTemplate: "Remaining {{remaining_turns}}"
            )
            state.startNewActivation()
        }

        let first = HookCommand.execute(
            arguments: ["--state-path", stateURL.path],
            stdinData: stopPayload(sessionID: "thread-1", cwd: "/repo")
        )
        let second = HookCommand.execute(
            arguments: ["--state-path", stateURL.path],
            stdinData: stopPayload(sessionID: "thread-1", cwd: "/repo")
        )
        let third = HookCommand.execute(
            arguments: ["--state-path", stateURL.path],
            stdinData: stopPayload(sessionID: "thread-1", cwd: "/repo")
        )

        XCTAssertEqual(try JSONDecoder().decode(StopHookOutput.self, from: first.stdout).reason, "Remaining 1")
        XCTAssertEqual(try JSONDecoder().decode(StopHookOutput.self, from: second.stdout).reason, "Remaining 0")
        XCTAssertTrue(third.stdout.isEmpty)
    }

    private func stopPayload(sessionID: String, cwd: String) -> Data {
        let payload = StopHookInput(sessionID: sessionID, cwd: cwd)
        return try! JSONEncoder().encode(payload)
    }

    private func makeTemporaryDirectory() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }
}
