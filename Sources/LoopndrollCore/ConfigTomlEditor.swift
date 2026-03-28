import Foundation

public enum ConfigTomlEditor {
    public static func ensuringCodexHooksEnabled(in input: String) -> String {
        let lines = input.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline).map(String.init)
        var mutableLines = lines

        var featuresStartIndex: Int?
        var featuresEndIndex = mutableLines.count

        for (index, line) in mutableLines.enumerated() {
            guard let sectionName = sectionName(for: line) else { continue }

            if let startIndex = featuresStartIndex {
                featuresEndIndex = index
                if startIndex < featuresEndIndex {
                    break
                }
            }

            if sectionName == "features" {
                featuresStartIndex = index
            }
        }

        if let featuresStartIndex {
            let bodyRange = (featuresStartIndex + 1)..<featuresEndIndex
            if let existingFlagIndex = bodyRange.first(where: { isCodexHooksSetting(line: mutableLines[$0]) }) {
                mutableLines[existingFlagIndex] = "codex_hooks = true"
            } else {
                mutableLines.insert("codex_hooks = true", at: featuresEndIndex)
            }
        } else {
            if !mutableLines.isEmpty, mutableLines.last?.isEmpty == false {
                mutableLines.append("")
            }

            mutableLines.append("[features]")
            mutableLines.append("codex_hooks = true")
        }

        var output = mutableLines.joined(separator: "\n")
        if !output.hasSuffix("\n") {
            output.append("\n")
        }
        return output
    }

    public static func codexHooksEnabled(in input: String) -> Bool {
        var currentSection: String?

        for line in input.split(whereSeparator: \.isNewline).map(String.init) {
            if let sectionName = sectionName(for: line) {
                currentSection = sectionName
                continue
            }

            guard currentSection == "features" else { continue }
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("codex_hooks") else { continue }
            return trimmed.contains("= true")
        }

        return false
    }

    private static func sectionName(for line: String) -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("["),
              trimmed.hasSuffix("]"),
              trimmed.count >= 2 else {
            return nil
        }

        return String(trimmed.dropFirst().dropLast())
    }

    private static func isCodexHooksSetting(line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard !trimmed.hasPrefix("#") else { return false }
        return trimmed.hasPrefix("codex_hooks") && trimmed.contains("=")
    }
}
