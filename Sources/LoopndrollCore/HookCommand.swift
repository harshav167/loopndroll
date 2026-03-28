import Foundation

public enum HookCommand {
    public struct ExecutionResult: Equatable, Sendable {
        public let exitCode: Int32
        public let stdout: Data
        public let stderr: Data

        public init(exitCode: Int32, stdout: Data, stderr: Data) {
            self.exitCode = exitCode
            self.stdout = stdout
            self.stderr = stderr
        }

        public static let success = ExecutionResult(exitCode: 0, stdout: Data(), stderr: Data())
    }

    public static func execute(arguments: [String], stdinData: Data, paths: LoopndrollPaths = .live()) -> ExecutionResult {
        let options = Options(arguments: arguments, defaultPaths: paths)

        guard let input = try? JSONDecoder().decode(StopHookInput.self, from: stdinData),
              input.hookEventName == nil || input.hookEventName == "Stop" else {
            return .success
        }

        do {
            let store = StateStore(stateURL: options.stateURL, lockURL: options.lockURL)
            let (_, output) = try store.mutate { state in
                HookDecisionEngine.decision(for: input, state: &state)
            }

            guard let output else {
                return .success
            }

            let stdout = try JSONEncoder().encode(output)
            return ExecutionResult(exitCode: 0, stdout: stdout, stderr: Data())
        } catch {
            return .success
        }
    }
}

private struct Options {
    let stateURL: URL
    let lockURL: URL

    init(arguments: [String], defaultPaths: LoopndrollPaths) {
        var stateURL = defaultPaths.stateURL
        var lockURL = defaultPaths.lockURL

        var index = 0
        while index < arguments.count {
            switch arguments[index] {
            case "--state-path":
                if arguments.indices.contains(index + 1) {
                    stateURL = URL(fileURLWithPath: arguments[index + 1])
                    lockURL = stateURL.deletingLastPathComponent().appendingPathComponent("\(stateURL.lastPathComponent).lock")
                    index += 1
                }
            case "--lock-path":
                if arguments.indices.contains(index + 1) {
                    lockURL = URL(fileURLWithPath: arguments[index + 1])
                    index += 1
                }
            default:
                break
            }

            index += 1
        }

        self.stateURL = stateURL
        self.lockURL = lockURL
    }
}
