import Foundation

public enum LoopMode: String, Codable, CaseIterable, Sendable {
    case indefinite
    case maxTurns
}

public struct LoopConfig: Codable, Equatable, Sendable {
    public static let defaultPromptTemplate = "Keep working on the task. Do not finish yet."

    public var enabled: Bool
    public var mode: LoopMode
    public var maxTurns: Int?
    public var promptTemplate: String

    public init(
        enabled: Bool = false,
        mode: LoopMode = .indefinite,
        maxTurns: Int? = 3,
        promptTemplate: String = LoopConfig.defaultPromptTemplate
    ) {
        self.enabled = enabled
        self.mode = mode
        self.maxTurns = maxTurns
        self.promptTemplate = promptTemplate
    }

    public var sanitizedMaxTurns: Int {
        max(0, maxTurns ?? 0)
    }
}

public struct RuntimeState: Codable, Equatable, Sendable {
    public var activationID: UUID
    public var updatedAt: Date
    public var perSessionRemainingTurns: [String: Int]

    public init(
        activationID: UUID = UUID(),
        updatedAt: Date = .now,
        perSessionRemainingTurns: [String: Int] = [:]
    ) {
        self.activationID = activationID
        self.updatedAt = updatedAt
        self.perSessionRemainingTurns = perSessionRemainingTurns
    }

    public mutating func startNewActivation(now: Date = .now) {
        activationID = UUID()
        updatedAt = now
        perSessionRemainingTurns = [:]
    }
}

public struct PersistedState: Codable, Equatable, Sendable {
    public var config: LoopConfig
    public var runtime: RuntimeState

    public init(config: LoopConfig = LoopConfig(), runtime: RuntimeState = RuntimeState()) {
        self.config = config
        self.runtime = runtime
    }

    public static let defaultValue = PersistedState()

    public mutating func touch(now: Date = .now) {
        runtime.updatedAt = now
    }

    public mutating func startNewActivation(now: Date = .now) {
        runtime.startNewActivation(now: now)
    }
}

public struct StopHookInput: Codable, Equatable, Sendable {
    public let sessionID: String
    public let cwd: String
    public let hookEventName: String?
    public let turnID: String?
    public let stopHookActive: Bool?
    public let lastAssistantMessage: String?

    public init(
        sessionID: String,
        cwd: String,
        hookEventName: String? = "Stop",
        turnID: String? = nil,
        stopHookActive: Bool? = nil,
        lastAssistantMessage: String? = nil
    ) {
        self.sessionID = sessionID
        self.cwd = cwd
        self.hookEventName = hookEventName
        self.turnID = turnID
        self.stopHookActive = stopHookActive
        self.lastAssistantMessage = lastAssistantMessage
    }

    enum CodingKeys: String, CodingKey {
        case sessionID = "session_id"
        case cwd
        case hookEventName = "hook_event_name"
        case turnID = "turn_id"
        case stopHookActive = "stop_hook_active"
        case lastAssistantMessage = "last_assistant_message"
    }
}

public struct StopHookOutput: Codable, Equatable, Sendable {
    public let decision: String
    public let reason: String

    public init(decision: String = "block", reason: String) {
        self.decision = decision
        self.reason = reason
    }
}
