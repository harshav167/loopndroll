import AppKit
import LoopndrollCore
import SwiftUI

final class LoopndrollAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.accessory)
    }
}

struct LoopndrollApplication: App {
    @NSApplicationDelegateAdaptor(LoopndrollAppDelegate.self) private var appDelegate
    @State private var model = AppModel()

    var body: some Scene {
        MenuBarExtra {
            ContentView(model: model)
                .task {
                    model.startIfNeeded()
                }
        } label: {
            Label(
                "Loopndroll",
                systemImage: model.state.config.enabled ? "bolt.circle.fill" : "bolt.circle"
            )
        }
        .menuBarExtraStyle(.window)
    }
}
