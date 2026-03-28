import Foundation
import LoopndrollCore
import SwiftUI

// The installed hook copies this executable and launches it in --hook mode.
if CommandLine.arguments.dropFirst().contains("--hook") {
    let result = HookCommand.execute(
        arguments: Array(CommandLine.arguments.dropFirst()),
        stdinData: FileHandle.standardInput.readDataToEndOfFile()
    )

    if !result.stdout.isEmpty {
        FileHandle.standardOutput.write(result.stdout)
    }

    if !result.stderr.isEmpty {
        FileHandle.standardError.write(result.stderr)
    }

    Foundation.exit(result.exitCode)
}

LoopndrollApplication.main()
