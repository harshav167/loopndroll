import XCTest
@testable import LoopndrollCore

final class HooksConfigurationTests: XCTestCase {
    func testCreatesManagedStopHookWhenFileIsEmpty() throws {
        let result = try HooksConfiguration.mergedJSON(
            existingData: nil,
            executableURL: URL(fileURLWithPath: "/tmp/loopndroll-hook")
        )

        XCTAssertTrue(result.didChange)
        XCTAssertFalse(result.replacedMalformedInput)
        XCTAssertTrue(HooksConfiguration.containsManagedStopHook(in: result.data))
    }

    func testPreservesExistingForeignHooks() throws {
        let input = """
        {
          "hooks" : {
            "Stop" : [
              {
                "hooks" : [
                  {
                    "command" : "python3 /tmp/other.py",
                    "type" : "command"
                  }
                ]
              }
            ]
          }
        }
        """.data(using: .utf8)

        let result = try HooksConfiguration.mergedJSON(
            existingData: input,
            executableURL: URL(fileURLWithPath: "/tmp/loopndroll-hook")
        )

        let commands = try commands(from: result.data)
        XCTAssertTrue(commands.contains("python3 /tmp/other.py"))
        XCTAssertTrue(commands.contains(HooksConfiguration.managedCommand(executableURL: URL(fileURLWithPath: "/tmp/loopndroll-hook"))))
    }

    func testUpdatesExistingManagedHookWithoutDuplicatingIt() throws {
        let input = """
        {
          "hooks" : {
            "Stop" : [
              {
                "hooks" : [
                  {
                    "command" : "'/old/path' --hook --managed-by loopndroll",
                    "type" : "command"
                  },
                  {
                    "command" : "'/other/path' --hook --managed-by loopndroll",
                    "type" : "command"
                  }
                ]
              }
            ]
          }
        }
        """.data(using: .utf8)

        let result = try HooksConfiguration.mergedJSON(
            existingData: input,
            executableURL: URL(fileURLWithPath: "/tmp/new-hook")
        )

        let commands = try commands(from: result.data)
        let managedCommands = commands.filter { $0.contains("--managed-by loopndroll") }
        XCTAssertEqual(managedCommands.count, 1)
        XCTAssertEqual(managedCommands.first, HooksConfiguration.managedCommand(executableURL: URL(fileURLWithPath: "/tmp/new-hook")))
    }

    func testMalformedJSONIsReplaced() throws {
        let result = try HooksConfiguration.mergedJSON(
            existingData: Data("{not-json}".utf8),
            executableURL: URL(fileURLWithPath: "/tmp/loopndroll-hook")
        )

        XCTAssertTrue(result.replacedMalformedInput)
        XCTAssertTrue(HooksConfiguration.containsManagedStopHook(in: result.data))
    }

    private func commands(from data: Data) throws -> [String] {
        let object = try JSONSerialization.jsonObject(with: data)
        let root = try XCTUnwrap(object as? [String: Any])
        let hooks = try XCTUnwrap(root["hooks"] as? [String: Any])
        let stopGroups = try XCTUnwrap(hooks["Stop"] as? [Any])

        return stopGroups.compactMap { group in
            (group as? [String: Any])?["hooks"] as? [Any]
        }
        .flatMap { $0 }
        .compactMap { handler in
            (handler as? [String: Any])?["command"] as? String
        }
    }
}
