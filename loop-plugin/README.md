# loop-plugin

`loop-plugin` packages Loopndroll's agent-facing plugin surfaces so they can be used in Cursor as well as Claude-oriented environments.

The current runtime behavior is split across two concerns:
- Cursor-compatible plugin discovery for skills
- Claude-specific lifecycle hooks backed by Bun runtime scripts

## What it does

The plugin currently includes shared skill surfaces for:
- explaining how `loop-plugin` works
- debugging plugin wiring and runtime state
- validating hook-oriented behavior against expected Loopndroll semantics

For Claude-compatible environments, the plugin also wires lifecycle hooks for:
- `SessionStart`
- `UserPromptSubmit`
- `Stop`

That hook runtime is intended to preserve Loopndroll's core behavior model:
- session registration and tracking
- prompt/title capture
- stop interception
- preset resolution
- completion checks
- await-reply behavior
- Telegram/Slack notification delivery when configured in plugin data

## Runtime requirements

The Claude hook runtime in this v0 plugin requires **Bun**.

The hook commands execute:

```bash
bun scripts/loop-hook.js
```

## Plugin structure

- `.cursor-plugin/plugin.json` — Cursor plugin manifest
- `.claude-plugin/plugin.json` — Claude-oriented plugin manifest
- `hooks/hooks.json` — Claude lifecycle hook registration
- `scripts/` — Bun runtime and helper modules
- `skills/` — explanation/debugging skills

## Cursor compatibility

Cursor compatibility currently covers:
- plugin manifest discovery
- shared skills in `skills/`

Cursor compatibility does **not** currently mean hook-runtime parity with Claude. The lifecycle hook implementation remains Claude-specific because it depends on Claude hook events and Claude plugin environment variables.

## Claude-oriented local testing

Run Claude Code with the plugin loaded directly:

```bash
claude --plugin-dir ./loop-plugin
```

Then verify:
- `/hooks` shows `SessionStart`, `UserPromptSubmit`, and `Stop`
- `/agents` shows the validation agent
- `/help` shows plugin skills under the `loop-plugin:` namespace

For hook execution visibility, prefer:

```bash
claude --debug-file /tmp/claude-hooks.log
```

Claude Code writes full hook execution details to the debug log file rather than normal transcript output.

## Runtime state

The plugin uses the native Loopndroll app database as its source of truth:

```text
~/Library/Application Support/loopndroll/app.db
```

That means presets, completion checks, notifications, remote prompt queues, and session state are shared with the native app.

The Claude hook runtime keeps plugin-local runtime artifacts in `${CLAUDE_PLUGIN_DATA}`:

```text
${CLAUDE_PLUGIN_DATA}/
├── logs/
│   └── hooks-debug.jsonl
└── runtime/
```

## Current limitations

This first pass focuses on a shared plugin package with a Claude-native hook runtime.

It does **not** include:
- installer scripts
- setup wizards that mutate standalone Claude settings
- MCP integration
- a Cursor-native reimplementation of the Claude hook lifecycle

It **does** include:
- plugin-owned hooks for Claude-compatible environments
- Bun runtime packaging
- debugging/explanation skills
- Cursor-compatible plugin manifest discovery

## Notes

The plugin is designed so installation scope is chosen by the user through normal plugin usage, not by code inside the plugin.
