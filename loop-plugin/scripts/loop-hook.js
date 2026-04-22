import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { MANAGED_HOOK_SCRIPT_CHUNK_1 } from "./managed-hook-script/chunk-1.ts";
import { MANAGED_HOOK_SCRIPT_CHUNK_2 } from "./managed-hook-script/chunk-2.ts";
import { MANAGED_HOOK_SCRIPT_CHUNK_3 } from "./managed-hook-script/chunk-3.ts";
import { DEFAULT_PROMPT } from "./constants.ts";
import { SQLITE_PRAGMA_STATEMENTS } from "./db/client.ts";
import { appMigrations } from "./db/migrations.ts";
import {
  AWAIT_REPLY_POLL_INTERVAL_MS,
  GENERATED_TITLE_MATCH_WINDOW_MS,
  getLoopPluginPaths,
  HOOK_DEBUG_LOG_ENV_NAME,
  HOOK_DEBUG_REDACTED_KEYS,
  MANAGED_HOOK_SCRIPT_MARKER,
  REDACTED_DEBUG_VALUE,
  TELEGRAM_MAX_MESSAGE_LENGTH,
  TELEGRAM_NOTIFICATION_FOOTER,
} from "./runtime-paths.ts";

const paths = getLoopPluginPaths();

const preamble = `#!/usr/bin/env bun
// ${MANAGED_HOOK_SCRIPT_MARKER}
import { spawnSync } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

const databasePath = ${JSON.stringify(paths.databasePath)};
const logsDirectoryPath = ${JSON.stringify(paths.logsDirectoryPath)};
const hookDebugLogPath = ${JSON.stringify(paths.hookDebugLogPath)};
const defaultPrompt = ${JSON.stringify(DEFAULT_PROMPT)};
const generatedTitleMatchWindowMs = ${String(GENERATED_TITLE_MATCH_WINDOW_MS)};
const awaitReplyPollIntervalMs = ${String(AWAIT_REPLY_POLL_INTERVAL_MS)};
const telegramMaxMessageLength = ${String(TELEGRAM_MAX_MESSAGE_LENGTH)};
const telegramNotificationFooter = ${JSON.stringify(TELEGRAM_NOTIFICATION_FOOTER)};
const hookDebugLogEnvName = ${JSON.stringify(HOOK_DEBUG_LOG_ENV_NAME)};
const redactedDebugValue = ${JSON.stringify(REDACTED_DEBUG_VALUE)};
const hookDebugRedactedKeys = ${JSON.stringify([...HOOK_DEBUG_REDACTED_KEYS])};
const sqlitePragmas = ${JSON.stringify([...SQLITE_PRAGMA_STATEMENTS])};
const appMigrations = ${JSON.stringify(appMigrations)};
`;

function patchRuntime(source) {
  return source
    .replaceAll("Codex chat", "Claude Code session")
    .replaceAll("Codex", "Claude Code")
    .replace(
      '  if (stopDecision.continue === false) {\n    return {\n      continue: false,\n      stopReason:\n        typeof stopDecision.stopReason === "string" ? stopDecision.stopReason : undefined,\n    };\n  }\n\n',
      "",
    )
    .replace(
      'function summarizeCompletionCheckOutput(output) {\n  const normalizedOutput = String(output ?? "").trim();\n  if (normalizedOutput.length === 0) {\n    return null;\n  }\n\n  const lines = normalizedOutput.split(/\\r?\\n/).map((line) => line.trimEnd()).filter(Boolean);\n  const tail = lines.slice(-8).join("\\n").trim();\n  return tail.length > 0 ? tail : null;\n}\n',
      'function summarizeCompletionCheckOutput(output) {\n  const normalizedOutput = String(output ?? "").trim();\n  if (normalizedOutput.length === 0) {\n    return null;\n  }\n\n  const ignoredLinePatterns = [\n    /nvm is not compatible with the "npm_config_prefix" environment variable/i,\n    /Run `unset npm_config_prefix` to unset it\./i,\n  ];\n\n  const lines = normalizedOutput\n    .split(/\\r?\\n/)\n    .map((line) => line.trimEnd())\n    .filter(Boolean)\n    .filter((line) => !ignoredLinePatterns.some((pattern) => pattern.test(line)));\n\n  const tail = lines.slice(-8).join("\\n").trim();\n  return tail.length > 0 ? tail : null;\n}\n',
    );
}

const runtime = [
  preamble,
  MANAGED_HOOK_SCRIPT_CHUNK_1,
  MANAGED_HOOK_SCRIPT_CHUNK_2,
  MANAGED_HOOK_SCRIPT_CHUNK_3,
].join("");

const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" });
const executableSource = transpiler.transformSync(patchRuntime(runtime));
const executablePath = `${paths.pluginData}/runtime/loop-hook-runtime.generated.mjs`;

await mkdir(dirname(executablePath), { recursive: true });
await Bun.write(executablePath, executableSource);

async function readLastAssistantMessage(transcriptPath) {
  if (typeof transcriptPath !== "string" || transcriptPath.trim().length === 0) {
    return null;
  }

  try {
    const transcript = await readFile(transcriptPath, "utf8");
    const lines = transcript.split(/\r?\n/).filter(Boolean).reverse();

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const message = parsed?.message ?? parsed;
        const role = message?.role ?? parsed?.role;
        if (role !== "assistant") {
          continue;
        }

        const content = message?.content ?? parsed?.content;
        if (typeof content === "string" && content.trim().length > 0) {
          return content.trim();
        }

        if (Array.isArray(content)) {
          const text = content
            .map((item) => {
              if (typeof item === "string") return item;
              if (item?.type === "text" && typeof item.text === "string") return item.text;
              return "";
            })
            .join("\n")
            .trim();
          if (text.length > 0) {
            return text;
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function normalizeHookInput(raw) {
  const input = raw && typeof raw === "object" ? { ...raw } : {};
  const hookEventName = input.hook_event_name;

  if (hookEventName === "UserPromptSubmit" && typeof input.user_prompt === "undefined") {
    input.user_prompt = typeof input.prompt === "string" ? input.prompt : null;
  }

  if (hookEventName === "Stop" && typeof input.last_assistant_message === "undefined") {
    input.last_assistant_message = await readLastAssistantMessage(input.transcript_path);
  }

  return input;
}

function rewriteStopReason(input, reason) {
  if (input?.hook_event_name !== "Stop" || typeof reason !== "string") {
    return reason;
  }

  const trimmedReason = reason.trim();
  if (!input?.stop_hook_active) {
    return trimmedReason;
  }

  if (trimmedReason === DEFAULT_PROMPT) {
    return "Continue working on the current task. Do not repeat your completion summary. Take the next concrete step, run relevant checks before stopping, and only stop when the work is actually complete or the loop is disabled.";
  }

  return `${trimmedReason}\n\nAvoid repeating your prior completion summary. Continue with the next concrete step.`;
}

function rewriteHookOutput(input, stdout) {
  if (typeof stdout !== "string" || stdout.trim().length === 0) {
    return stdout;
  }

  try {
    const parsed = JSON.parse(stdout);
    if (input?.hook_event_name === "Stop" && parsed?.decision === "block" && typeof parsed?.reason === "string") {
      parsed.reason = rewriteStopReason(input, parsed.reason);
      return `${JSON.stringify(parsed)}\n`;
    }
  } catch {
    return stdout;
  }

  return stdout;
}

const stdin = await Bun.stdin.text();
const normalizedInput = await normalizeHookInput(JSON.parse(stdin));
const result = spawnSync("bun", [executablePath], {
  input: JSON.stringify(normalizedInput),
  encoding: "utf8",
  env: process.env,
  maxBuffer: 10 * 1024 * 1024,
});

const rewrittenStdout = rewriteHookOutput(normalizedInput, result.stdout);
if (rewrittenStdout) process.stdout.write(rewrittenStdout);
if (result.stderr) process.stderr.write(result.stderr);
if (typeof result.status === "number") process.exit(result.status);
if (result.error) throw result.error;
