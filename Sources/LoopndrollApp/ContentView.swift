import LoopndrollCore
import SwiftUI

struct ContentView: View {
    @Bindable var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Picker("", selection: Binding(
                get: { model.state.config.mode },
                set: { model.setMode($0) }
            )) {
                Text("Indefinite").tag(LoopMode.indefinite)
                Text("Max turns").tag(LoopMode.maxTurns)
            }
            .labelsHidden()
            .pickerStyle(.segmented)

            if model.state.config.mode == .maxTurns {
                HStack {
                    Text("Turns per thread")
                    Spacer()
                    Stepper(
                        value: Binding(
                            get: { max(1, model.state.config.maxTurns ?? 1) },
                            set: { model.setMaxTurns($0) }
                        ),
                        in: 1...99
                    ) {
                        Text("\(max(1, model.state.config.maxTurns ?? 1))")
                            .monospacedDigit()
                    }
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                TextEditor(text: Binding(
                    get: { model.state.config.promptTemplate },
                    set: { model.setPromptTemplate($0) }
                ))
                .font(.body)
                .frame(minHeight: 96)
                .padding(6)
                .background {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color(nsColor: .textBackgroundColor))
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.secondary.opacity(0.25), lineWidth: 1)
                }
            }

            HStack {
                Button("Quit") {
                    model.quit()
                }
                .buttonStyle(.borderless)

                Spacer()

                Button(model.state.config.enabled ? "Stop" : "Start") {
                    model.setEnabled(!model.state.config.enabled)
                }
            }
        }
        .padding(16)
        .frame(width: 360)
    }
}
