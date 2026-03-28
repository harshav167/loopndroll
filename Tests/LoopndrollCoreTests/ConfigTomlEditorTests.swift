import XCTest
@testable import LoopndrollCore

final class ConfigTomlEditorTests: XCTestCase {
    func testAddsFeaturesSectionWhenMissing() {
        let input = """
        model = "gpt-5.4"
        """

        let output = ConfigTomlEditor.ensuringCodexHooksEnabled(in: input)

        XCTAssertTrue(output.contains("[features]"))
        XCTAssertTrue(output.contains("codex_hooks = true"))
        XCTAssertTrue(output.contains("model = \"gpt-5.4\""))
    }

    func testUpdatesExistingFeaturesSection() {
        let input = """
        model = "gpt-5.4"

        [features]
        multi_agent = true
        codex_hooks = false
        """

        let output = ConfigTomlEditor.ensuringCodexHooksEnabled(in: input)

        XCTAssertTrue(output.contains("multi_agent = true"))
        XCTAssertTrue(output.contains("codex_hooks = true"))
        XCTAssertFalse(output.contains("codex_hooks = false"))
    }

    func testPreservesUnrelatedSections() {
        let input = """
        [mcp_servers.chrome-devtools]
        enabled = true
        """

        let output = ConfigTomlEditor.ensuringCodexHooksEnabled(in: input)

        XCTAssertTrue(output.contains("[mcp_servers.chrome-devtools]"))
        XCTAssertTrue(output.contains("enabled = true"))
        XCTAssertTrue(output.contains("[features]"))
    }
}
