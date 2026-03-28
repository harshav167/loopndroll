import XCTest
@testable import LoopndrollCore

final class HookDecisionEngineTests: XCTestCase {
    func testDisabledConfigAllowsStop() {
        var state = PersistedState(
            config: LoopConfig(enabled: false, mode: .indefinite, maxTurns: 3, promptTemplate: "keep going"),
            runtime: RuntimeState()
        )
        let input = StopHookInput(sessionID: "thread-1", cwd: "/repo")

        let output = HookDecisionEngine.decision(for: input, state: &state)

        XCTAssertNil(output)
    }

    func testIndefiniteModeRendersPromptTokens() {
        var state = PersistedState(
            config: LoopConfig(
                enabled: true,
                mode: .indefinite,
                maxTurns: 3,
                promptTemplate: "Keep going in {{cwd}} for {{session_id}}."
            ),
            runtime: RuntimeState()
        )
        let input = StopHookInput(sessionID: "thread-1", cwd: "/repo")

        let output = HookDecisionEngine.decision(for: input, state: &state)

        XCTAssertEqual(output?.decision, "block")
        XCTAssertEqual(output?.reason, "Keep going in /repo for thread-1.")
    }

    func testMaxTurnsConsumesExactlyConfiguredBudget() {
        var state = PersistedState(
            config: LoopConfig(
                enabled: true,
                mode: .maxTurns,
                maxTurns: 2,
                promptTemplate: "Remaining {{remaining_turns}}"
            ),
            runtime: RuntimeState(updatedAt: .distantPast)
        )
        let input = StopHookInput(sessionID: "thread-1", cwd: "/repo")

        let first = HookDecisionEngine.decision(for: input, state: &state)
        let second = HookDecisionEngine.decision(for: input, state: &state)
        let third = HookDecisionEngine.decision(for: input, state: &state)

        XCTAssertEqual(first?.reason, "Remaining 1")
        XCTAssertEqual(second?.reason, "Remaining 0")
        XCTAssertNil(third)
        XCTAssertEqual(state.runtime.perSessionRemainingTurns["thread-1"], 0)
    }

    func testMaxTurnsTracksSessionsIndependently() {
        var state = PersistedState(
            config: LoopConfig(
                enabled: true,
                mode: .maxTurns,
                maxTurns: 1,
                promptTemplate: "Keep going"
            ),
            runtime: RuntimeState()
        )

        let firstThread = StopHookInput(sessionID: "thread-a", cwd: "/repo")
        let secondThread = StopHookInput(sessionID: "thread-b", cwd: "/repo")

        XCTAssertNotNil(HookDecisionEngine.decision(for: firstThread, state: &state))
        XCTAssertNotNil(HookDecisionEngine.decision(for: secondThread, state: &state))
        XCTAssertNil(HookDecisionEngine.decision(for: firstThread, state: &state))
        XCTAssertNil(HookDecisionEngine.decision(for: secondThread, state: &state))
    }
}
