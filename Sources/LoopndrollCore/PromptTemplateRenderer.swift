import Foundation

public enum PromptTemplateRenderer {
    public static func render(
        template: String,
        sessionID: String,
        cwd: String,
        remainingTurns: Int?
    ) -> String {
        var rendered = template
            .replacingOccurrences(of: "{{session_id}}", with: sessionID)
            .replacingOccurrences(of: "{{cwd}}", with: cwd)
            .replacingOccurrences(of: "{{remaining_turns}}", with: remainingTurns.map(String.init) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if rendered.isEmpty {
            rendered = LoopConfig.defaultPromptTemplate
        }

        return rendered
    }
}
