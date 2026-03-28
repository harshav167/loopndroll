import Foundation

public enum HookDecisionEngine {
    public static func decision(for input: StopHookInput, state: inout PersistedState) -> StopHookOutput? {
        guard input.hookEventName == nil || input.hookEventName == "Stop" else {
            return nil
        }

        guard state.config.enabled else {
            return nil
        }

        switch state.config.mode {
        case .indefinite:
            let renderedPrompt = PromptTemplateRenderer.render(
                template: state.config.promptTemplate,
                sessionID: input.sessionID,
                cwd: input.cwd,
                remainingTurns: state.runtime.perSessionRemainingTurns[input.sessionID]
            )
            return StopHookOutput(reason: renderedPrompt)

        case .maxTurns:
            let remainingTurns = state.runtime.perSessionRemainingTurns[input.sessionID] ?? state.config.sanitizedMaxTurns
            guard remainingTurns > 0 else {
                return nil
            }

            let nextRemainingTurns = remainingTurns - 1
            state.runtime.perSessionRemainingTurns[input.sessionID] = nextRemainingTurns
            state.touch()

            let renderedPrompt = PromptTemplateRenderer.render(
                template: state.config.promptTemplate,
                sessionID: input.sessionID,
                cwd: input.cwd,
                remainingTurns: nextRemainingTurns
            )
            return StopHookOutput(reason: renderedPrompt)
        }
    }
}
