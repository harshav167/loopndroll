import Foundation

public struct HooksMergeResult: Equatable, Sendable {
    public let data: Data
    public let didChange: Bool
    public let replacedMalformedInput: Bool

    public init(data: Data, didChange: Bool, replacedMalformedInput: Bool) {
        self.data = data
        self.didChange = didChange
        self.replacedMalformedInput = replacedMalformedInput
    }
}

public enum HooksConfiguration {
    public static let managedByMarker = "--managed-by loopndroll"

    public static func managedCommand(executableURL: URL) -> String {
        "\(shellEscaped(executableURL.path)) --hook --managed-by loopndroll"
    }

    public static func containsManagedStopHook(in data: Data) -> Bool {
        guard let jsonObject = try? JSONSerialization.jsonObject(with: data),
              let root = jsonObject as? [String: Any],
              let hooks = root["hooks"] as? [String: Any],
              let stopGroups = hooks["Stop"] as? [Any] else {
            return false
        }

        for group in stopGroups {
            guard let groupDictionary = group as? [String: Any],
                  let handlers = groupDictionary["hooks"] as? [Any] else {
                continue
            }

            for handler in handlers {
                guard let handlerDictionary = handler as? [String: Any],
                      let command = handlerDictionary["command"] as? String else {
                    continue
                }

                if command.contains(managedByMarker) {
                    return true
                }
            }
        }

        return false
    }

    public static func mergedJSON(existingData: Data?, executableURL: URL) throws -> HooksMergeResult {
        let originalData = existingData.flatMap { $0.isEmpty ? nil : $0 }
        let desiredCommand = managedCommand(executableURL: executableURL)

        var replacedMalformedInput = false
        let rootObject: [String: Any]

        if let originalData {
            do {
                let parsedObject = try JSONSerialization.jsonObject(with: originalData)
                rootObject = parsedObject as? [String: Any] ?? [:]
            } catch {
                replacedMalformedInput = true
                rootObject = [:]
            }
        } else {
            rootObject = [:]
        }

        var updatedRoot = rootObject
        var hooksObject = updatedRoot["hooks"] as? [String: Any] ?? [:]
        let existingStopGroups = hooksObject["Stop"] as? [Any] ?? []

        var updatedStopGroups: [Any] = []
        var hasUpdatedManagedHook = false

        for group in existingStopGroups {
            guard var groupDictionary = group as? [String: Any] else {
                updatedStopGroups.append(group)
                continue
            }

            let handlers = groupDictionary["hooks"] as? [Any] ?? []
            var updatedHandlers: [Any] = []

            for handler in handlers {
                guard var handlerDictionary = handler as? [String: Any] else {
                    updatedHandlers.append(handler)
                    continue
                }

                if isManagedHandler(handlerDictionary) {
                    if hasUpdatedManagedHook {
                        continue
                    }

                    handlerDictionary["type"] = "command"
                    handlerDictionary["command"] = desiredCommand
                    handlerDictionary["timeout"] = 30
                    handlerDictionary["statusMessage"] = "Loopndroll is deciding whether Codex should continue"
                    hasUpdatedManagedHook = true
                }

                updatedHandlers.append(handlerDictionary)
            }

            groupDictionary["hooks"] = updatedHandlers
            if !updatedHandlers.isEmpty {
                updatedStopGroups.append(groupDictionary)
            }
        }

        if !hasUpdatedManagedHook {
            updatedStopGroups.append([
                "hooks": [
                    [
                        "type": "command",
                        "command": desiredCommand,
                        "timeout": 30,
                        "statusMessage": "Loopndroll is deciding whether Codex should continue",
                    ],
                ],
            ])
        }

        hooksObject["Stop"] = updatedStopGroups
        updatedRoot["hooks"] = hooksObject

        let mergedData = try JSONSerialization.data(
            withJSONObject: updatedRoot,
            options: [.prettyPrinted, .sortedKeys]
        )

        let didChange = originalData != mergedData || replacedMalformedInput
        return HooksMergeResult(
            data: mergedData,
            didChange: didChange,
            replacedMalformedInput: replacedMalformedInput
        )
    }

    private static func isManagedHandler(_ dictionary: [String: Any]) -> Bool {
        guard let type = dictionary["type"] as? String,
              type == "command",
              let command = dictionary["command"] as? String else {
            return false
        }

        return command.contains(managedByMarker)
    }

    private static func shellEscaped(_ raw: String) -> String {
        let escaped = raw.replacingOccurrences(of: "'", with: "'\"'\"'")
        return "'\(escaped)'"
    }
}
