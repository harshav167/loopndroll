---
name: Explain Loop Plugin
description: This skill should be used when the user asks to explain `loop-plugin`, describe its plugin surfaces, or summarize how its Claude-oriented lifecycle runtime maps to Loopndroll behavior.
version: 0.1.0
---

# Explain Loop Plugin

Explain the plugin in terms of shared plugin concepts first, then map Claude-specific lifecycle behavior to Loopndroll runtime behavior when relevant.

## Core framing

Describe `loop-plugin` as a Loopndroll plugin package with shared skills and agents plus a Claude-oriented hook runtime. State that Cursor discovers the plugin through `.cursor-plugin/plugin.json`, while Claude-oriented environments use `.claude-plugin/plugin.json` and `hooks/hooks.json`.

## Explain the lifecycle

When explaining Claude hook behavior, cover the three lifecycle events in this order:
1. `SessionStart`
2. `UserPromptSubmit`
3. `Stop`

For each event, explain:
- when the event fires
- what runtime state is updated
- why the event matters to Loopndroll behavior

## Explain stop interception clearly

When asked about continuing work, blocking completion, or loop behavior, explain that the `Stop` hook is the decision point in Claude-oriented flows. Describe that the runtime can allow the stop or return a block decision with a reason so Claude continues.

## Preserve packaging distinctions

Avoid describing the plugin as standalone settings copied into a project. Explain that this is a packaged plugin, and note that Cursor and Claude-compatible environments discover different manifests.

## Be explicit about v0 constraints

Mention these constraints when relevant:
- Bun is required for the Claude hook runtime
- no installer scripts are included
- installation scope is chosen by the user through normal plugin usage
- the plugin includes shared skills and a validation agent
- lifecycle hook support is currently Claude-specific

## Response style

Keep explanations concise and practical. Prefer a short lifecycle summary and then answer the specific question. Mention concrete files when useful:
- `.cursor-plugin/plugin.json`
- `.claude-plugin/plugin.json`
- `hooks/hooks.json`
- `scripts/loop-hook.js`
- `${CLAUDE_PLUGIN_DATA}/app.db`
