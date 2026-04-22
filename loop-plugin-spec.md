# loop-plugin spec

## Goal

Create a Claude Code plugin named `loop-plugin` that ports Loopndroll's current Codex-only hook integration to Claude Code's plugin system.

The plugin should be plugin-native:
- no external install scripts
- no setup wizard
- no plugin-managed decision about project vs global scope
- hook definitions live in the plugin itself
- users install it using Claude Code's normal plugin flow or `--plugin-dir`
- skills and agents are allowed where they improve usability, diagnostics, validation, or explanation

The plugin should support the same three core lifecycle events as the current Loopndroll hook flow:
- `SessionStart`
- `UserPromptSubmit`
- `Stop`

The plugin should preserve the existing Loopndroll behavior model:
- register and track sessions
- store prompt/session state
- decide whether a stop should be allowed or converted into another turn
- optionally run completion checks
- optionally wait for a remote reply
- optionally send notifications

## Why this plugin exists

### The underlying problem

Claude Code, by default, is optimized to answer the current turn and stop when it believes the requested work is complete. That is usually correct, but it breaks down in a specific class of workflows:

- long-running refactors where the next step is only obvious after the previous one lands
- tasks where "done" should mean "tests/lint/typecheck passed," not merely "the assistant said it is done"
- workflows where the user wants to step away from the terminal and continue the same session later from a remote prompt or notification reply
- situations where the assistant should pause for human input instead of guessing

In all of those cases, the missing capability is not better prompting. The missing capability is **lifecycle control**.

A plain prompt can ask Claude Code to keep going, run tests, or wait for human feedback, but once the assistant reaches a stopping point there must be some mechanism outside the conversation itself that decides what happens next. That mechanism is hooks.

### What Loopndroll originally solved

Loopndroll originally solved this for Codex by attaching to Codex Hooks. The app could:

- detect when a session started
- detect the task prompt
- intercept stop events
- persist session state
- decide whether the stop should be allowed
- feed another prompt back in if more work was required
- wait for a remote reply instead of guessing
- send notifications so the user could supervise the flow from outside the terminal

That gave the user a practical control plane over agent sessions rather than relying entirely on one-shot prompting.

### Why this plugin has to exist at all

The original Loopndroll implementation is tightly coupled to Codex-specific infrastructure. It depends on:

- Codex hook event names and payload assumptions
- Codex config files under `~/.codex/`
- Codex hook registration mechanics
- a managed hook executable written outside plugin boundaries

None of that is reusable in Claude Code as-is.

Claude Code has its own hook lifecycle, its own plugin system, its own payload shape, and its own installation/distribution conventions. So the core problem is not that Loopndroll's behavior is wrong; the problem is that its **integration surface is bound to the wrong host environment**.

This plugin exists to separate those two concerns:

1. **Behavior layer** — the valuable Loopndroll logic: session tracking, stop interception, completion checks, remote continuation, and notifications.
2. **Host integration layer** — the Claude Code-specific packaging, hooks, payload normalization, and persistent plugin data paths.

The plugin is therefore not "extra abstraction for its own sake." It is the minimum package needed to make the existing behavior portable and installable in Claude Code.

## What problem the plugin solves

At a high level, `loop-plugin` turns Claude Code from a tool that only responds to the immediate turn into a tool that can participate in a **stateful, policy-driven work loop**.

More concretely, it solves these problems:

### 1. "The assistant said it's done, but the repo is still red."

Without hooks, the assistant can claim completion while tests, lint, or typecheck are still failing. The plugin solves this by intercepting `Stop` and optionally converting stop into another turn based on completion-check commands.

### 2. "I want the agent to keep pushing without me typing 'keep going' again and again."

Without hooks, every continuation is a new manual intervention. The plugin solves this by turning stop into continuation according to the selected preset, such as `infinite` or `max-turns-*`.

### 3. "I want the agent to wait for me instead of guessing."

Without hooks, a normal stop is terminal and there is no built-in policy layer that can pause the session, wait for remote input, then continue the same workflow. The plugin solves this with await-reply behavior and queued remote prompts.

### 4. "I want one reusable package, not a pile of project-local settings."

Standalone `.claude/settings.json` hooks are fine for one machine or one project, but they are weak as a reusable, distributable integration surface. The plugin solves this by packaging the behavior in Claude Code's plugin model so it can be installed, versioned, reloaded, and distributed consistently.

### 5. "I need the agent runtime to remember what session it is in and what happened previously."

A single prompt does not provide durable orchestration state. The plugin solves this by maintaining its own state in `${CLAUDE_PLUGIN_DATA}`, keyed to Claude sessions and transcripts.

## What the plugin is, conceptually

`loop-plugin` should be understood as a **session orchestration layer** for Claude Code.

It is not primarily:
- a command plugin
- a settings mutator
- a marketplace convenience wrapper
- a documentation-only helper

Those may exist around it, but the core of the plugin is this:

> A hook-driven runtime that observes Claude Code session lifecycle events, stores session state, and decides whether a stop event should be accepted or transformed into a continuation policy.

That is the center of gravity of the whole design.

## Why a plugin is the right packaging model

A plugin is the correct packaging model for four reasons.

### 1. Claude Code already has a native extension surface for this

Claude Code expects reusable extensions to live as plugins with:
- `.claude-plugin/plugin.json`
- `hooks/hooks.json`
- optional `skills/`
- optional `agents/`

This plugin is deliberately aligned with that model instead of fighting it.

### 2. Installation scope belongs to Claude Code, not the runtime logic

The user can install a plugin globally or in a narrower scope using Claude Code's normal plugin flow. The plugin should not contain code that rewrites user settings to simulate installation. Packaging the integration as a plugin keeps that boundary clean.

### 3. Plugin-owned hooks are easier to reason about than copied settings snippets

If the hooks lived only as copy-paste snippets for `.claude/settings.json`, the user would own a manually forked configuration that could drift. By shipping `hooks/hooks.json` in the plugin, the behavior is versioned and colocated with its runtime.

### 4. Skills and agents can explain and validate the runtime without owning installation

The plugin can include supporting surfaces like:
- explanation skills
- debug skills
- validation agents

These help the user understand and inspect the system, but they are not responsible for installing it. That separation keeps the runtime clean.

## End-to-end mental model

The easiest way to think about `loop-plugin` is as a pipeline:

1. **Claude Code emits a lifecycle event**
2. **Plugin hook receives raw Claude hook JSON on stdin**
3. **Plugin wrapper normalizes Claude-specific payloads into Loopndroll-friendly runtime input**
4. **Runtime reads/writes session state in `${CLAUDE_PLUGIN_DATA}`**
5. **Runtime computes the effective preset/policy for this session**
6. **Runtime either allows stop or returns a block decision with a continuation reason**
7. **Claude Code follows that decision**

That is the entire product in one sequence.

## Detailed lifecycle walkthrough

### SessionStart: create or recover orchestration state

When Claude Code starts or resumes a session, the `SessionStart` hook fires.

At this stage the plugin is solving a bookkeeping problem:
- which Claude session is this?
- what directory is it operating in?
- is this a new session or a resumed one?
- do we already know about it?

The plugin records or updates a session row in its sqlite database. This gives later hook events a durable anchor for policy decisions.

Without this step, `Stop` would be stateless and the plugin would have no durable concept of session identity.

The current Claude Code hook docs also expose `stop_hook_active` and `last_assistant_message` in the Stop payload. The plugin should use those host-native signals where possible instead of treating transcript parsing as the primary source of truth.

### UserPromptSubmit: capture user intent

When the user sends a prompt, `UserPromptSubmit` fires.

This stage exists because later orchestration decisions are better when the runtime knows the latest user intent. The plugin stores:
- the session id
- the transcript path
- the working directory
- the prompt-derived title or summary

This makes the runtime inspectable and gives remote notifications enough context to be meaningful.

Without this step, the runtime would know that a session exists but not what the session is trying to accomplish.

### Stop: evaluate whether stopping is actually allowed

This is the core event.

When Claude Code is about to stop, the plugin treats that as a policy decision point rather than an unconditional success state.

The runtime asks questions like:
- is there an active preset?
- should the agent continue automatically?
- should completion checks run first?
- is there a queued remote prompt that should be injected now?
- should the session wait for human input?
- should a fixed number of extra turns be consumed?

The answer determines whether the hook:
- exits quietly and lets the session stop, or
- returns `{"decision":"block","reason":"..."}` to continue the workflow with a new reason/prompt

That is the key capability the plugin provides.

## Why the payload adapter matters

The payload adapter is one of the most important pieces in the whole design.

Loopndroll's original runtime logic was built around assumptions from Codex hook payloads, such as specific field names and the presence of certain stop-time values. Claude Code uses a different payload shape.

If we reused the old runtime without adaptation, the behavior would silently degrade. For example:
- prompt text might not be captured because Claude uses `prompt`
- stop-time assistant content may need to be recovered from `transcript_path`
- event sources like `startup` vs `resume` come from Claude's session start payload, not Codex config

So the adapter is not cosmetic. It is the compatibility layer that makes behavior reuse possible.

## Why `${CLAUDE_PLUGIN_DATA}` matters

The plugin needs durable state that survives across hook invocations. That includes:
- sqlite database contents
- runtime-generated artifacts
- logs
- reply queues
- receipts

That state cannot live safely in:
- the repo root
- `.claude/` project config
- the plugin source tree itself

`${CLAUDE_PLUGIN_DATA}` is the correct place because it is the plugin's persistent runtime area in Claude Code. This keeps the plugin portable and keeps mutable runtime data separate from source-controlled plugin files.

## Why the plugin includes skills and an agent

These are not the main feature, but they exist for a reason.

### `loop-plugin:explain`

This exists because the runtime is non-trivial. Users need a concise way to ask what the plugin is doing, how the hooks map to lifecycle events, and why a stop was or was not intercepted.

### `loop-plugin:debug`

This exists because hook systems fail in environment-specific ways: missing Bun, missing plugin data, wrong hook assumptions, stale runtime state, or bad Stop outputs. The debug skill makes investigation repeatable.

### `hook-validator` agent

This exists because validation is a focused task: inspect plugin structure, inspect hook wiring, inspect runtime behavior, and identify the smallest mismatch. That is a good fit for a dedicated agent rather than repeating the same reasoning every time.

## Why the plugin should not own installation scripts

The plugin deliberately does **not** include installer scripts or setup wizards that rewrite user Claude settings.

That is intentional because:
- plugins already have a native installation model
- installation scope is a user/platform concern, not a runtime concern
- extra installer logic creates more state drift and more failure modes
- a plugin should be installable by Claude Code itself, not by a second bespoke bootstrapping layer

In other words: the plugin exists to supply runtime behavior, not to replace Claude Code's plugin manager.

## Success criteria for this plugin

The plugin is successful if all of the following are true:

1. A user can install it with normal Claude Code plugin flows.
2. The hooks load from the plugin without manual settings copying.
3. The runtime persists session state in `${CLAUDE_PLUGIN_DATA}`.
4. `SessionStart`, `UserPromptSubmit`, and `Stop` all work with Claude-native payloads.
5. Stop interception behaves like Loopndroll semantics rather than plain default Claude stopping behavior.
6. Optional modes like infinite, await-reply, and completion-checks behave consistently.
7. Users can inspect and debug the system using the included skills/agent.

If those are true, the plugin has achieved its purpose.

## Why plugin-native instead of standalone settings

Claude Code plugins package hooks inside `hooks/hooks.json` at the plugin root. This keeps the functionality reusable, namespaced, versioned, and installable without asking users to manually copy hook config into `.claude/settings.json`.

The plugin must not hardcode whether the user installs it globally or per project. That choice belongs to the Claude Code plugin install path, not the plugin contents.

## Recommended architecture

### Summary

Use a plugin-native structure:
- `.claude-plugin/plugin.json`
- `hooks/hooks.json`
- runtime helpers under `scripts/`
- optional skills under `skills/`
- optional agents under `agents/`
- optional documentation under `README.md`

Do **not** add:
- external bootstrap shell installers
- plugin-managed install scope decisions
- project/global config writers
- setup flows that mutate the user's Claude settings outside normal plugin installation

### Runtime packaging choice

Recommended packaging:
- `hooks/hooks.json` contains the event wiring
- `scripts/` contains the runtime entrypoint and helpers

Reasoning:
- plugin hooks are the native integration point
- hook commands can reference `${CLAUDE_PLUGIN_ROOT}`
- runtime state should be stored in `${CLAUDE_PLUGIN_DATA}`
- `bin/` is unnecessary unless a manually invokable CLI is needed

## Proposed directory layout

```text
loop-plugin/
├── .claude-plugin/
│   └── plugin.json
├── hooks/
│   └── hooks.json
├── scripts/
│   ├── loop-hook.js
│   ├── runtime.ts
│   ├── db.ts
│   ├── notifications.ts
│   ├── completion-checks.ts
│   └── constants.ts
├── skills/
│   ├── explain/
│   │   └── SKILL.md
│   └── debug/
│       └── SKILL.md
├── agents/
│   └── hook-validator.md
└── README.md
```

Notes:
- only `plugin.json` goes inside `.claude-plugin/`
- all hooks live at plugin root under `hooks/`
- all executable/runtime code lives under `scripts/`
- skills and agents are optional plugin-native additions, not standalone setup flows
- the plugin should use `${CLAUDE_PLUGIN_ROOT}` for code paths
- the plugin should use `${CLAUDE_PLUGIN_DATA}` for persisted state

## Manifest

Proposed `.claude-plugin/plugin.json`:

```json
{
  "name": "loop-plugin",
  "description": "Loopndroll runtime hooks for Claude Code sessions.",
  "version": "0.1.0",
  "author": {
    "name": "Harsha Vardhan"
  }
}
```

This is intentionally minimal for the first version.

## Hook model

### hooks/hooks.json

The plugin will define hooks for exactly these events:
- `SessionStart`
- `UserPromptSubmit`
- `Stop`

Initial structure:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "cd \"${CLAUDE_PLUGIN_ROOT}\" && bun scripts/loop-hook.js"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cd \"${CLAUDE_PLUGIN_ROOT}\" && bun scripts/loop-hook.js"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cd \"${CLAUDE_PLUGIN_ROOT}\" && bun scripts/loop-hook.js"
          }
        ]
      }
    ]
  }
}
```

This assumes `bun` is available. If Bun availability inside plugin hooks is a concern, the runtime should be rewritten to Node-compatible JavaScript and invoked with `node` instead.

## Event handling behavior

### SessionStart

Purpose:
- initialize runtime state directories if missing
- upsert the Claude session in the Loopndroll database
- record cwd/source/session metadata
- prepare any session runtime rows needed later

Requirements:
- must be idempotent
- must handle both `startup` and `resume`
- must not duplicate sessions on resume

### UserPromptSubmit

Purpose:
- capture the submitted prompt
- update session title/metadata
- recover sessions if prompt arrives before session state is fully initialized

Requirements:
- should not overwrite good metadata with worse metadata
- should tolerate partial payloads

### Stop

Purpose:
- capture the last assistant message and latest session state
- send notifications if configured
- evaluate the effective mode for the session
- either allow stopping or convert the stop into a continuation

Modes to preserve from existing Loopndroll behavior:
- off
- infinite
- await reply
- completion checks
- max-turns-1
- max-turns-2
- max-turns-3

## Internal runtime contract

The plugin should keep the current Loopndroll behavior but stop depending on Codex-specific file locations and Codex-specific payload shape.

### Current Codex coupling to remove

The existing app is tied to Codex in these ways:
- reads/writes `~/.codex/config.toml`
- reads/writes `~/.codex/hooks.json`
- assumes Codex hook payload fields and event names directly
- writes a managed hook executable outside plugin boundaries

The plugin version must remove all of that.

### New internal model

The plugin runtime should normalize Claude hook stdin into one internal shape before business logic runs.

Proposed normalized shape:

```ts
{
  hook_event_name: string,
  session_id: string | null,
  cwd: string | null,
  source: string | null,
  prompt: string | null,
  transcript_path: string | null,
  last_assistant_message: string | null,
  turn_id: string | null,
  raw: unknown
}
```

The rest of the runtime should operate on this normalized structure rather than directly on hook payloads.

## Runtime state location

The plugin should not store durable runtime state inside the repo or inside the plugin source tree.

Use `${CLAUDE_PLUGIN_DATA}` for:
- sqlite database
- logs
- temporary state
- pending reply queues
- receipts
- local cache

Suggested layout inside plugin data:

```text
${CLAUDE_PLUGIN_DATA}/
├── app.db
├── logs/
│   └── hooks-debug.jsonl
└── runtime/
```

## Reuse vs rewrite

### Decision

Reuse the existing Loopndroll runtime behavior and port it into plugin-local runtime modules.

### Why this is the best choice

Benefits:
- preserves current feature semantics
- avoids re-inventing notification and completion-check logic
- minimizes behavior drift
- lowers implementation risk

What should be reused conceptually:
- session lifecycle logic
- preset resolution
- stop-decision logic
- completion-check execution
- Telegram/Slack notification behavior
- waiting-for-reply flow

What should be rewritten structurally:
- config registration logic
- path resolution
- stdin payload normalization
- any Codex-only assumptions
- any app-managed hook file writing

## Hook IO semantics

The runtime must be designed around Claude Code hook behavior.

Expected behavior:
- hook input arrives as JSON on stdin
- command hooks should read stdin and parse JSON
- success path exits `0`
- blocking path for supported events uses Claude hook output semantics
- logs should prefer stderr or debug files over noisy stdout

For `Stop`, the runtime must return the appropriate structured output for Claude Code to continue/block according to Claude's hook contract.

## Compatibility concerns

### Bun dependency

The plugin runtime assumes `bun` is installed.

Why this tradeoff is acceptable in v0:
1. **Bun-based runtime**
   - easiest port from the existing implementation
   - smallest rewrite
   - highest behavior fidelity
   - fastest path to a working Claude Code plugin
2. **Node-based runtime**
   - more portable in theory
   - would require a larger rewrite away from Bun APIs like `bun:sqlite` and `Bun.stdin`
   - would increase the risk of behavior drift while porting

### Decision

Use **Bun-based runtime** for v0.

Reason:
- it is the fastest path from the existing Loopndroll implementation
- it preserves more of the current runtime behavior with less rewrite risk
- behavior fidelity matters more than portability for the first version

The README should state Bun as a required runtime dependency for v0.

## What the plugin will not do in v0

To stay aligned with the requested plugin spec, v0 will not include:
- installer scripts
- setup wizards that write standalone Claude settings
- marketplace publishing automation
- project/global config writing
- MCP integration unless a concrete need appears during implementation

v0 may include:
- explanatory skills
- debugging/diagnostic skills
- a validation agent for checking hook behavior

## README requirements

The plugin README should include:
- what the plugin does
- required runtime dependency (`node` or `bun`)
- how to test locally with `claude --plugin-dir ./loop-plugin`
- how to verify hooks are loaded
- what state is stored in plugin data
- any environment variables required for Telegram/Slack support

It should **not** tell Claude Code to manually copy hooks into standalone settings because the plugin itself owns `hooks/hooks.json`.

## Proposed implementation phases after approval

1. create plugin directory structure
2. add minimal manifest
3. add plugin-native `hooks/hooks.json`
4. port runtime logic into `scripts/`
5. replace Codex path/config assumptions with plugin-root and plugin-data paths
6. normalize Claude hook payloads into internal runtime input
7. wire `Stop` output to Claude Code hook semantics
8. add README
9. test with `claude --plugin-dir ./loop-plugin`

## Approved decisions

1. **Runtime target:** v0 uses `bun`.
2. **Bootstrap scope:** the plugin should contain the runtime logic needed to behave like Loopndroll once loaded, without shipping external installer/setup scripts.
3. **Validation extras:** keep the hooks and add a lightweight validation agent. Do not remove useful components just to make the plugin smaller.

## Approval request

If this spec looks right, I’ll proceed to create `loop-plugin/` and implement the plugin from this design.

## Behavior fidelity note

Yes — this spec is intended to match current Loopndroll behavior as closely as possible for:
- session registration
- prompt/title capture
- stop interception
- mode resolution
- completion checks
- remote reply waiting
- Telegram/Slack notifications

The deliberate changes are only in packaging and integration:
- Codex-specific config/hook registration is removed
- Claude Code plugin hooks replace Codex hooks
- plugin-local paths and `${CLAUDE_PLUGIN_DATA}` replace external managed hook paths

So the target is **same behavior, new plugin-native integration surface**.