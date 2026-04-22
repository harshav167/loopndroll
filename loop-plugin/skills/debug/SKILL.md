---
name: Debug Loop Plugin
description: This skill should be used when the user asks to debug `loop-plugin`, inspect plugin state, verify Claude-oriented hook behavior, or troubleshoot Loopndroll runtime execution across supported plugin environments.
version: 0.1.0
---

# Debug Loop Plugin

Debug the plugin as a packaged plugin surface first and as a Loopndroll runtime second.

## Debug order

Follow this order:
1. verify the plugin is loaded
2. verify the relevant manifest is present
3. if testing Claude hook behavior, verify the hooks are registered
4. verify Bun is available
5. inspect plugin runtime state
6. inspect hook output behavior
7. compare observed behavior to expected Loopndroll semantics

## Minimum checks

When debugging, check these first:
- Cursor manifest exists at `.cursor-plugin/plugin.json` when validating Cursor compatibility
- Claude manifest exists at `.claude-plugin/plugin.json` when validating Claude compatibility
- hook config exists at `hooks/hooks.json` for Claude hook flows
- hook commands point at `bun scripts/loop-hook.js`
- Bun is available in the environment
- `${CLAUDE_PLUGIN_DATA}` exists and contains runtime files after Claude hooks execute

## Runtime state checks

Inspect these paths when they exist:
- `${CLAUDE_PLUGIN_DATA}/app.db`
- `${CLAUDE_PLUGIN_DATA}/logs/hooks-debug.jsonl`
- `${CLAUDE_PLUGIN_DATA}/runtime/`

If state files are missing after hook execution, suspect hook loading, command execution, or Bun availability first.

## Stop hook diagnosis

When diagnosing `Stop`, check whether the runtime returned one of these outcomes:
- no stdout JSON and exit `0` -> stop allowed
- `{"decision":"block","reason":"..."}` on stdout and exit `0` -> stop blocked and continued
- exit `2` with stderr reason -> hard block path

Use the command-hook contract, not prompt-hook assumptions.

Also inspect `stop_hook_active` behavior. If Claude is already continuing because of a prior Stop hook, the plugin should avoid blindly reusing the same generic continuation text over and over. Prefer the current Stop payload's `last_assistant_message` first, then use transcript fallback only when that field is absent.

## Compare against expected behavior

After confirming the mechanics, compare the result against expected Loopndroll semantics:
- was the session registered?
- was prompt/title state updated?
- did preset resolution match expectation?
- did completion checks run?
- did await-reply state persist?
- did notifications fire?

## Output style

Report findings as:
- what is wired correctly
- what is missing or broken
- the most likely root cause
- the next concrete fix

Keep the answer short and file-specific.
